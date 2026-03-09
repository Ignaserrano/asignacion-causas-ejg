"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import AppShell from "@/components/AppShell";
import ContactForm, { CreatedContact } from "@/components/contacts/ContactForm";
import { auth, db } from "@/lib/firebase";
import { addAutoLog } from "@/lib/caseManagement";
import {
  calculateDistribution,
  chargeDocRef,
  confirmChargeTransfers,
  getScheduledRemainingAmount,
  registerPaidCharge,
  type ChargeCurrency,
  type ChargeDeduction,
  type ChargeItem,
} from "@/lib/charges";

type MainCaseRow = {
  id: string;
  caratulaTentativa?: string;
  confirmedAssigneesUids?: string[];
  broughtByUid?: string;
};

type ContactDoc = {
  id: string;
  type?: string;
  personType?: "fisica" | "juridica";
  name?: string;
  lastName?: string;
  fullName?: string;
  nameLower?: string;
  address?: string;
  dni?: string;
  cuit?: string;
  phone?: string;
  email?: string;
};

type LawyerOption = {
  uid: string;
  email: string;
};

type ScheduledChargeRow = {
  id: string;
  ownerUid?: string;
  payerRef?: {
    contactId?: string | null;
    displayName?: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };
  caseRef?: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase?: boolean;
    extraCaseReason?: string;
  };
  items?: ChargeItem[];
  totalAmount?: number;
  collectedAmount?: number;
  remainingAmount?: number;
  partialPaymentsCount?: number;
  currency?: ChargeCurrency;
  notes?: string;
  installments?: {
    enabled?: boolean;
    total?: number;
    current?: number;
  };
  scheduledDate?: any;
  visibleToUids?: string[];
};

type SavedChargeRow = {
  id: string;
  ownerUid?: string;
  caseRef?: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase?: boolean;
    extraCaseReason?: string;
  };
  payerRef?: {
    displayName?: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };
  totalAmount?: number;
  currency?: string;
  deductions?: ChargeDeduction[];
  distribution?: {
    grossAmount?: number;
    deductionsTotal?: number;
    baseNetAmount?: number;
    studioFundPercent?: number;
    studioFundAmount?: number;
    distributableAmount?: number;
    participants?: Array<{
      id: string;
      uid?: string;
      displayName: string;
      percent: number;
      amount: number;
      kind: "lawyer" | "external";
    }>;
  };
  transferTicket?: {
    status?: "pending" | "done";
    createdAt?: any;
    confirmedAt?: any;
    confirmedByUid?: string;
  };
  paidAt?: any;
};

type DistributionParticipantDraft = {
  id: string;
  uid?: string;
  displayName: string;
  percent: number;
  kind: "lawyer" | "external";
};

function safeText(v: any) {
  return String(v ?? "").trim();
}

function fmtDate(v?: any) {
  if (!v) return "-";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return d.toLocaleDateString();
}

function fmtDateTimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString()} ${currency ?? ""}`.trim();
}

function getContactFullName(c?: ContactDoc | null) {
  if (!c) return "";
  return safeText(c.fullName) || `${safeText(c.name)} ${safeText(c.lastName)}`.trim();
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function buildEqualParticipants(uids: string[], lawyers: LawyerOption[]) {
  const uniq = Array.from(new Set(uids.filter(Boolean)));
  if (uniq.length === 0) return [] as DistributionParticipantDraft[];

  const equal = 100 / uniq.length;

  return uniq.map((uid, idx) => {
    const found = lawyers.find((l) => l.uid === uid);
    const base = Number(equal.toFixed(2));
    const percent =
      idx === uniq.length - 1
        ? Number((100 - base * (uniq.length - 1)).toFixed(2))
        : base;

    return {
      id: makeId(),
      uid,
      displayName: found?.email ?? uid,
      percent,
      kind: "lawyer" as const,
    };
  });
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto overflow-x-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="text-base font-black text-gray-900 dark:text-gray-100">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function RegistrarCobroPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const scheduledId = searchParams.get("scheduledId");
  const queryCaseId = searchParams.get("caseId");
  const ticketId = searchParams.get("ticket");

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ticketSuccessMsg, setTicketSuccessMsg] = useState<string | null>(null);

  const [step, setStep] = useState<"source" | "form" | "distribution" | "ticket">(
    ticketId || scheduledId || queryCaseId ? "form" : "source"
  );

  const [myCases, setMyCases] = useState<MainCaseRow[]>([]);
  const [lawyerOptions, setLawyerOptions] = useState<LawyerOption[]>([]);
  const [scheduledOptions, setScheduledOptions] = useState<ScheduledChargeRow[]>([]);

  const [sourceMode, setSourceMode] = useState<"scheduled" | "zero">(scheduledId ? "scheduled" : "zero");
  const [selectedScheduledId, setSelectedScheduledId] = useState<string>(scheduledId ?? "");
  const [selectedScheduledCharge, setSelectedScheduledCharge] = useState<ScheduledChargeRow | null>(null);

  const [originType, setOriginType] = useState<"case" | "extra">(queryCaseId ? "case" : "case");
  const [selectedCaseId, setSelectedCaseId] = useState<string>(queryCaseId ?? "");
  const [extraCaseReason, setExtraCaseReason] = useState("");

  const [selectedContact, setSelectedContact] = useState<ContactDoc | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactDoc[]>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [createContactModalOpen, setCreateContactModalOpen] = useState(false);

  const [items, setItems] = useState<ChargeItem[]>([
    {
      id: makeId(),
      concept: "honorarios",
      label: "",
      amount: "" as unknown as number,
      currency: "ARS",
    },
  ]);

  const [currency, setCurrency] = useState<ChargeCurrency>("ARS");
  const [paidAtInput, setPaidAtInput] = useState<string>(fmtDateTimeInput(new Date()));
  const [notes, setNotes] = useState("");

  const [installmentsEnabled, setInstallmentsEnabled] = useState(false);
  const [installmentsTotal, setInstallmentsTotal] = useState<number>(0);
  const [installmentsCurrent, setInstallmentsCurrent] = useState<number>(1);

  const [deductions, setDeductions] = useState<ChargeDeduction[]>([]);
  const [participants, setParticipants] = useState<DistributionParticipantDraft[]>([]);
  const [lawyerToAddUid, setLawyerToAddUid] = useState<string>("");

  const [ticketChargeId, setTicketChargeId] = useState<string | null>(ticketId);
  const [ticketCharge, setTicketCharge] = useState<SavedChargeRow | null>(null);

  const selectedCase = useMemo(
    () => myCases.find((c) => c.id === selectedCaseId) ?? null,
    [myCases, selectedCaseId]
  );

  const grossAmount = useMemo(
    () => items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
    [items]
  );

  const percentSum = useMemo(
    () => participants.reduce((sum, p) => sum + Number(p.percent || 0), 0),
    [participants]
  );

  const calculatedDistribution = useMemo(() => {
    return calculateDistribution({
      gross: grossAmount,
      deductions,
      participants: participants.map((p) => ({
        uid: p.uid,
        displayName: p.displayName,
        percent: p.percent,
        kind: p.kind,
      })),
    });
  }, [grossAmount, deductions, participants]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setLoadingShell(true);
      setMsg(null);

      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const userData = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(userData?.role ?? "lawyer"));

        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const pendingSnap = await getDocs(qPending);
        setPendingInvites(pendingSnap.size);

        const qCases = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", u.uid),
          limit(300)
        );
        const casesSnap = await getDocs(qCases);
        const cases = casesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as MainCaseRow[];
        cases.sort((a, b) =>
          safeText(a.caratulaTentativa).localeCompare(safeText(b.caratulaTentativa), "es")
        );
        setMyCases(cases);

        const qUsers = query(collection(db, "users"), orderBy("email", "asc"));
        const usersSnap = await getDocs(qUsers);
        const lawyers = usersSnap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              email: safeText(data?.email),
            };
          })
          .filter((x) => Boolean(x.email));
        setLawyerOptions(lawyers);

        const qScheduled = query(
          collection(db, "charges"),
          where("visibleToUids", "array-contains", u.uid),
          where("status", "==", "scheduled"),
          orderBy("scheduledDate", "asc"),
          limit(100)
        );
        const scheduledSnap = await getDocs(qScheduled);
        setScheduledOptions(
          scheduledSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ScheduledChargeRow[]
        );
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando datos");
      } finally {
        setLoadingShell(false);
      }
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const qText = contactQuery.trim().toLowerCase();
      setContactError(null);

      if (qText.length < 2) {
        setContactResults([]);
        setContactLoading(false);
        return;
      }

      setContactLoading(true);

      try {
        const tokens = qText
          .split(/\s+/)
          .map((t) => t.trim())
          .filter(Boolean);

        const snap = await getDocs(
          query(collection(db, "contacts"), orderBy("nameLower", "asc"), limit(200))
        );

        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ContactDoc[];

        const filtered = all.filter((c) => {
          const full = safeText(c.fullName || `${c.name ?? ""} ${c.lastName ?? ""}`.trim()).toLowerCase();
          return tokens.every((t) => full.includes(t));
        });

        if (!alive) return;
        setContactResults(filtered.slice(0, 10));
      } catch (e: any) {
        if (!alive) return;
        setContactResults([]);
        setContactError(e?.message ?? "No pude buscar contactos.");
      } finally {
        if (!alive) return;
        setContactLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [contactQuery]);

  useEffect(() => {
    if (!selectedCaseId || participants.length > 0) return;
    if (!selectedCase?.confirmedAssigneesUids?.length) return;

    setParticipants(buildEqualParticipants(selectedCase.confirmedAssigneesUids, lawyerOptions));
  }, [selectedCaseId, selectedCase, lawyerOptions, participants.length]);

  useEffect(() => {
    (async () => {
      if (!scheduledId) return;

      try {
        const snap = await getDoc(doc(db, "charges", scheduledId));
        if (!snap.exists()) return;

        const data = { id: snap.id, ...(snap.data() as any) } as ScheduledChargeRow;
        applyScheduledCharge(data);
      } catch (e: any) {
        setMsg(e?.message ?? "No pude cargar el cobro previsto.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledId]);

  useEffect(() => {
    (async () => {
      if (!ticketId) return;

      try {
        const snap = await getDoc(doc(db, "charges", ticketId));
        if (!snap.exists()) return;
        const data = { id: snap.id, ...(snap.data() as any) } as SavedChargeRow;
        setTicketChargeId(ticketId);
        setTicketCharge(data);
        setStep("ticket");
      } catch (e: any) {
        setMsg(e?.message ?? "No pude cargar el ticket.");
      }
    })();
  }, [ticketId]);

  function applyScheduledCharge(data: ScheduledChargeRow) {
    setSourceMode("scheduled");
    setSelectedScheduledId(data.id);
    setSelectedScheduledCharge(data);

    const isExtra = Boolean(data.caseRef?.isExtraCase);
    setOriginType(isExtra ? "extra" : "case");
    setSelectedCaseId(safeText(data.caseRef?.caseId));
    setExtraCaseReason(safeText(data.caseRef?.extraCaseReason));

    if (data.payerRef?.displayName) {
      setSelectedContact({
        id: safeText(data.payerRef.contactId),
        fullName: safeText(data.payerRef.displayName),
        name: safeText(data.payerRef.displayName),
        email: safeText(data.payerRef.email),
        phone: safeText(data.payerRef.phone),
        cuit: safeText(data.payerRef.cuit),
      });
      setContactQuery(safeText(data.payerRef.displayName));
    }

    if (Array.isArray(data.items) && data.items.length > 0) {
      setItems(
        data.items.map((it) => ({
          ...it,
          id: it.id || makeId(),
        }))
      );
    }

    setCurrency((data.currency as ChargeCurrency) ?? "ARS");
    setNotes(safeText(data.notes));

    const inst = data.installments;
    setInstallmentsEnabled(Boolean(inst?.enabled));
    setInstallmentsTotal(Number(inst?.total ?? 0));
    setInstallmentsCurrent(Number(inst?.current ?? 1) || 1);

    setStep("form");
  }

  function selectContact(c: ContactDoc) {
    const fullName = getContactFullName(c);
    setSelectedContact(c);
    setContactQuery(fullName);
    setContactResults([]);
  }

  function handleContactCreated(contact: CreatedContact) {
    const created = {
      id: contact.id,
      fullName: contact.fullName,
      name: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      cuit: contact.cuit,
      address: contact.address,
    } as ContactDoc;

    setCreateContactModalOpen(false);
    selectContact(created);
  }

  function resetForZero() {
    setSourceMode("zero");
    setSelectedScheduledId("");
    setSelectedScheduledCharge(null);
    setOriginType(queryCaseId ? "case" : "case");
    setSelectedCaseId(queryCaseId ?? "");
    setExtraCaseReason("");
    setSelectedContact(null);
    setContactQuery("");
    setItems([
      {
        id: makeId(),
        concept: "honorarios",
        label: "",
        amount: "" as unknown as number,
        currency: "ARS",
      },
    ]);
    setCurrency("ARS");
    setNotes("");
    setInstallmentsEnabled(false);
    setInstallmentsTotal(0);
    setInstallmentsCurrent(1);
    setDeductions([]);
    setParticipants([]);
    setStep("form");
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: makeId(),
        concept: "honorarios",
        label: "",
        amount: "" as unknown as number,
        currency,
      },
    ]);
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((x) => x.id !== id)));
  }

  function updateItem(id: string, patch: Partial<ChargeItem>) {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addDeduction() {
    setDeductions((prev) => [
      ...prev,
      {
        id: makeId(),
        type: "aporte_previsional",
        label: "",
        amount: 0,
      },
    ]);
  }

  function removeDeduction(id: string) {
    setDeductions((prev) => prev.filter((x) => x.id !== id));
  }

  function updateDeduction(id: string, patch: Partial<ChargeDeduction>) {
    setDeductions((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function removeParticipant(id: string) {
    setParticipants((prev) => prev.filter((x) => x.id !== id));
  }

  function updateParticipant(id: string, patch: Partial<DistributionParticipantDraft>) {
    setParticipants((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addLawyerParticipant() {
    if (!lawyerToAddUid) return;
    const found = lawyerOptions.find((x) => x.uid === lawyerToAddUid);
    if (!found) return;

    if (participants.some((p) => p.uid === found.uid)) {
      alert("Ese abogado ya fue agregado.");
      return;
    }

    setParticipants((prev) => [
      ...prev,
      {
        id: makeId(),
        uid: found.uid,
        displayName: found.email,
        percent: 0,
        kind: "lawyer",
      },
    ]);
    setLawyerToAddUid("");
  }

  function addExternalParticipant() {
    setParticipants((prev) => [
      ...prev,
      {
        id: makeId(),
        displayName: "",
        percent: 0,
        kind: "external",
      },
    ]);
  }

  function goNextFromSource() {
    if (sourceMode === "scheduled") {
      const found = scheduledOptions.find((x) => x.id === selectedScheduledId);
      if (!found) {
        alert("Seleccioná un cobro previsto.");
        return;
      }
      applyScheduledCharge(found);
      return;
    }

    resetForZero();
  }

  function validateFormStep() {
    if (originType === "case" && !selectedCaseId) {
      alert("Seleccioná una causa.");
      return false;
    }

    if (originType === "extra" && !safeText(extraCaseReason)) {
      alert("Ingresá el motivo del cobro extra-caso.");
      return false;
    }

    if (!selectedContact || !getContactFullName(selectedContact)) {
      alert("Seleccioná quién realiza el pago.");
      return false;
    }

    const validItems = items.filter((x) => Number(x.amount) > 0);
    if (validItems.length === 0) {
      alert("Ingresá al menos un rubro con monto mayor a cero.");
      return false;
    }

    if (installmentsEnabled) {
      if (!installmentsTotal || installmentsTotal < 1) {
        alert("Ingresá la cantidad de cuotas.");
        return false;
      }
      if (!installmentsCurrent || installmentsCurrent < 1) {
        alert("Ingresá el número de cuota cancelada.");
        return false;
      }
    }

    return true;
  }

  function goNextToDistribution() {
    if (!validateFormStep()) return;

    if (participants.length === 0) {
      if (originType === "case" && selectedCase?.confirmedAssigneesUids?.length) {
        setParticipants(buildEqualParticipants(selectedCase.confirmedAssigneesUids, lawyerOptions));
      } else if (user?.uid) {
        setParticipants([
          {
            id: makeId(),
            uid: user.uid,
            displayName: user.email ?? "Yo",
            percent: 100,
            kind: "lawyer",
          },
        ]);
      }
    }

    setStep("distribution");
  }

  async function saveCharge() {
    if (!user) return;
    if (percentSum !== 100) {
      alert("La suma de porcentajes debe ser exactamente 100.");
      return;
    }

    const validItems = items.filter((x) => Number(x.amount) > 0);
    if (validItems.length === 0) {
      alert("No hay rubros válidos.");
      return;
    }

    const currentGrossAmount = validItems.reduce((sum, x) => sum + Number(x.amount || 0), 0);

    if (selectedScheduledCharge) {
      const remaining = getScheduledRemainingAmount(selectedScheduledCharge);
      if (currentGrossAmount > remaining) {
        alert("El cobro que querés registrar supera el saldo pendiente del cobro agendado.");
        return;
      }
    }

    const paidAt = new Date(paidAtInput);
    const caseRef = {
      caseId: originType === "case" ? selectedCaseId : null,
      caratula: originType === "case" ? safeText(selectedCase?.caratulaTentativa) : "",
      isExtraCase: originType === "extra",
      extraCaseReason: originType === "extra" ? safeText(extraCaseReason) : "",
    };

    const payerRef = {
      contactId: safeText(selectedContact?.id) || null,
      displayName: getContactFullName(selectedContact),
      email: safeText(selectedContact?.email),
      phone: safeText(selectedContact?.phone),
      cuit: safeText(selectedContact?.cuit),
    };

    const visibleToUids = Array.from(
      new Set(
        [
          user.uid,
          ...(originType === "case" ? selectedCase?.confirmedAssigneesUids ?? [] : []),
          ...participants.map((p) => p.uid).filter(Boolean),
        ].filter(Boolean)
      )
    ) as string[];

    const pendingTransferReceiverUids = Array.from(
      new Set(participants.filter((p) => p.kind === "lawyer" && p.uid).map((p) => p.uid!))
    );

    setSaving(true);

    try {
      const result = await registerPaidCharge({
        scheduledChargeId: selectedScheduledId || null,
        ownerUid: user.uid,
        ownerEmail: user.email ?? "",
        visibleToUids,
        caseRef,
        payerRef,
        paidAt,
        currency,
        items: validItems,
        installments: installmentsEnabled
          ? {
              enabled: true,
              total: installmentsTotal,
              current: installmentsCurrent,
            }
          : { enabled: false },
        deductions,
        distribution: calculatedDistribution,
        pendingTransferReceiverUids,
        notes: safeText(notes),
      });

      if (caseRef.caseId) {
        await addAutoLog({
          caseId: caseRef.caseId,
          uid: user.uid,
          email: user.email ?? "",
          title: selectedScheduledId
            ? result.scheduledCompleted
              ? "Cobro agendado completado"
              : "Cobro parcial de cobro agendado"
            : "Cobro registrado",
          body: `Se registró cobro por ${fmtMoney(currentGrossAmount, currency)}.`,
          type: "control_cobro",
        });
      }

      const savedSnap = await getDoc(chargeDocRef(result.paidChargeId));
      const savedData = { id: savedSnap.id, ...(savedSnap.data() as any) } as SavedChargeRow;
      setTicketChargeId(result.paidChargeId);
      setTicketCharge(savedData);
      setTicketSuccessMsg(null);
      setStep("ticket");
    } catch (e: any) {
      alert(e?.message ?? "No se pudo guardar el cobro.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmTransfersDone() {
    if (!ticketChargeId || !user || !ticketCharge) return;

    const ok = window.confirm("¿Confirmás que realizaste las transferencias?");
    if (!ok) return;

    setSaving(true);
    setTicketSuccessMsg(null);

    try {
      await confirmChargeTransfers({
        chargeId: ticketChargeId,
        confirmedByUid: user.uid,
      });

      if (ticketCharge.caseRef?.caseId) {
        await addAutoLog({
          caseId: ticketCharge.caseId,
          uid: user.uid,
          email: user.email ?? "",
          title: "Transferencias internas realizadas",
          body: "Se confirmaron las transferencias derivadas del cobro registrado.",
          type: "control_cobro",
        });
      }

      setTicketCharge((prev) =>
        prev
          ? {
              ...prev,
              transferTicket: {
                ...(prev.transferTicket ?? {}),
                status: "done",
                confirmedByUid: user.uid,
                confirmedAt: new Date(),
              },
            }
          : prev
      );

      setTicketSuccessMsg("Transferencias confirmadas correctamente.");
    } catch (e: any) {
      alert(e?.message ?? "No se pudo confirmar la operación.");
    } finally {
      setSaving(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Registrar cobro"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loadingShell ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          {step === "source"
            ? "Paso 1 · Elegir origen"
            : step === "form"
            ? "Paso 2 · Datos del cobro"
            : step === "distribution"
            ? "Paso 3 · Distribución"
            : "Ticket"}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/cobranzas"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Volver
          </Link>
        </div>
      </div>

      {step === "source" ? (
        <div className="grid min-w-0 gap-4 overflow-x-hidden">
          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              ¿Cómo querés registrar el cobro?
            </div>

            <div className="mt-4 grid gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                <input
                  type="radio"
                  checked={sourceMode === "scheduled"}
                  onChange={() => setSourceMode("scheduled")}
                />
                Usar un cobro previsto ya agendado
              </label>

              {sourceMode === "scheduled" ? (
                <select
                  value={selectedScheduledId}
                  onChange={(e) => setSelectedScheduledId(e.target.value)}
                  className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Seleccionar…</option>
                  {scheduledOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {fmtDate(c.scheduledDate)} · {safeText(c.payerRef?.displayName) || "(sin pagador)"} ·{" "}
                      {fmtMoney(c.remainingAmount ?? c.totalAmount, c.currency)}
                    </option>
                  ))}
                </select>
              ) : null}

              <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                <input
                  type="radio"
                  checked={sourceMode === "zero"}
                  onChange={() => setSourceMode("zero")}
                />
                Registrar un nuevo cobro desde cero
              </label>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={goNextFromSource}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90"
                >
                  Continuar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === "form" ? (
        <div className="grid min-w-0 gap-4 overflow-x-hidden">
          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">Origen del cobro</div>

            <div className="mt-3 grid gap-3">
              <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                <input
                  type="radio"
                  checked={originType === "case"}
                  onChange={() => setOriginType("case")}
                />
                Cobro de una causa
              </label>

              {originType === "case" ? (
                <select
                  value={selectedCaseId}
                  onChange={(e) => {
                    setSelectedCaseId(e.target.value);
                    setParticipants([]);
                  }}
                  className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Seleccionar causa…</option>
                  {myCases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {safeText(c.caratulaTentativa) || c.id}
                    </option>
                  ))}
                </select>
              ) : null}

              <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                <input
                  type="radio"
                  checked={originType === "extra"}
                  onChange={() => setOriginType("extra")}
                />
                Es un cobro extra-caso
              </label>

              {originType === "extra" ? (
                <input
                  value={extraCaseReason}
                  onChange={(e) => setExtraCaseReason(e.target.value)}
                  placeholder="Ej: consulta, audiencia, gestión puntual"
                  className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              ) : null}
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">Quién paga</div>

            <div className="relative mt-3 min-w-0">
              <input
                value={contactQuery}
                onChange={(e) => {
                  setContactQuery(e.target.value);
                  setSelectedContact(null);
                }}
                placeholder="Buscar por nombre, apellido o razón social"
                className="w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />

              {contactLoading ? (
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Buscando…</div>
              ) : null}

              {contactError ? (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-200">{contactError}</div>
              ) : null}

              {contactResults.length > 0 ? (
                <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectContact(c)}
                      className="flex w-full min-w-0 flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                    >
                      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {getContactFullName(c) || "(sin nombre)"}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {safeText(c.email)}
                        {safeText(c.email) && safeText(c.phone) ? " · " : ""}
                        {safeText(c.phone)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {selectedContact ? (
                <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                  <div className="break-words font-black">{getContactFullName(selectedContact)}</div>
                  <div className="mt-1 break-words text-xs">
                    {safeText(selectedContact.email)}
                    {safeText(selectedContact.email) && safeText(selectedContact.phone) ? " · " : ""}
                    {safeText(selectedContact.phone)}
                    {safeText(selectedContact.cuit) ? ` · CUIT/CUIL: ${safeText(selectedContact.cuit)}` : ""}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                ¿No existe el contacto?{" "}
                <button
                  type="button"
                  className="font-extrabold underline"
                  onClick={() => setCreateContactModalOpen(true)}
                >
                  Crear contacto →
                </button>
              </div>
            </div>
          </div>

          {selectedScheduledCharge ? (
            <div className="min-w-0 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
              <div className="font-black">Cobro agendado seleccionado</div>
              <div className="mt-1">
                Total agendado: {fmtMoney(selectedScheduledCharge.totalAmount, selectedScheduledCharge.currency)}
              </div>
              <div>
                Ya cobrado: {fmtMoney(selectedScheduledCharge.collectedAmount, selectedScheduledCharge.currency)}
              </div>
              <div>
                Pendiente: {fmtMoney(getScheduledRemainingAmount(selectedScheduledCharge), selectedScheduledCharge.currency)}
              </div>
              <div className="mt-1 text-xs">
                Podés registrar un cobro parcial. Si cobrás menos que el pendiente, el agendado seguirá abierto.
              </div>
            </div>
          ) : null}

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">Rubros del cobro</div>
              <button
                type="button"
                onClick={addItem}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Agregar rubro
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800 xl:grid-cols-4"
                >
                  <select
                    value={item.concept}
                    onChange={(e) => updateItem(item.id, { concept: e.target.value as any })}
                    className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="honorarios">Honorarios</option>
                    <option value="devolucion_gastos">Devolución de gastos</option>
                    <option value="aportes_previsionales">Aportes previsionales</option>
                    <option value="iva">IVA</option>
                    <option value="otro">Otro</option>
                  </select>

                  <input
                    value={item.label ?? ""}
                    onChange={(e) => updateItem(item.id, { label: e.target.value })}
                    placeholder="Aclaración (opcional)"
                    className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />

                  <input
                    type="number"
                    value={item.amount === ("" as unknown as number) ? "" : Number(item.amount ?? "")}
                    onChange={(e) =>
                      updateItem(item.id, {
                        amount:
                          e.target.value === "" ? ("" as unknown as number) : Number(e.target.value),
                      })
                    }
                    className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                  >
                    Quitar
                  </button>
                </div>
              ))}

              <div className="grid min-w-0 gap-3 md:grid-cols-3">
                <label className="grid min-w-0 gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Moneda</span>
                  <select
                    value={currency}
                    onChange={(e) => {
                      const next = e.target.value as ChargeCurrency;
                      setCurrency(next);
                      setItems((prev) => prev.map((x) => ({ ...x, currency: next })));
                    }}
                    className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="ARS">Pesos</option>
                    <option value="USD">Dólares</option>
                  </select>
                </label>

                <label className="grid min-w-0 gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Fecha del cobro</span>
                  <input
                    type="datetime-local"
                    value={paidAtInput}
                    onChange={(e) => setPaidAtInput(e.target.value)}
                    className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>

                <div className="grid min-w-0 gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Total bruto</span>
                  <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-black text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                    {fmtMoney(grossAmount, currency)}
                  </div>
                </div>
              </div>

              <label className="grid min-w-0 gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Observaciones</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="min-h-[90px] min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep(scheduledId ? "form" : "source")}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Anterior
            </button>

            <button
              type="button"
              onClick={goNextToDistribution}
              className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90"
            >
              Siguiente
            </button>

            <Link
              href="/cobranzas"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Cancelar
            </Link>
          </div>
        </div>
      ) : null}

      {step === "distribution" ? (
        <div className="grid min-w-0 gap-4 overflow-x-hidden">
          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">Deducciones</div>
              <button
                type="button"
                onClick={addDeduction}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Agregar deducción
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              {deductions.length === 0 ? (
                <div className="text-sm text-gray-700 dark:text-gray-200">No hay deducciones cargadas.</div>
              ) : (
                deductions.map((d) => (
                  <div
                    key={d.id}
                    className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800 xl:grid-cols-4"
                  >
                    <select
                      value={d.type}
                      onChange={(e) => updateDeduction(d.id, { type: e.target.value as any })}
                      className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="aporte_previsional">Aporte previsional</option>
                      <option value="iibb">IIBB</option>
                      <option value="reintegro_gastos">Reintegro de gastos</option>
                      <option value="otro">Otro</option>
                    </select>

                    <input
                      value={d.label ?? ""}
                      onChange={(e) => updateDeduction(d.id, { label: e.target.value })}
                      placeholder="Aclaración (opcional)"
                      className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />

                    <input
                      type="number"
                      value={Number(d.amount ?? 0)}
                      onChange={(e) => updateDeduction(d.id, { amount: Number(e.target.value) })}
                      className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />

                    <button
                      type="button"
                      onClick={() => removeDeduction(d.id)}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                    >
                      Quitar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">Distribución</div>

            <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-3">
              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Bruto</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(calculatedDistribution.grossAmount, currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Deducciones</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(calculatedDistribution.deductionsTotal, currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Neto base</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(calculatedDistribution.baseNetAmount, currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Fondo estudio (15%)</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(calculatedDistribution.studioFundAmount, currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Distribuible</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(calculatedDistribution.distributableAmount, currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Suma porcentajes</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {percentSum}%
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {participants.map((p) => {
                const calcParticipant =
                  calculatedDistribution.participants.find((x) => x.displayName === p.displayName && x.uid === p.uid) ??
                  null;

                return (
                  <div
                    key={p.id}
                    className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800 xl:grid-cols-4"
                  >
                    <input
                      value={p.displayName}
                      onChange={(e) => updateParticipant(p.id, { displayName: e.target.value })}
                      disabled={p.kind === "lawyer"}
                      placeholder={p.kind === "lawyer" ? "Abogado del estudio" : "Nombre externo"}
                      className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 disabled:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-700"
                    />

                    <input
                      type="number"
                      value={Number(p.percent ?? 0)}
                      onChange={(e) => updateParticipant(p.id, { percent: Number(e.target.value) })}
                      className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />

                    <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-black text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                      {fmtMoney(calcParticipant?.amount ?? 0, currency)}
                    </div>

                    <button
                      type="button"
                      onClick={() => removeParticipant(p.id)}
                      className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                    >
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">
                  Agregar abogado del estudio
                </div>
                <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
                  <select
                    value={lawyerToAddUid}
                    onChange={(e) => setLawyerToAddUid(e.target.value)}
                    className="min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="">Seleccionar…</option>
                    {lawyerOptions
                      .filter((l) => !participants.some((p) => p.uid === l.uid))
                      .map((l) => (
                        <option key={l.uid} value={l.uid}>
                          {l.email}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    onClick={addLawyerParticipant}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Agregar
                  </button>
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">
                  Agregar externo
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={addExternalParticipant}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Agregar externo
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStep("form")}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Anterior
            </button>

            <button
              type="button"
              onClick={saveCharge}
              disabled={saving}
              className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar cobro"}
            </button>

            <Link
              href="/cobranzas"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Cancelar
            </Link>
          </div>
        </div>
      ) : null}

      {step === "ticket" && ticketCharge ? (
        <div className="grid min-w-0 gap-4 overflow-x-hidden">
          {ticketSuccessMsg ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-700 dark:bg-green-900/30 dark:text-green-100">
              ✅ {ticketSuccessMsg}
            </div>
          ) : null}

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-lg font-black text-gray-900 dark:text-gray-100">Ticket de distribución</div>

            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Pagador</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {safeText(ticketCharge.payerRef?.displayName) || "-"}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Fecha de cobro</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtDate(ticketCharge.paidAt)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800 md:col-span-2">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Causa / motivo</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {ticketCharge.caseRef?.isExtraCase
                    ? safeText(ticketCharge.caseRef?.extraCaseReason) || "Cobro extra-caso"
                    : safeText(ticketCharge.caseRef?.caratula) || "-"}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Bruto</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(ticketCharge.distribution?.grossAmount, ticketCharge.currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Deducciones</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(ticketCharge.distribution?.deductionsTotal, ticketCharge.currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Fondo estudio</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(ticketCharge.distribution?.studioFundAmount, ticketCharge.currency)}
                </div>
              </div>

              <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">Distribuible</div>
                <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(ticketCharge.distribution?.distributableAmount, ticketCharge.currency)}
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">Participantes</div>

              <div className="mt-2 grid gap-2">
                {(ticketCharge.distribution?.participants ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800"
                  >
                    <div className="break-words text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {p.displayName}
                    </div>
                    <div className="break-words text-sm font-black text-gray-900 dark:text-gray-100">
                      {p.percent}% · {fmtMoney(p.amount, ticketCharge.currency)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
              Estado del ticket:{" "}
              <span className="font-black">
                {ticketCharge.transferTicket?.status === "done"
                  ? "Transferencias confirmadas"
                  : "Pendiente de transferencias"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {ticketCharge.transferTicket?.status !== "done" &&
            ticketCharge.ownerUid === user?.uid ? (
              <button
                type="button"
                onClick={confirmTransfersDone}
                disabled={saving}
                className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Guardando..." : "Realicé las transferencias"}
              </button>
            ) : null}

            {ticketCharge.transferTicket?.status !== "done" &&
            ticketCharge.ownerUid !== user?.uid ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-extrabold text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
                Solo quien registró el cobro puede confirmar las transferencias.
              </div>
            ) : null}

            <Link
              href="/cobranzas"
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Cerrar
            </Link>
          </div>
        </div>
      ) : null}

      <Modal
        open={createContactModalOpen}
        title="Crear contacto"
        onClose={() => setCreateContactModalOpen(false)}
      >
        {user ? (
          <ContactForm
            userUid={user.uid}
            onSaved={handleContactCreated}
            onCancel={() => setCreateContactModalOpen(false)}
            submitLabel="Guardar contacto"
            cancelLabel="Cancelar"
          />
        ) : null}
      </Modal>
    </AppShell>
  );
}