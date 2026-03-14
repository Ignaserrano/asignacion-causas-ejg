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
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import ContactForm, { CreatedContact } from "@/components/contacts/ContactForm";
import ScrollToTopButton from "@/components/ScrollToTopButton";
import {
  addConsultationInteraction,
  closeConsultation,
  ConsultationInteractionRow,
  ConsultationRow,
  createConsultation,
  rederiveConsultation,
  requestConsultationDerivation,
  respondConsultationDerivation,
} from "@/lib/consultations";
import { createCalendarEvent } from "@/lib/events";

type ContactDoc = {
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

type UserDoc = {
  email?: string;
  role?: string;
};

type LawyerOption = {
  uid: string;
  email: string;
};

type SortMode = "fecha_desc" | "fecha_asc";
type NewConsultationFlowMode = "initial" | "take" | "derive";

function safeText(v: any) {
  return String(v ?? "").trim();
}

function safeLower(v: any) {
  return safeText(v).toLowerCase();
}

function getContactFullName(c?: ContactDoc | null) {
  if (!c) return "";
  return safeText(c.fullName) || `${safeText(c.name)} ${safeText(c.lastName)}`.trim();
}

function toDate(value?: any) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateTime(value?: any) {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleString("es-AR", { hour12: false });
}

function shortText(v?: string, max = 90) {
  const s = safeText(v);
  if (s.length <= max) return s;
  return `${s.slice(0, max).trim()}…`;
}

function normalizePhoneForWhatsApp(phone?: string) {
  const digits = safeText(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("54")) return digits;
  return `54${digits}`;
}

function buildWhatsAppLink(phone?: string) {
  const normalized = normalizePhoneForWhatsApp(phone);
  return normalized ? `https://wa.me/${normalized}` : "";
}

function normalizeMailto(email?: string) {
  const v = safeText(email);
  return v ? `mailto:${v}` : "";
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
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
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

export default function ConsultationsPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);
  const [pendingConsultationDerivations, setPendingConsultationDerivations] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<ConsultationRow[]>([]);
  const [lawyers, setLawyers] = useState<LawyerOption[]>([]);

  const [filterText, setFilterText] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("fecha_desc");
  const [showClosed, setShowClosed] = useState(false);
  const [showDerivedInMain, setShowDerivedInMain] = useState(false);

  const [newModalOpen, setNewModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedRow, setSelectedRow] = useState<ConsultationRow | null>(null);

  const [interactions, setInteractions] = useState<ConsultationInteractionRow[]>([]);
  const [interactionsLoading, setInteractionsLoading] = useState(false);

  const [subject, setSubject] = useState("");
  const [summary, setSummary] = useState("");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpAt, setFollowUpAt] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const [newConsultationFlowMode, setNewConsultationFlowMode] =
    useState<NewConsultationFlowMode>("initial");
  const [newConsultationDeriveTargetUid, setNewConsultationDeriveTargetUid] = useState("");

  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<Array<{ id: string } & ContactDoc>>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [contactFocused, setContactFocused] = useState(false);
  const [contactSelectedIndex, setContactSelectedIndex] = useState(0);
  const [selectedContact, setSelectedContact] = useState<({ id: string } & ContactDoc) | null>(
    null
  );

  const [createContactModalOpen, setCreateContactModalOpen] = useState(false);

  const [newInteractionOpen, setNewInteractionOpen] = useState(false);
  const [newInteractionTitle, setNewInteractionTitle] = useState("");
  const [newInteractionBody, setNewInteractionBody] = useState("");
  const [savingInteraction, setSavingInteraction] = useState(false);

  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closeResult, setCloseResult] = useState("");
  const [closingConsultation, setClosingConsultation] = useState(false);

  const [deriveModalOpen, setDeriveModalOpen] = useState(false);
  const [deriveTargetUid, setDeriveTargetUid] = useState("");
  const [deriveSaving, setDeriveSaving] = useState(false);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [rederiveTargetById, setRederiveTargetById] = useState<Record<string, string>>({});
  const [rederivingId, setRederivingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setLoading(true);
      setMsg(null);

      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));

        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const pendingSnap = await getDocs(qPending);
        setPendingInvites(pendingSnap.size);

        const qUsers = query(collection(db, "users"), orderBy("email", "asc"));
        const usersSnap = await getDocs(qUsers);
        const lawyerRows = usersSnap.docs
          .map((d) => ({
            uid: d.id,
            ...(d.data() as UserDoc),
          }))
          .filter((x) => ["abogado", "lawyer", "admin"].includes(safeText(x.role)))
          .map((x) => ({
            uid: x.uid,
            email: safeText(x.email),
          }))
          .filter((x) => x.uid && x.email);
        setLawyers(lawyerRows);

        const qConsultations = query(
          collection(db, "consultations"),
          where("visibleToUids", "array-contains", u.uid),
          orderBy("createdAt", "desc"),
          limit(500)
        );
        const snap = await getDocs(qConsultations);
        const consultationRows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ConsultationRow[];
        setRows(consultationRows);

        const pendingDerivations = consultationRows.filter(
          (r) =>
            safeText((r as any).derivation?.toUid) === u.uid &&
            safeText((r as any).derivation?.status) === "pending"
        );
        setPendingConsultationDerivations(pendingDerivations.length);
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando consultas.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const qText = safeLower(contactQuery);
      if (qText.length < 2) {
        setContactResults([]);
        setContactLoading(false);
        return;
      }

      setContactLoading(true);

      try {
        const snap = await getDocs(
          query(collection(db, "contacts"), orderBy("nameLower", "asc"), limit(200))
        );

        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Array<
          { id: string } & ContactDoc
        >;

        const tokens = qText.split(/\s+/).filter(Boolean);
        const filtered = all.filter((c) => {
          const full = safeLower(getContactFullName(c));
          return tokens.every((t) => full.includes(t));
        });

        if (!alive) return;
        setContactResults(filtered.slice(0, 10));
        setContactSelectedIndex(0);
      } catch {
        if (!alive) return;
        setContactResults([]);
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
    if (!selectedRow || !detailModalOpen) {
      setInteractions([]);
      return;
    }

    setInteractionsLoading(true);

    const unsub = onSnapshot(
      query(
        collection(db, "consultations", selectedRow.id, "interactions"),
        orderBy("createdAt", "desc")
      ),
      (snap) => {
        const loaded = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ConsultationInteractionRow[];
        setInteractions(loaded);
        setInteractionsLoading(false);
      },
      () => {
        setInteractions([]);
        setInteractionsLoading(false);
      }
    );

    return () => unsub();
  }, [selectedRow, detailModalOpen]);

  const openRows = useMemo(() => {
    const now = Date.now();

    return rows.filter((r) => {
      if (safeText(r.status) === "closed" && !showClosed) return false;

      const derivationStatus = safeText((r as any).derivation?.status);
      const fromUid = safeText((r as any).derivation?.fromUid);
      const acceptedVisibleUntil = toDate((r as any).derivation?.acceptedVisibleUntil);

      const hiddenAccepted =
        derivationStatus === "accepted" &&
        fromUid === user?.uid &&
        acceptedVisibleUntil &&
        acceptedVisibleUntil.getTime() < now;

      if (hiddenAccepted) return false;

      return true;
    });
  }, [rows, showClosed, user?.uid]);

  const incomingDerived = useMemo(() => {
    return openRows.filter(
      (r) =>
        safeText((r as any).derivation?.toUid) === user?.uid &&
        safeText((r as any).derivation?.status) === "pending"
    );
  }, [openRows, user?.uid]);

  const derivedByMe = useMemo(() => {
    const now = Date.now();

    return openRows.filter((r) => {
      const derivation = (r as any).derivation ?? {};
      if (safeText(derivation.fromUid) !== user?.uid) return false;

      const status = safeText(derivation.status);
      if (status === "pending" || status === "rejected") return true;

      if (status === "accepted") {
        const visibleUntil = toDate(derivation.acceptedVisibleUntil);
        return visibleUntil ? visibleUntil.getTime() >= now : true;
      }

      return false;
    });
  }, [openRows, user?.uid]);

  const mainRows = useMemo(() => {
    const term = safeLower(filterText);

    let filtered = openRows.filter((r) => {
      const displayName = safeLower(r.contactRef?.displayName);
      const phone = safeLower(r.contactRef?.phone);
      const email = safeLower(r.contactRef?.email);
      const subjectText = safeLower(r.subject);
      const summaryText = safeLower(r.summary);

      if (term) {
        const matches =
          displayName.includes(term) ||
          phone.includes(term) ||
          email.includes(term) ||
          subjectText.includes(term) ||
          summaryText.includes(term);
        if (!matches) return false;
      }

      const derivationStatus = safeText((r as any).derivation?.status);
      const fromUid = safeText((r as any).derivation?.fromUid);
      const toUid = safeText((r as any).derivation?.toUid);

      const isIncomingHiddenForReceiver =
  toUid === user?.uid &&
  ["pending", "rejected"].includes(derivationStatus);

if (isIncomingHiddenForReceiver) return false;

      const isDerivedByMe =
        fromUid === user?.uid &&
        ["pending", "accepted", "rejected"].includes(derivationStatus);

      if (!showDerivedInMain && isDerivedByMe) return false;

      return true;
    });

    filtered = filtered.sort((a, b) => {
      const aa = toDate(a.openedAt)?.getTime() ?? 0;
      const bb = toDate(b.openedAt)?.getTime() ?? 0;
      return sortMode === "fecha_asc" ? aa - bb : bb - aa;
    });

    return filtered;
  }, [openRows, filterText, sortMode, user?.uid, showDerivedInMain]);

  function resetNewForm() {
    setSubject("");
    setSummary("");
    setFollowUpEnabled(false);
    setFollowUpAt("");
    setContactQuery("");
    setContactResults([]);
    setSelectedContact(null);
    setNewConsultationFlowMode("initial");
    setNewConsultationDeriveTargetUid("");
  }

  function validateNewConsultationBase() {
    if (!selectedContact) {
      alert("Seleccioná o creá un consultante.");
      return false;
    }

    if (!safeText(subject)) {
      alert("Ingresá el tema o asunto de la consulta.");
      return false;
    }

    if (!safeText(summary)) {
      alert("Ingresá las notas o resumen de la consulta.");
      return false;
    }

    return true;
  }

  function goToTakeMode() {
    if (!validateNewConsultationBase()) return;
    setNewConsultationFlowMode("take");
    setNewConsultationDeriveTargetUid("");
  }

  function goToDeriveMode() {
    if (!validateNewConsultationBase()) return;
    setNewConsultationFlowMode("derive");
    setFollowUpEnabled(false);
    setFollowUpAt("");
  }

  function backToInitialNewConsultationMode() {
    setNewConsultationFlowMode("initial");
    setFollowUpEnabled(false);
    setFollowUpAt("");
    setNewConsultationDeriveTargetUid("");
  }

  function selectContact(c: { id: string } & ContactDoc) {
    setSelectedContact(c);
    setContactQuery(getContactFullName(c));
    setContactResults([]);
    setContactSelectedIndex(0);
  }

  function clearSelectedContact() {
    setSelectedContact(null);
    setContactQuery("");
    setContactResults([]);
    setContactSelectedIndex(0);
  }

  function handleContactSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (contactResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setContactSelectedIndex((prev) => (prev + 1 >= contactResults.length ? 0 : prev + 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setContactSelectedIndex((prev) =>
        prev - 1 < 0 ? contactResults.length - 1 : prev - 1
      );
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const picked = contactResults[Math.min(contactSelectedIndex, contactResults.length - 1)];
      if (picked) selectContact(picked);
    }
  }

  function handleContactCreated(contact: CreatedContact) {
    const created = {
      id: contact.id,
      fullName: contact.fullName,
      name: contact.fullName,
    } as { id: string } & ContactDoc;

    setCreateContactModalOpen(false);
    selectContact(created);
  }

  async function reloadConsultations(uid: string) {
    const qConsultations = query(
      collection(db, "consultations"),
      where("visibleToUids", "array-contains", uid),
      orderBy("createdAt", "desc"),
      limit(500)
    );
    const snap = await getDocs(qConsultations);
    const consultationRows = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as any),
    })) as ConsultationRow[];
    setRows(consultationRows);

    const pendingDerivations = consultationRows.filter(
      (r) =>
        safeText((r as any).derivation?.toUid) === uid &&
        safeText((r as any).derivation?.status) === "pending"
    );
    setPendingConsultationDerivations(pendingDerivations.length);
  }

  async function saveNewConsultation() {
    if (!user) return;
    if (!validateNewConsultationBase()) return;

    let followUpEventId: string | null = null;
    let followUpTimestamp: Timestamp | null = null;

    if (followUpEnabled) {
      const d = new Date(followUpAt);
      if (Number.isNaN(d.getTime())) {
        alert("La fecha de seguimiento no es válida.");
        return;
      }

      followUpEventId = await createCalendarEvent({
        title: `[Consulta] Seguimiento: ${safeText(subject)}`,
        description: safeText(summary),
        startAt: d,
        visibility: "private",
        ownerUid: user.uid,
        ownerEmail: user.email ?? "",
        source: "manual",
        autoGenerated: true,
        autoType: "consultation_followup",
        color: "#14b8a6",
        status: "active",
      });

      followUpTimestamp = Timestamp.fromDate(d);
    }

    setSavingNew(true);
    setMsg(null);

    try {
      await createConsultation({
        contactRef: {
          contactId: selectedContact!.id,
          displayName: getContactFullName(selectedContact),
          email: safeText(selectedContact?.email),
          phone: safeText(selectedContact?.phone),
        },
        subject: safeText(subject),
        summary: safeText(summary),
        openedByUid: user.uid,
        openedByEmail: user.email ?? "",
        ownerUid: user.uid,
        ownerEmail: user.email ?? "",
        visibleToUids: [user.uid],
        followUp: {
          scheduled: followUpEnabled,
          eventId: followUpEventId,
          at: followUpTimestamp,
          createdByUid: user.uid,
          createdByEmail: user.email ?? "",
        },
      });

      await reloadConsultations(user.uid);
      setNewModalOpen(false);
      resetNewForm();
      setMsg("✅ Consulta guardada correctamente.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo guardar la consulta.");
    } finally {
      setSavingNew(false);
    }
  }

  async function saveAndDeriveNewConsultation() {
    if (!user) return;
    if (!validateNewConsultationBase()) return;

    if (!newConsultationDeriveTargetUid) {
      alert("Seleccioná un abogado para derivar.");
      return;
    }

    const derivationTarget = lawyers.find((x) => x.uid === newConsultationDeriveTargetUid);
    if (!derivationTarget) {
      alert("No encontré al abogado seleccionado.");
      return;
    }

    setSavingNew(true);
    setMsg(null);

    try {
      const consultationId = await createConsultation({
        contactRef: {
          contactId: selectedContact!.id,
          displayName: getContactFullName(selectedContact),
          email: safeText(selectedContact?.email),
          phone: safeText(selectedContact?.phone),
        },
        subject: safeText(subject),
        summary: safeText(summary),
        openedByUid: user.uid,
        openedByEmail: user.email ?? "",
        ownerUid: user.uid,
        ownerEmail: user.email ?? "",
        visibleToUids: [user.uid, derivationTarget.uid],
        followUp: {
          scheduled: false,
          eventId: null,
          at: null,
          createdByUid: "",
          createdByEmail: "",
        },
      });

      await requestConsultationDerivation({
        consultationId,
        fromUid: user.uid,
        fromEmail: user.email ?? "",
        toUid: derivationTarget.uid,
        toEmail: derivationTarget.email,
      });

      await reloadConsultations(user.uid);
      setNewModalOpen(false);
      resetNewForm();
      setMsg("✅ Consulta guardada y derivada correctamente.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo guardar y derivar la consulta.");
    } finally {
      setSavingNew(false);
    }
  }

  async function saveInteraction() {
    if (!user || !selectedRow) return;

    if (!safeText(newInteractionTitle)) {
      alert("Ingresá un título.");
      return;
    }

    setSavingInteraction(true);
    try {
      await addConsultationInteraction({
        consultationId: selectedRow.id,
        type: "seguimiento",
        title: safeText(newInteractionTitle),
        body: safeText(newInteractionBody),
        createdByUid: user.uid,
        createdByEmail: user.email ?? "",
      });

      setNewInteractionTitle("");
      setNewInteractionBody("");
      setNewInteractionOpen(false);
    } catch (e: any) {
      alert(e?.message ?? "No se pudo guardar la interacción.");
    } finally {
      setSavingInteraction(false);
    }
  }

  async function saveCloseConsultation() {
    if (!user || !selectedRow) return;

    if (!safeText(closeResult)) {
      alert("Ingresá el resultado del cierre.");
      return;
    }

    setClosingConsultation(true);
    try {
      await closeConsultation({
        consultationId: selectedRow.id,
        result: safeText(closeResult),
        uid: user.uid,
        email: user.email ?? "",
      });

      await reloadConsultations(user.uid);
      setCloseResult("");
      setCloseModalOpen(false);
      setDetailModalOpen(false);
      setSelectedRow(null);
      setMsg("✅ Consulta cerrada.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo cerrar la consulta.");
    } finally {
      setClosingConsultation(false);
    }
  }

  async function saveDerivation() {
    if (!user || !selectedRow) return;

    if (!deriveTargetUid) {
      alert("Seleccioná un abogado.");
      return;
    }

    const target = lawyers.find((x) => x.uid === deriveTargetUid);
    if (!target) {
      alert("No encontré al abogado seleccionado.");
      return;
    }

    setDeriveSaving(true);
    try {
      await requestConsultationDerivation({
        consultationId: selectedRow.id,
        fromUid: user.uid,
        fromEmail: user.email ?? "",
        toUid: target.uid,
        toEmail: target.email,
      });

      await reloadConsultations(user.uid);
      setDeriveModalOpen(false);
      setDeriveTargetUid("");
      setDetailModalOpen(false);
      setSelectedRow(null);
      setMsg("✅ Consulta derivada correctamente.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo derivar la consulta.");
    } finally {
      setDeriveSaving(false);
    }
  }

  async function acceptIncoming(row: ConsultationRow) {
    if (!user) return;

    setAcceptingId(row.id);
    try {
      await respondConsultationDerivation({
        consultationId: row.id,
        decision: "accepted",
        uid: user.uid,
        email: user.email ?? "",
      });

      await reloadConsultations(user.uid);
      setMsg("✅ Derivación aceptada.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo aceptar la derivación.");
    } finally {
      setAcceptingId(null);
    }
  }

  async function rejectIncoming(row: ConsultationRow) {
    if (!user) return;

    setRejectingId(row.id);
    try {
      await respondConsultationDerivation({
        consultationId: row.id,
        decision: "rejected",
        uid: user.uid,
        email: user.email ?? "",
      });

      await reloadConsultations(user.uid);
      setMsg("✅ Derivación rechazada.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo rechazar la derivación.");
    } finally {
      setRejectingId(null);
    }
  }

  async function doRederive(row: ConsultationRow) {
    if (!user) return;

    const targetUid = safeText(rederiveTargetById[row.id]);
    if (!targetUid) {
      alert("Seleccioná un abogado.");
      return;
    }

    const target = lawyers.find((x) => x.uid === targetUid);
    if (!target) {
      alert("No encontré al abogado seleccionado.");
      return;
    }

    setRederivingId(row.id);
    try {
      await rederiveConsultation({
        consultationId: row.id,
        fromUid: user.uid,
        fromEmail: user.email ?? "",
        toUid: target.uid,
        toEmail: target.email,
      });

      await reloadConsultations(user.uid);
      setMsg("✅ Consulta re-derivada.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo re-derivar la consulta.");
    } finally {
      setRederivingId(null);
    }
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Gestión de consultas"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      pendingConsultationDerivations={pendingConsultationDerivations}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Gestión de consultas" },
      ]}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black text-gray-900 dark:text-gray-100">
            Gestión de consultas
          </div>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            Registrá consultas, hacé seguimiento, derivá y cerrá con resultado.
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            resetNewForm();
            setNewModalOpen(true);
          }}
          className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90"
        >
          Nueva consulta
        </button>
      </div>

      <div className="grid gap-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid gap-3 lg:grid-cols-4">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Filtrar
              </span>
              <input
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Consultante, teléfono, email, asunto o resumen"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Orden
              </span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="fecha_desc">Más recientes primero</option>
                <option value="fecha_asc">Más antiguas primero</option>
              </select>
            </label>

            <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
              />
              Mostrar cerradas
            </label>

            <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
              <input
                type="checkbox"
                checked={showDerivedInMain}
                onChange={(e) => setShowDerivedInMain(e.target.checked)}
              />
              Mostrar derivadas en panel principal
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Mis consultas
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {mainRows.length} visibles
            </div>
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {mainRows.length === 0 ? (
              <div className="py-3 text-sm text-gray-700 dark:text-gray-200">
                No hay consultas para mostrar.
              </div>
            ) : (
              mainRows.map((row) => {
                const derivationStatus = safeText((row as any).derivation?.status);
                const derivationTo = safeText((row as any).derivation?.toEmail);
                const isClosed = safeText(row.status) === "closed";
                const phone = safeText(row.contactRef?.phone);
                const email = safeText(row.contactRef?.email);
                const whatsappLink = buildWhatsAppLink(phone);
                const mailtoLink = normalizeMailto(email);

                return (
                  <div
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedRow(row);
                      setDetailModalOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRow(row);
                        setDetailModalOpen(true);
                      }
                    }}
                    className="block w-full cursor-pointer py-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                            {safeText(row.contactRef?.displayName) || "(sin consultante)"}
                          </div>

                          {phone ? (
                            <span className="text-xs text-gray-600 dark:text-gray-300">
                              · {phone}
                            </span>
                          ) : null}

                          {whatsappLink ? (
                            <a
                              href={whatsappLink}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs font-extrabold underline text-emerald-700 dark:text-emerald-300"
                            >
                              WhatsApp
                            </a>
                          ) : null}

                          {email ? (
                            <>
                              <span className="text-xs text-gray-400">·</span>
                              <a
                                href={mailtoLink}
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200"
                              >
                                {email}
                              </a>
                            </>
                          ) : null}

                          <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                            {isClosed ? "Cerrada" : "Abierta"}
                          </span>

                          {Boolean((row as any).followUp?.scheduled) ? (
                            <span className="rounded bg-teal-100 px-2 py-0.5 text-[10px] font-black uppercase text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
                              Seguimiento agendado
                            </span>
                          ) : null}

                          {derivationStatus === "pending" ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
                              Derivada
                            </span>
                          ) : null}

                          {derivationStatus === "accepted" ? (
                            <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-black uppercase text-green-800 dark:bg-green-900/30 dark:text-green-100">
                              Derivación aceptada
                            </span>
                          ) : null}

                          {derivationStatus === "rejected" ? (
                            <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-800 dark:bg-red-900/30 dark:text-red-100">
                              Derivación rechazada
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {fmtDateTime(row.openedAt)} · {safeText(row.subject)}
                        </div>

                        <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                          {shortText(row.summary, 140) || "Sin resumen"}
                        </div>

                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {Boolean((row as any).followUp?.scheduled)
                            ? `Seguimiento: ${fmtDateTime((row as any).followUp?.at)}`
                            : "Sin seguimiento agendado"}
                          {derivationTo ? ` · Derivada a ${derivationTo}` : ""}
                        </div>
                      </div>

                      {!isClosed ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedRow(row);
                            setCloseResult("");
                            setCloseModalOpen(true);
                          }}
                          className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                          Cerrar
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Consultas que me derivaron
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {incomingDerived.length}
              </div>
            </div>

            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
              {incomingDerived.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                  No hay consultas pendientes de aceptación.
                </div>
              ) : (
                incomingDerived.map((row) => (
                  <div key={row.id} className="py-3">
                    <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                      {safeText(row.contactRef?.displayName) || "(sin consultante)"}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {fmtDateTime(row.openedAt)} · {safeText(row.subject)}
                    </div>
                    <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                      {shortText(row.summary, 120)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => acceptIncoming(row)}
                        disabled={acceptingId === row.id}
                        className="rounded-xl bg-black px-3 py-2 text-xs font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {acceptingId === row.id ? "Aceptando..." : "Aceptar"}
                      </button>

                      <button
                        type="button"
                        onClick={() => rejectIncoming(row)}
                        disabled={rejectingId === row.id}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        {rejectingId === row.id ? "Rechazando..." : "Rechazar"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Consultas derivadas
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {derivedByMe.length}
              </div>
            </div>

            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
              {derivedByMe.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                  No hay consultas derivadas.
                </div>
              ) : (
                derivedByMe.map((row) => {
                  const derivationStatus = safeText((row as any).derivation?.status);
                  const toEmail = safeText((row as any).derivation?.toEmail);

                  return (
                    <div key={row.id} className="py-3">
                      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {safeText(row.contactRef?.displayName) || "(sin consultante)"}
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {safeText(row.subject)} · {toEmail || "-"}
                      </div>
                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        {shortText(row.summary, 120)}
                      </div>

                      <div className="mt-2 text-xs font-black">
                        {derivationStatus === "pending" ? (
                          <span className="text-amber-700 dark:text-amber-300">
                            Pendiente de respuesta
                          </span>
                        ) : derivationStatus === "accepted" ? (
                          <span className="text-green-700 dark:text-green-300">
                            Aceptada
                          </span>
                        ) : derivationStatus === "rejected" ? (
                          <span className="text-red-700 dark:text-red-300">
                            Derivación rechazada
                          </span>
                        ) : null}
                      </div>

                      {derivationStatus === "rejected" ? (
                        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                          <select
                            value={safeText(rederiveTargetById[row.id])}
                            onChange={(e) =>
                              setRederiveTargetById((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                          >
                            <option value="">Elegir abogado…</option>
                            {lawyers
                              .filter((x) => x.uid !== user?.uid)
                              .map((x) => (
                                <option key={x.uid} value={x.uid}>
                                  {x.email}
                                </option>
                              ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => doRederive(row)}
                            disabled={rederivingId === row.id}
                            className="rounded-xl bg-black px-3 py-2 text-xs font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {rederivingId === row.id ? "Derivando..." : "Derivar nuevamente"}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={newModalOpen}
        title="Nueva consulta"
        onClose={() => {
          setNewModalOpen(false);
          resetNewForm();
        }}
      >
        <div className="grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Consultante
            </div>

            <div className="relative">
              <div className="flex gap-2">
                <input
                  value={contactQuery}
                  onChange={(e) => {
                    setContactQuery(e.target.value);
                    setSelectedContact(null);
                  }}
                  onFocus={() => setContactFocused(true)}
                  onBlur={() => setTimeout(() => setContactFocused(false), 150)}
                  onKeyDown={handleContactSearchKeyDown}
                  placeholder="Buscar por apellido, nombre o razón social"
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />

                <button
                  type="button"
                  onClick={clearSelectedContact}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Limpiar
                </button>
              </div>

              {contactLoading ? (
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Buscando…</div>
              ) : null}

              {contactFocused && contactResults.length > 0 ? (
                <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
                  {contactResults.map((c, idx) => {
                    const active = idx === contactSelectedIndex;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setContactSelectedIndex(idx)}
                        onClick={() => selectContact(c)}
                        className={`block w-full px-3 py-2 text-left ${
                          active
                            ? "bg-gray-100 dark:bg-gray-800"
                            : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                        }`}
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
                    );
                  })}
                </div>
              ) : null}
            </div>

            {selectedContact ? (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-100">
                <div className="font-black">{getContactFullName(selectedContact)}</div>
                <div className="mt-1 text-xs">
                  {safeText(selectedContact.email)}
                  {safeText(selectedContact.email) && safeText(selectedContact.phone) ? " · " : ""}
                  {safeText(selectedContact.phone)}
                </div>
              </div>
            ) : null}

            <div className="text-xs text-gray-600 dark:text-gray-300">
              ¿No existe el contacto?{" "}
              <button
                type="button"
                onClick={() => setCreateContactModalOpen(true)}
                className="font-extrabold underline"
              >
                Crear contacto →
              </button>
            </div>
          </div>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Tema / asunto
            </span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Notas / resumen
            </span>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="min-h-[120px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>

          {newConsultationFlowMode === "take" ? (
            <>
              <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={followUpEnabled}
                  onChange={(e) => setFollowUpEnabled(e.target.checked)}
                />
                Agendar seguimiento
              </label>

              {followUpEnabled ? (
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Fecha y hora de seguimiento
                  </span>
                  <input
                    type="datetime-local"
                    value={followUpAt}
                    onChange={(e) => setFollowUpAt(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {newConsultationFlowMode === "derive" ? (
            <div className="grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Derivar a abogado
              </div>

              <select
                value={newConsultationDeriveTargetUid}
                onChange={(e) => setNewConsultationDeriveTargetUid(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="">Elegir abogado…</option>
                {lawyers
                  .filter((x) => x.uid !== user?.uid)
                  .map((x) => (
                    <option key={x.uid} value={x.uid}>
                      {x.email}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            {newConsultationFlowMode === "initial" ? (
              <>
                <button
                  type="button"
                  onClick={goToTakeMode}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90"
                >
                  Tomar caso
                </button>

                <button
                  type="button"
                  onClick={goToDeriveMode}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Derivar
                </button>
              </>
            ) : null}

            {newConsultationFlowMode === "take" ? (
              <>
                <button
                  type="button"
                  onClick={saveNewConsultation}
                  disabled={savingNew}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingNew ? "Guardando..." : "Confirmar tomar caso"}
                </button>

                <button
                  type="button"
                  onClick={goToDeriveMode}
                  disabled={savingNew}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  Mejor derivar
                </button>
              </>
            ) : null}

            {newConsultationFlowMode === "derive" ? (
              <>
                <button
                  type="button"
                  onClick={saveAndDeriveNewConsultation}
                  disabled={savingNew}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingNew ? "Derivando..." : "Confirmar derivar"}
                </button>

                <button
                  type="button"
                  onClick={backToInitialNewConsultationMode}
                  disabled={savingNew}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                >
                  Mejor tomar caso
                </button>
              </>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={detailModalOpen}
        title={safeText(selectedRow?.contactRef?.displayName) || "Detalle de consulta"}
        onClose={() => {
          setDetailModalOpen(false);
          setSelectedRow(null);
          setNewInteractionOpen(false);
          setDeriveModalOpen(false);
        }}
      >
        {selectedRow ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Consultante
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {safeText(selectedRow.contactRef?.displayName) || "-"}
                </div>

                {safeText(selectedRow.contactRef?.phone) ? (
                  <div className="mt-2 text-sm text-gray-800 dark:text-gray-100">
                    Tel: {safeText(selectedRow.contactRef?.phone)}
                  </div>
                ) : null}

                {safeText(selectedRow.contactRef?.phone) ? (
                  <div className="mt-1">
                    <a
                      href={buildWhatsAppLink(selectedRow.contactRef?.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-extrabold underline text-emerald-700 dark:text-emerald-300"
                    >
                      Abrir WhatsApp
                    </a>
                  </div>
                ) : null}

                {safeText(selectedRow.contactRef?.email) ? (
                  <div className="mt-1">
                    <a
                      href={normalizeMailto(selectedRow.contactRef?.email)}
                      className="text-sm font-extrabold underline text-gray-700 dark:text-gray-200"
                    >
                      {safeText(selectedRow.contactRef?.email)}
                    </a>
                  </div>
                ) : null}
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Fecha
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtDateTime(selectedRow.openedAt)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800 md:col-span-2">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Tema</div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {safeText(selectedRow.subject)}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Resumen
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                {safeText(selectedRow.summary) || "-"}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Seguimiento
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {Boolean((selectedRow as any).followUp?.scheduled)
                    ? fmtDateTime((selectedRow as any).followUp?.at)
                    : "No agendado"}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Estado
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {safeText(selectedRow.status) === "closed" ? "Cerrada" : "Abierta"}
                </div>
              </div>
            </div>

            {safeText((selectedRow as any).derivation?.status) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Derivación
                </div>
                <div className="mt-1 text-sm text-gray-800 dark:text-gray-100">
                  Estado: <b>{safeText((selectedRow as any).derivation?.status)}</b>
                </div>
                {safeText((selectedRow as any).derivation?.toEmail) ? (
                  <div className="mt-1 text-sm text-gray-800 dark:text-gray-100">
                    A: <b>{safeText((selectedRow as any).derivation?.toEmail)}</b>
                  </div>
                ) : null}
              </div>
            ) : null}

            {safeText(selectedRow.result) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Resultado
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                  {safeText(selectedRow.result)}
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/cases/new?prefillCaratula=${encodeURIComponent(
                  safeText(selectedRow.contactRef?.displayName)
                )}&prefillObjeto=${encodeURIComponent(
                  safeText(selectedRow.subject)
                )}&prefillResumen=${encodeURIComponent(safeText(selectedRow.summary))}`}
                className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90"
              >
                Iniciar nueva causa
              </Link>

              {safeText(selectedRow.status) !== "closed" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setNewInteractionOpen((v) => !v)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    {newInteractionOpen ? "Cancelar interacción" : "Agregar interacción"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeriveModalOpen((v) => !v)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    {deriveModalOpen ? "Cancelar derivación" : "Derivar"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCloseResult("");
                      setCloseModalOpen(true);
                    }}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Cerrar consulta
                  </button>
                </>
              ) : null}
            </div>

            {newInteractionOpen ? (
              <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  Nueva interacción
                </div>

                <input
                  value={newInteractionTitle}
                  onChange={(e) => setNewInteractionTitle(e.target.value)}
                  placeholder="Título"
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />

                <textarea
                  value={newInteractionBody}
                  onChange={(e) => setNewInteractionBody(e.target.value)}
                  placeholder="Detalle"
                  className="min-h-[100px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />

                <div>
                  <button
                    type="button"
                    onClick={saveInteraction}
                    disabled={savingInteraction}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {savingInteraction ? "Guardando..." : "Guardar interacción"}
                  </button>
                </div>
              </div>
            ) : null}

            {deriveModalOpen ? (
              <div className="grid gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  Derivar consulta
                </div>

                <select
                  value={deriveTargetUid}
                  onChange={(e) => setDeriveTargetUid(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">Elegir abogado…</option>
                  {lawyers
                    .filter((x) => x.uid !== user?.uid)
                    .map((x) => (
                      <option key={x.uid} value={x.uid}>
                        {x.email}
                      </option>
                    ))}
                </select>

                <div>
                  <button
                    type="button"
                    onClick={saveDerivation}
                    disabled={deriveSaving}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {deriveSaving ? "Derivando..." : "Confirmar derivación"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Interacciones
              </div>

              <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {interactionsLoading ? (
                  <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Cargando…</div>
                ) : interactions.length === 0 ? (
                  <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                    Sin interacciones.
                  </div>
                ) : (
                  interactions.map((item) => (
                    <div key={item.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                          {item.title}
                        </div>
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                          {safeText(item.type)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {fmtDateTime(item.createdAt)} ·{" "}
                        {safeText(item.createdByEmail) || item.createdByUid}
                      </div>
                      {safeText(item.body) ? (
                        <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
                          {item.body}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={closeModalOpen}
        title="Cerrar consulta"
        onClose={() => {
          setCloseModalOpen(false);
          setCloseResult("");
        }}
      >
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Resultado
            </span>
            <textarea
              value={closeResult}
              onChange={(e) => setCloseResult(e.target.value)}
              className="min-h-[120px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>

          <div>
            <button
              type="button"
              onClick={saveCloseConsultation}
              disabled={closingConsultation}
              className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
            >
              {closingConsultation ? "Cerrando..." : "Confirmar cierre"}
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

      <ScrollToTopButton />
    </AppShell>
  );
}