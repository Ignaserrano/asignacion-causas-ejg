"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  createScheduledCharge,
  getChargeUserNetAmount,
  getScheduledRemainingAmount,
  isRealPaidCharge,
  type ChargeCurrency,
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

type ChargeRow = {
  id: string;
  status?: "scheduled" | "paid" | "completed" | "cancelled";
  ownerUid?: string;
  visibleToUids?: string[];
  caseRef?: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase?: boolean;
    extraCaseReason?: string;
  };
  payerRef?: {
    contactId?: string | null;
    displayName?: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };
  scheduledDate?: any;
  paidAt?: any;
  currency?: ChargeCurrency;
  items?: ChargeItem[];
  totalAmount?: number;
  collectedAmount?: number;
  remainingAmount?: number;
  partialPaymentsCount?: number;
  installments?: {
    enabled?: boolean;
    total?: number;
    current?: number;
  };
  notes?: string;
  distribution?: {
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
};

function safeText(v: any) {
  return String(v ?? "").trim();
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString()} ${currency ?? ""}`.trim();
}

function fmtDate(v?: any) {
  if (!v) return "-";
  const d = v?.toDate ? v.toDate() : new Date(v);
  return d.toLocaleDateString("es-AR");
}

function fmtDateTimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function monthKeyFromDateLike(v?: any) {
  if (!v) return "";
  const d = v?.toDate ? v.toDate() : new Date(v);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function monthLabelFromKey(key: string) {
  const [yyyy, mm] = key.split("-");
  const d = new Date(Number(yyyy), Number(mm) - 1, 1);
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

function getContactFullName(c?: ContactDoc | null) {
  if (!c) return "";
  return safeText(c.fullName) || `${safeText(c.name)} ${safeText(c.lastName)}`.trim();
}

function itemTotal(items: ChargeItem[]) {
  return items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function sameMonth(dateLike: any, base: Date) {
  if (!dateLike) return false;
  const d = dateLike?.toDate ? dateLike.toDate() : new Date(dateLike);
  return d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth();
}

function approxNetForLoggedUser(params: {
  gross: number;
  participantsCount: number;
}) {
  const gross = Number(params.gross || 0);
  const participantsCount = Math.max(1, Number(params.participantsCount || 1));
  const distributable = gross * 0.85;
  return distributable / participantsCount;
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function addMonthsKeepingDay(baseDate: Date, monthsToAdd: number) {
  const originalDay = baseDate.getDate();
  const result = new Date(baseDate);
  result.setMonth(result.getMonth() + monthsToAdd);

  if (result.getDate() < originalDay) {
    result.setDate(0);
  }

  return result;
}

function splitAmountIntoInstallments(total: number, installments: number) {
  const safeTotal = round2(Number(total || 0));
  const safeInstallments = Math.max(1, Number(installments || 1));

  const base = round2(safeTotal / safeInstallments);
  const values: number[] = [];

  let accumulated = 0;
  for (let i = 0; i < safeInstallments; i++) {
    if (i < safeInstallments - 1) {
      values.push(base);
      accumulated = round2(accumulated + base);
    } else {
      values.push(round2(safeTotal - accumulated));
    }
  }

  return values;
}

function splitItemsAcrossInstallments(items: ChargeItem[], installments: number): ChargeItem[][] {
  const totalInstallments = Math.max(1, Number(installments || 1));

  const perInstallmentItems: ChargeItem[][] = Array.from({ length: totalInstallments }, () => []);

  for (const item of items) {
    const itemAmount = round2(Number(item.amount || 0));
    const itemSplits = splitAmountIntoInstallments(itemAmount, totalInstallments);

    for (let i = 0; i < totalInstallments; i++) {
      perInstallmentItems[i].push({
        ...item,
        id: makeId(),
        amount: itemSplits[i],
      });
    }
  }

  return perInstallmentItems;
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
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto overflow-x-hidden rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
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

export default function CobranzasPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [loadingData, setLoadingData] = useState(true);

  const [myCases, setMyCases] = useState<MainCaseRow[]>([]);
  const [lawyerOptions, setLawyerOptions] = useState<LawyerOption[]>([]);
  const [scheduledCharges, setScheduledCharges] = useState<ChargeRow[]>([]);
  const [paidCharges, setPaidCharges] = useState<ChargeRow[]>([]);
  const [pendingTransferCharges, setPendingTransferCharges] = useState<ChargeRow[]>([]);

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [savingScheduled, setSavingScheduled] = useState(false);

  const [originType, setOriginType] = useState<"case" | "extra">("case");
  const [selectedCaseId, setSelectedCaseId] = useState("");
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
  const [scheduledDateInput, setScheduledDateInput] = useState(fmtDateTimeInput(new Date()));
  const [notes, setNotes] = useState("");

  const [installmentsEnabled, setInstallmentsEnabled] = useState(false);
  const [installmentsTotal, setInstallmentsTotal] = useState<number | "">("");

  const [sharedLawyerUids, setSharedLawyerUids] = useState<string[]>([]);
  const [lawyerToAddUid, setLawyerToAddUid] = useState("");

  const selectedCase = useMemo(
    () => myCases.find((c) => c.id === selectedCaseId) ?? null,
    [myCases, selectedCaseId]
  );

  const currentMonthPaidCharges = useMemo(() => {
    const now = new Date();
    return paidCharges.filter((c) => sameMonth(c.paidAt, now));
  }, [paidCharges]);

  const currentMonthNetTotal = useMemo(() => {
    return currentMonthPaidCharges.reduce(
      (sum, c) => sum + getChargeUserNetAmount(c, user?.uid),
      0
    );
  }, [currentMonthPaidCharges, user?.uid]);

  const upcomingByMonth = useMemo(() => {
    const map = new Map<
      string,
      {
        monthKey: string;
        monthLabel: string;
        grossTotal: number;
        approxNetTotal: number;
        rows: Array<
          ChargeRow & {
            approxParticipantsCount: number;
            approxNetForUser: number;
          }
        >;
      }
    >();

    const sorted = [...scheduledCharges].sort((a, b) => {
      const da = a.scheduledDate?.toDate ? a.scheduledDate.toDate().getTime() : 0;
      const db = b.scheduledDate?.toDate ? b.scheduledDate.toDate().getTime() : 0;
      return da - db;
    });

    for (const row of sorted) {
      const key = monthKeyFromDateLike(row.scheduledDate);
      if (!key) continue;

      const sharedCount = Array.isArray(row.visibleToUids)
        ? row.visibleToUids.filter(Boolean).length
        : 1;

      const participantsCount = Math.max(1, sharedCount);
      const gross = Number(row.remainingAmount ?? row.totalAmount ?? 0);
      const approxNet = approxNetForLoggedUser({
        gross,
        participantsCount,
      });

      if (!map.has(key)) {
        map.set(key, {
          monthKey: key,
          monthLabel: monthLabelFromKey(key),
          grossTotal: 0,
          approxNetTotal: 0,
          rows: [],
        });
      }

      const group = map.get(key)!;
      group.rows.push({
        ...row,
        approxParticipantsCount: participantsCount,
        approxNetForUser: approxNet,
      });
      group.grossTotal += gross;
      group.approxNetTotal += approxNet;
    }

    return Array.from(map.values());
  }, [scheduledCharges]);

  const grossScheduledDraft = useMemo(() => itemTotal(items), [items]);

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
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando shell");
      } finally {
        setLoadingShell(false);
      }
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    (async () => {
      if (!user) return;

      setLoadingData(true);
      try {
        const qCases = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", user.uid),
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
          where("visibleToUids", "array-contains", user.uid),
          where("status", "==", "scheduled"),
          orderBy("scheduledDate", "asc"),
          limit(300)
        );
        const scheduledSnap = await getDocs(qScheduled);
        setScheduledCharges(
          scheduledSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ChargeRow[]
        );

        const qPaid = query(
          collection(db, "charges"),
          where("visibleToUids", "array-contains", user.uid),
          where("status", "==", "paid"),
          orderBy("paidAt", "desc"),
          limit(300)
        );
        const paidSnap = await getDocs(qPaid);
        const paidRows = paidSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((row) => isRealPaidCharge(row)) as ChargeRow[];

        setPaidCharges(paidRows);

        const pendingTransfers = paidRows.filter(
          (c) => c.transferTicket?.status === "pending"
        );

        setPendingTransferCharges(pendingTransfers);
      } catch (e: any) {
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando cobranzas"));
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user]);

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
    if (!user) return;

    if (originType !== "case" || !selectedCaseId || !selectedCase) {
      setSharedLawyerUids([]);
      return;
    }

    const caseLawyers = Array.isArray(selectedCase.confirmedAssigneesUids)
      ? selectedCase.confirmedAssigneesUids.filter(Boolean)
      : [];

    const autoShared = caseLawyers.filter((uid) => uid !== user.uid);
    setSharedLawyerUids(Array.from(new Set(autoShared)));
  }, [originType, selectedCaseId, selectedCase, user]);

  function refreshScheduledListLocally(rows: ChargeRow[]) {
    setScheduledCharges(rows);
  }

  function resetScheduleForm() {
    setOriginType("case");
    setSelectedCaseId("");
    setExtraCaseReason("");
    setSelectedContact(null);
    setContactQuery("");
    setContactResults([]);
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
    setScheduledDateInput(fmtDateTimeInput(new Date()));
    setNotes("");
    setInstallmentsEnabled(false);
    setInstallmentsTotal("");
    setSharedLawyerUids([]);
    setLawyerToAddUid("");
  }

  function openScheduleModal() {
    resetScheduleForm();
    setScheduleModalOpen(true);
  }

  function selectContact(c: ContactDoc) {
    setSelectedContact(c);
    setContactQuery(getContactFullName(c));
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

  function addSharedLawyer() {
    if (!lawyerToAddUid) return;
    if (sharedLawyerUids.includes(lawyerToAddUid)) {
      alert("Ese abogado ya fue agregado.");
      return;
    }
    setSharedLawyerUids((prev) => [...prev, lawyerToAddUid]);
    setLawyerToAddUid("");
  }

  function removeSharedLawyer(uid: string) {
    setSharedLawyerUids((prev) => prev.filter((x) => x !== uid));
  }

  async function saveScheduledCharge() {
    if (!user) return;

    if (originType === "case" && !selectedCaseId) {
      alert("Seleccioná una causa.");
      return;
    }

    if (originType === "extra" && !safeText(extraCaseReason)) {
      alert("Ingresá el motivo del cobro extra-caso.");
      return;
    }

    if (!selectedContact || !getContactFullName(selectedContact)) {
      alert("Seleccioná quién debe pagar.");
      return;
    }

    const validItems = items
      .map((x) => ({
        ...x,
        amount:
          x.amount === ("" as unknown as number)
            ? ("" as unknown as number)
            : Number(x.amount),
      }))
      .filter((x) => Number(x.amount) > 0);

    if (validItems.length === 0) {
      alert("Ingresá al menos un rubro con monto mayor a cero.");
      return;
    }

    if (installmentsEnabled && (!installmentsTotal || Number(installmentsTotal) < 1)) {
      alert("Ingresá la cantidad de cuotas.");
      return;
    }

    const caseParticipantUids =
      originType === "case" ? selectedCase?.confirmedAssigneesUids ?? [] : [];

    const visibleToUids = Array.from(
      new Set([user.uid, ...caseParticipantUids, ...sharedLawyerUids].filter(Boolean))
    ) as string[];

    setSavingScheduled(true);

    try {
      const baseScheduledDate = new Date(scheduledDateInput);

      if (installmentsEnabled) {
        const totalInstallments = Math.max(1, Number(installmentsTotal || 1));
        const itemsPerInstallment = splitItemsAcrossInstallments(validItems, totalInstallments);

        for (let i = 0; i < totalInstallments; i++) {
          const installmentDate = addMonthsKeepingDay(baseScheduledDate, i);

          await createScheduledCharge({
            ownerUid: user.uid,
            ownerEmail: user.email ?? "",
            visibleToUids,
            caseId: originType === "case" ? selectedCaseId : undefined,
            caratula: originType === "case" ? safeText(selectedCase?.caratulaTentativa) : undefined,
            extraCaseReason: originType === "extra" ? safeText(extraCaseReason) : undefined,
            payer: {
              contactId: safeText(selectedContact.id) || undefined,
              displayName: getContactFullName(selectedContact),
              email: safeText(selectedContact.email),
              phone: safeText(selectedContact.phone),
              cuit: safeText(selectedContact.cuit),
            },
            items: itemsPerInstallment[i],
            scheduledDate: installmentDate,
            currency,
            installments: {
              enabled: true,
              total: totalInstallments,
              current: i + 1,
            },
            notes: safeText(notes),
          });
        }
      } else {
        await createScheduledCharge({
          ownerUid: user.uid,
          ownerEmail: user.email ?? "",
          visibleToUids,
          caseId: originType === "case" ? selectedCaseId : undefined,
          caratula: originType === "case" ? safeText(selectedCase?.caratulaTentativa) : undefined,
          extraCaseReason: originType === "extra" ? safeText(extraCaseReason) : undefined,
          payer: {
            contactId: safeText(selectedContact.id) || undefined,
            displayName: getContactFullName(selectedContact),
            email: safeText(selectedContact.email),
            phone: safeText(selectedContact.phone),
            cuit: safeText(selectedContact.cuit),
          },
          items: validItems,
          scheduledDate: baseScheduledDate,
          currency,
          installments: { enabled: false },
          notes: safeText(notes),
        });
      }

      if (user) {
        const qScheduled = query(
          collection(db, "charges"),
          where("visibleToUids", "array-contains", user.uid),
          where("status", "==", "scheduled"),
          orderBy("scheduledDate", "asc"),
          limit(300)
        );
        const scheduledSnap = await getDocs(qScheduled);
        refreshScheduledListLocally(
          scheduledSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ChargeRow[]
        );
      }

      setScheduleModalOpen(false);
      resetScheduleForm();
    } catch (e: any) {
      alert(e?.message ?? "No se pudo guardar el cobro previsto.");
    } finally {
      setSavingScheduled(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Mis cobros"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Mis cobros" },
      ]}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loadingShell || loadingData ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/cobranzas/registrar"
          className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90"
        >
          Registrar nuevo cobro
        </Link>

        <button
          type="button"
          onClick={openScheduleModal}
          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          Agendar próximo cobro
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Cobros realizados en el mes
            </div>
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              Neto propio: {fmtMoney(currentMonthNetTotal, currentMonthPaidCharges[0]?.currency ?? "")}
            </div>
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {currentMonthPaidCharges.length === 0 ? (
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                No registraste cobros este mes.
              </div>
            ) : (
              currentMonthPaidCharges.slice(0, 10).map((c) => (
                <div key={c.id} className="py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                        {safeText(c.payerRef?.displayName) || "(sin pagador)"}
                      </div>
                      <div className="break-words text-xs text-gray-600 dark:text-gray-300">
                        {c.caseRef?.isExtraCase
                          ? safeText(c.caseRef?.extraCaseReason) || "Cobro extra-caso"
                          : safeText(c.caseRef?.caratula) || "Sin causa"}
                        {" · "}
                        {fmtDate(c.paidAt)}
                      </div>
                    </div>

                    <div className="shrink-0 whitespace-nowrap text-right text-sm font-black text-gray-900 dark:text-gray-100">
                      {fmtMoney(getChargeUserNetAmount(c, user?.uid), c.currency)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4">
            <Link
              href="/cobranzas/realizadas"
              className="inline-flex rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Ver histórico de cobros
            </Link>
          </div>
        </div>

        <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Transferencias pendientes
            </div>
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              {pendingTransferCharges.length} pendiente(s)
            </div>
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {pendingTransferCharges.length === 0 ? (
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                No hay transferencias pendientes.
              </div>
            ) : (
              pendingTransferCharges.slice(0, 10).map((c) => (
                <div key={c.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                        {safeText(c.payerRef?.displayName) || "(sin pagador)"}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {c.caseRef?.isExtraCase
                          ? safeText(c.caseRef?.extraCaseReason) || "Cobro extra-caso"
                          : safeText(c.caseRef?.caratula) || "Sin causa"}
                      </div>
                    </div>

                    <Link
                      href={`/cobranzas/registrar?ticket=${c.id}`}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      Ver ticket
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Próximos cobros
          </div>
          <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
            Agrupados por mes
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          {upcomingByMonth.length === 0 ? (
            <div className="text-sm text-gray-700 dark:text-gray-200">
              No hay cobros agendados.
            </div>
          ) : (
            upcomingByMonth.map((group) => (
              <div
                key={group.monthKey}
                className="rounded-xl border border-gray-200 dark:border-gray-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/40">
                  <div className="text-sm font-black capitalize text-gray-900 dark:text-gray-100">
                    {group.monthLabel}
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm font-black text-gray-900 dark:text-gray-100">
                    <div>
                      Total bruto del mes:{" "}
                      <span>{fmtMoney(group.grossTotal, group.rows[0]?.currency ?? "")}</span>
                    </div>
                    <div>
                      Total neto aprox.:{" "}
                      <span>{fmtMoney(group.approxNetTotal, group.rows[0]?.currency ?? "")}</span>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {group.rows.map((c) => {
                    const pendingAmount = getScheduledRemainingAmount(c);
                    return (
                      <div key={c.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                              {safeText(c.payerRef?.displayName) || "(sin pagador)"}
                            </div>

                            <div className="mt-1 break-words text-xs text-gray-600 dark:text-gray-300">
                              Fecha probable: {fmtDate(c.scheduledDate)}
                              {" · "}
                              {c.caseRef?.isExtraCase
                                ? safeText(c.caseRef?.extraCaseReason) || "Cobro extra-caso"
                                : safeText(c.caseRef?.caratula) || "Sin causa"}
                              {" · "}
                              Pendiente: {fmtMoney(pendingAmount, c.currency)}
                              {" · "}
                              Neto aprox.: {fmtMoney(c.approxNetForUser, c.currency)}
                              {c.installments?.enabled && c.installments?.total
                                ? ` · Cuota ${c.installments.current ?? "?"} de ${c.installments.total}`
                                : ""}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/cobranzas/registrar?scheduledId=${c.id}`}
                              className="rounded-xl bg-black px-3 py-2 text-xs font-extrabold text-white hover:opacity-90"
                            >
                              Registrar este pago
                            </Link>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        open={scheduleModalOpen}
        title="Agendar próximo cobro"
        onClose={() => setScheduleModalOpen(false)}
      >
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
                Cobro de una causa en la que participo
              </label>

              {originType === "case" ? (
                <select
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
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
                  placeholder="Ej: consulta, participación en audiencia, gestión puntual"
                  className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              ) : null}
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">Quién debe pagar</div>

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

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">Rubros del cobro previsto</div>
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
                    placeholder="Monto"
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
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Fecha probable de cobro
                  </span>
                  <input
                    type="datetime-local"
                    value={scheduledDateInput}
                    onChange={(e) => setScheduledDateInput(e.target.value)}
                    className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>

                <div className="grid min-w-0 gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Total previsto</span>
                  <div className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-black text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                    {fmtMoney(grossScheduledDraft, currency)}
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={installmentsEnabled}
                    onChange={(e) => setInstallmentsEnabled(e.target.checked)}
                  />
                  Se cobrará en cuotas mensuales
                </label>

                {installmentsEnabled ? (
                  <label className="grid min-w-0 gap-1 md:max-w-xs">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Número de cuotas mensuales
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={installmentsTotal}
                      onChange={(e) =>
                        setInstallmentsTotal(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                ) : null}

                {installmentsEnabled && Number(installmentsTotal || 0) > 0 ? (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100">
                    Se crearán {Number(installmentsTotal)} cobros agendados: el primero en la fecha indicada y los siguientes cada mes. El monto total se dividirá automáticamente entre todas las cuotas.
                  </div>
                ) : null}

                <label className="grid min-w-0 gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Observaciones
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[90px] min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Compartir este cobro con otros abogados
            </div>

            <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
              Si elegís una causa, acá ya aparecen automáticamente los abogados que comparten esa causa con vos.
            </div>

            <div className="mt-3 flex min-w-0 flex-col gap-2 sm:flex-row">
              <select
                value={lawyerToAddUid}
                onChange={(e) => setLawyerToAddUid(e.target.value)}
                className="min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="">Seleccionar abogado…</option>
                {lawyerOptions
                  .filter((l) => l.uid !== user?.uid)
                  .filter((l) => !sharedLawyerUids.includes(l.uid))
                  .map((l) => (
                    <option key={l.uid} value={l.uid}>
                      {l.email}
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={addSharedLawyer}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Agregar
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {sharedLawyerUids.length === 0 ? (
                <div className="text-sm text-gray-700 dark:text-gray-200">
                  No hay otros abogados agregados.
                </div>
              ) : (
                sharedLawyerUids.map((uid) => {
                  const found = lawyerOptions.find((l) => l.uid === uid);
                  return (
                    <div
                      key={uid}
                      className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-black text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <span>{found?.email ?? uid}</span>
                      <button
                        type="button"
                        onClick={() => removeSharedLawyer(uid)}
                        className="text-red-700 dark:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={saveScheduledCharge}
              disabled={savingScheduled}
              className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingScheduled ? "Guardando..." : "Guardar"}
            </button>

            <button
              type="button"
              onClick={() => setScheduleModalOpen(false)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      </Modal>

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