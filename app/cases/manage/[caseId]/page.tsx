"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  collectionGroup,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

import AppShell from "@/components/AppShell";
import { auth, db, storage } from "@/lib/firebase";
import {
  ensureManagementInitialized,
  managementMetaRef,
  logsColRef,
  partiesColRef,
  addAutoLog,
  logTypeColor,
  buildGoogleCalendarLink,
  CaseStatus,
  LogType,
  PartyRole,
  ManagementMeta,
} from "@/lib/caseManagement";

type MainCaseStatus = "draft" | "assigned" | "archsolicited" | "archived";

type CaseDoc = {
  caratulaTentativa?: string;
  jurisdiccion?: "nacional" | "federal" | "caba" | "provincia_bs_as";
  confirmedAssigneesUids?: string[];
  broughtByUid?: string;
  status?: MainCaseStatus;
};

type Party = {
  id: string;
  name: string;
  role: PartyRole;
  identification?: string;
  email?: string;
  phone?: string;
  address?: string;
  contactType?: string;
};

type LogEntry = {
  id: string;
  type: LogType;
  title: string;
  body?: string;
  createdAt?: { seconds: number };
  createdByUid: string;
  createdByEmail?: string;
  hasAttachments?: boolean;
  attachments?: { name: string; url: string }[];
  calendar?: {
    startAt?: { seconds: number };
    endAt?: { seconds: number };
    location?: string;
  };
  sentencia?: {
    resumen: string;
    resultado: "ganado" | "perdido" | "empatado";
    pdfUrl: string;
    pdfName: string;
  };
};

type ContactDoc = {
  type?: string;
  name?: string;
  lastName?: string;
  fullName?: string;
  nameLower?: string;
  nationality?: string;
  address?: string;
  dni?: string;
  cuit?: string;
  birthDate?: string;
  civilStatus?: string;
  marriageCount?: string;
  spouseName?: string;
  phone?: string;
  email?: string;
  referredBy?: string;
  notes?: string;
  tuition?: string;
  conciliationArea?: string;
  specialtyArea?: string;
};

type UserDoc = {
  email?: string;
  role?: string;
};

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function valueOrDash(v?: string | null) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  preliminar: "Preliminar",
  iniciada: "Iniciada",
  en_prueba: "En prueba",
  a_sentencia: "A sentencia",
  en_apelacion: "En apelación",
  en_ejecucion: "En ejecución",
};

const LOGTYPE_LABEL: Record<LogType, string> = {
  informativa: "Informativa",
  vencimiento: "Vencimiento",
  audiencia: "Audiencia",
  control_cobro: "Control de cobro",
  reunion_parte: "Reunión con parte",
  sentencia: "Sentencia",
};

function contactTypeLabel(type?: string) {
  switch (type) {
    case "cliente":
      return "Cliente";
    case "abogado_contraria":
      return "Abogado contraria";
    case "demandado":
      return "Demandado";
    case "conciliador":
      return "Conciliador";
    case "perito":
      return "Perito";
    default:
      return "Otro";
  }
}

function roleLabel(role: PartyRole) {
  switch (role) {
    case "actor":
      return "Actor";
    case "demandado":
      return "Demandado";
    case "citado_garantia":
      return "Citado en garantía";
    case "imputado":
      return "Imputado";
    case "querellante":
      return "Querellante";
    case "causante":
      return "Causante";
    case "fallido":
      return "Fallido";
    default:
      return "Otro";
  }
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
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
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

export default function ManageCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);

  const [caseDoc, setCaseDoc] = useState<CaseDoc | null>(null);
  const [meta, setMeta] = useState<ManagementMeta | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);

  const [parties, setParties] = useState<Party[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [involvedEmails, setInvolvedEmails] = useState<string[]>([]);

  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaDraft, setMetaDraft] = useState<Partial<ManagementMeta>>({});

  const [newPartyName, setNewPartyName] = useState("");
  const [newPartyRole, setNewPartyRole] = useState<PartyRole>("actor");
  const [newPartyIdentification, setNewPartyIdentification] = useState("");
  const [newPartyEmail, setNewPartyEmail] = useState("");
  const [newPartyPhone, setNewPartyPhone] = useState("");
  const [newPartyAddress, setNewPartyAddress] = useState("");
  const [newPartyContactType, setNewPartyContactType] = useState("");

  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<Array<{ id: string } & ContactDoc>>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState<({ id: string } & ContactDoc) | null>(
    null
  );
  const [contactError, setContactError] = useState<string | null>(null);

  const [createContactModalOpen, setCreateContactModalOpen] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [newContactType, setNewContactType] = useState("cliente");
  const [newContactName, setNewContactName] = useState("");
  const [newContactLastName, setNewContactLastName] = useState("");
  const [newContactDni, setNewContactDni] = useState("");
  const [newContactCuit, setNewContactCuit] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactAddress, setNewContactAddress] = useState("");

  const [logType, setLogType] = useState<LogType>("informativa");
  const [logTitle, setLogTitle] = useState("");
  const [logBody, setLogBody] = useState("");
  const [calendarStart, setCalendarStart] = useState("");
  const [calendarEnd, setCalendarEnd] = useState("");
  const [calendarLocation, setCalendarLocation] = useState("");

  const [sentResult, setSentResult] = useState<"ganado" | "perdido" | "empatado">("ganado");
  const [sentResumen, setSentResumen] = useState("");
  const [sentPdf, setSentPdf] = useState<File | null>(null);
  const [savingLog, setSavingLog] = useState(false);

  const [archiveRequestOpen, setArchiveRequestOpen] = useState(false);
  const [archiveRequestJustification, setArchiveRequestJustification] = useState("");
  const [archiveRequestDone, setArchiveRequestDone] = useState(false);
  const [archiveRequestSaving, setArchiveRequestSaving] = useState(false);

  const [archivingCase, setArchivingCase] = useState(false);

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
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      try {
        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const snap = await getDocs(qPending);
        setPendingInvites(snap.size);
      } catch {
        setPendingInvites(0);
      } finally {
        setLoadingShell(false);
      }
    });

    return () => unsub();
  }, [router]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  useEffect(() => {
    if (!user) return;

    const unsub = onSnapshot(doc(db, "cases", caseId), (snap) => {
      if (!snap.exists()) {
        setCaseDoc(null);
        return;
      }
      setCaseDoc(snap.data() as any);
    });

    return () => unsub();
  }, [user, caseId]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      try {
        await ensureManagementInitialized({ caseId, uid: user.uid, email: user.email ?? "" });
      } catch (e: any) {
        setMsg(e?.message ?? "Error inicializando gestión.");
      }
    })();
  }, [user, caseId]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(managementMetaRef(caseId), (snap) => {
      const data = snap.exists() ? (snap.data() as any) : null;
      setMeta(data);
    });
    return () => unsub();
  }, [user, caseId]);

  useEffect(() => {
    if (!user) return;
    const q = query(partiesColRef(caseId), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setParties(items as any);
    });
    return () => unsub();
  }, [user, caseId]);

  useEffect(() => {
    if (!user) return;
    const q = query(logsColRef(caseId), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setLogs(items as any);
    });
    return () => unsub();
  }, [user, caseId]);

  const canWrite = useMemo(() => {
    const u = user?.uid;
    const assignees = caseDoc?.confirmedAssigneesUids ?? [];
    return !!u && assignees.includes(u);
  }, [user, caseDoc]);

  useEffect(() => {
    if (!caseDoc) return;

    (async () => {
      try {
        const uids = Array.from(
          new Set([...(caseDoc.confirmedAssigneesUids ?? []), caseDoc.broughtByUid ?? ""].filter(Boolean))
        );

        if (uids.length === 0) {
          setInvolvedEmails([]);
          return;
        }

        const docs = await Promise.all(uids.map((uid) => getDoc(doc(db, "users", uid))));
        const emails = docs
          .map((s) => (s.exists() ? ((s.data() as UserDoc).email ?? "") : ""))
          .map((e) => String(e).trim())
          .filter(Boolean);

        setInvolvedEmails(Array.from(new Set(emails)));
      } catch {
        setInvolvedEmails([]);
      }
    })();
  }, [caseDoc]);

  useEffect(() => {
    const requestedInMeta = Boolean((meta as any)?.archiveRequest?.requestedAt);
    const requestedInCase = caseDoc?.status === "archsolicited";
    setArchiveRequestDone(requestedInMeta || requestedInCase);
  }, [meta, caseDoc]);

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

        const all = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Array<
          { id: string } & ContactDoc
        >;

        const filtered = all.filter((c) => {
          const full = safeLower(
            c.fullName || `${c.name ?? ""} ${c.lastName ?? ""}`.trim()
          );
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

  function selectContact(c: { id: string } & ContactDoc) {
    const fullName =
      String(c.fullName ?? "").trim() ||
      `${String(c.name ?? "").trim()} ${String(c.lastName ?? "").trim()}`.trim();

    const identification = String(c.dni ?? c.cuit ?? "").trim();

    setSelectedContact(c);
    setContactQuery(fullName);
    setContactResults([]);

    setNewPartyName(fullName);
    setNewPartyIdentification(identification);
    setNewPartyEmail(String(c.email ?? ""));
    setNewPartyPhone(String(c.phone ?? ""));
    setNewPartyAddress(String(c.address ?? ""));
    setNewPartyContactType(String(c.type ?? ""));
  }

  function clearSelectedContact() {
    setSelectedContact(null);
    setContactQuery("");
    setContactResults([]);
    setNewPartyName("");
    setNewPartyIdentification("");
    setNewPartyEmail("");
    setNewPartyPhone("");
    setNewPartyAddress("");
    setNewPartyContactType("");
  }

  function openMetaModal() {
    setMetaDraft({
      physicalFolder: meta?.physicalFolder ?? "",
      driveFolderUrl: meta?.driveFolderUrl ?? "",
      expedienteNumber: meta?.expedienteNumber ?? "",
      court: meta?.court ?? "",
      fuero: meta?.fuero ?? "",
      jurisdiccion: meta?.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as",
      deptoJudicial: meta?.deptoJudicial ?? "",
      status: meta?.status ?? "preliminar",
    });
    setMetaModalOpen(true);
  }

  async function saveMeta(
    patch: Partial<ManagementMeta>,
    maybeStatusChanged?: { from?: CaseStatus; to?: CaseStatus }
  ) {
    if (!user) return;
    if (!canWrite) {
      alert("No tenés permisos de escritura en esta causa.");
      return;
    }

    setSavingMeta(true);

    try {
      await updateDoc(managementMetaRef(caseId), {
        ...patch,
        updatedAt: serverTimestamp(),
      });

      if (
        maybeStatusChanged?.from &&
        maybeStatusChanged?.to &&
        maybeStatusChanged.from !== maybeStatusChanged.to
      ) {
        await addAutoLog({
          caseId,
          uid: user.uid,
          email: user.email ?? "",
          title: `Cambio de estado: ${STATUS_LABEL[maybeStatusChanged.from]} → ${STATUS_LABEL[maybeStatusChanged.to]}`,
          body: "",
          type: "informativa",
        });
      }

      setMetaModalOpen(false);
    } finally {
      setSavingMeta(false);
    }
  }

  async function saveMetaFromModal() {
    const from = meta?.status ?? "preliminar";
    const to = (metaDraft.status as CaseStatus) ?? from;

    await saveMeta(
      {
        physicalFolder: String(metaDraft.physicalFolder ?? ""),
        driveFolderUrl: String(metaDraft.driveFolderUrl ?? ""),
        expedienteNumber: String(metaDraft.expedienteNumber ?? ""),
        court: String(metaDraft.court ?? ""),
        fuero: String(metaDraft.fuero ?? ""),
        jurisdiccion: (metaDraft.jurisdiccion as any) ?? caseDoc?.jurisdiccion ?? "provincia_bs_as",
        deptoJudicial: String(metaDraft.deptoJudicial ?? ""),
        status: to,
      },
      { from, to }
    );
  }

  async function addParty() {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");

    const name = newPartyName.trim();
    if (!name) return alert("Ingresá un nombre.");

    await addDoc(partiesColRef(caseId), {
      name,
      role: newPartyRole,
      identification: newPartyIdentification.trim(),
      email: newPartyEmail.trim(),
      phone: newPartyPhone.trim(),
      address: newPartyAddress.trim(),
      contactType: newPartyContactType.trim(),
      contactRef: selectedContact ? { contactId: selectedContact.id } : null,
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
    });

    await updateDoc(managementMetaRef(caseId), {
      updatedAt: serverTimestamp(),
    });

    clearSelectedContact();
    setNewPartyRole("actor");
  }

  async function createContact() {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");

    const name = newContactName.trim();
    const lastName = newContactLastName.trim();
    const fullName = `${name} ${lastName}`.trim();

    if (!fullName) return alert("Completá al menos nombre o apellido.");

    setSavingContact(true);
    try {
      const refDoc = await addDoc(collection(db, "contacts"), {
        type: newContactType,
        name,
        lastName,
        fullName,
        nameLower: safeLower(fullName),
        dni: newContactDni.trim(),
        cuit: newContactCuit.trim(),
        phone: newContactPhone.trim(),
        email: newContactEmail.trim(),
        address: newContactAddress.trim(),
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
      });

      const created = await getDoc(refDoc);
      if (created.exists()) {
        selectContact({ id: created.id, ...(created.data() as any) });
      }

      setCreateContactModalOpen(false);
      setNewContactType("cliente");
      setNewContactName("");
      setNewContactLastName("");
      setNewContactDni("");
      setNewContactCuit("");
      setNewContactPhone("");
      setNewContactEmail("");
      setNewContactAddress("");
    } finally {
      setSavingContact(false);
    }
  }

  function sanitizeFileName(name: string) {
    return name.replace(/[^\w.\-]+/g, "_");
  }

  async function uploadSentenciaPdf(file: File) {
    if (!user) throw new Error("No auth");

    const safeName = sanitizeFileName(file.name);
    const path = `cases/${caseId}/sentencias/${Date.now()}_${safeName}`;
    const fileRef = ref(storage, path);

    await uploadBytes(fileRef, file, {
      contentType: file.type || "application/pdf",
    });

    const pdfUrl = await getDownloadURL(fileRef);

    return {
      pdfUrl,
      pdfName: file.name,
    };
  }

  function buildCalendarTitle(rawTitle: string) {
    const prefix = (caseDoc?.caratulaTentativa ?? "").trim().slice(0, 15);
    const bracket = prefix ? `[${prefix}] ` : "";
    return `${bracket}${rawTitle}`.trim();
  }

  async function addLogEntry() {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");

    const title = logTitle.trim();
    if (!title) return alert("Ingresá un título.");

    if (logType === "sentencia") {
      if (!sentPdf) return alert("Para 'Sentencia' tenés que subir sí o sí el PDF.");
      if (!sentResumen.trim()) return alert("Para 'Sentencia' tenés que completar el resumen.");
      if (!sentResult) return alert("Para 'Sentencia' tenés que indicar resultado.");
    }

    const calendarTypes: LogType[] = ["vencimiento", "control_cobro", "audiencia", "reunion_parte"];
    const wantsCalendar = calendarTypes.includes(logType) && calendarStart;

    setSavingLog(true);

    try {
      let sentenciaPayload: any = null;

      if (logType === "sentencia") {
        const uploaded = await uploadSentenciaPdf(sentPdf!);

        sentenciaPayload = {
          resumen: sentResumen.trim(),
          resultado: sentResult,
          pdfUrl: uploaded.pdfUrl,
          pdfName: uploaded.pdfName,
        };

        await addDoc(collection(db, "sentences"), {
          caseId,
          createdAt: serverTimestamp(),
          createdByUid: user.uid,
          jurisdiccion: meta?.jurisdiccion ?? caseDoc?.jurisdiccion ?? "",
          fuero: meta?.fuero ?? "",
          court: meta?.court ?? "",
          expedienteNumber: meta?.expedienteNumber ?? "",
          resumen: sentResumen.trim(),
          resultado: sentResult,
          pdfUrl: uploaded.pdfUrl,
          pdfName: uploaded.pdfName,
        });
      }

      let calendarPayload: any = null;
      if (wantsCalendar) {
        const start = new Date(calendarStart);
        const end = calendarEnd ? new Date(calendarEnd) : new Date(start.getTime() + 60 * 60 * 1000);
        calendarPayload = {
          startAt: Timestamp.fromDate(start),
          endAt: Timestamp.fromDate(end),
          location: calendarLocation.trim(),
          generatedTitle: buildCalendarTitle(title),
          attendees: involvedEmails,
          preferredCalendarName: "Trabajo",
        };
      }

      await addDoc(logsColRef(caseId), {
        type: logType,
        title,
        body: logBody.trim(),
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByEmail: user.email ?? "",
        hasAttachments: false,
        attachments: [],
        calendar: calendarPayload,
        sentencia: sentenciaPayload,
      });

      await updateDoc(managementMetaRef(caseId), {
        updatedAt: serverTimestamp(),
        lastLogAt: serverTimestamp(),
        lastLogByUid: user.uid,
        lastLogTitle: title,
      });

      setLogTitle("");
      setLogBody("");
      setCalendarStart("");
      setCalendarEnd("");
      setCalendarLocation("");
      setSentPdf(null);
      setSentResumen("");
      setSentResult("ganado");
      setLogType("informativa");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "No se pudo guardar la entrada.");
    } finally {
      setSavingLog(false);
    }
  }

  async function submitArchiveRequest() {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");

    const justification = archiveRequestJustification.trim();
    if (!justification) return alert("Ingresá una justificación.");

    const ok = window.confirm("Se enviará una solicitud de archivo al Administrador.");
    if (!ok) return;

    setArchiveRequestSaving(true);
    try {
      await updateDoc(doc(db, "cases", caseId), {
        status: "archsolicited",
        archiveRequestedAt: serverTimestamp(),
        archiveRequestedByUid: user.uid,
        archiveRequestedByEmail: user.email ?? "",
      });

      await updateDoc(managementMetaRef(caseId), {
        archiveRequest: {
          requestedAt: serverTimestamp(),
          requestedByUid: user.uid,
          requestedByEmail: user.email ?? "",
          justification,
        },
        updatedAt: serverTimestamp(),
      });

      await addAutoLog({
        caseId,
        uid: user.uid,
        email: user.email ?? "",
        title: "Solicitud de archivo de causa",
        body: justification,
        type: "informativa",
      });

      setArchiveRequestDone(true);
      setArchiveRequestOpen(false);
      setArchiveRequestJustification("");
    } finally {
      setArchiveRequestSaving(false);
    }
  }

  async function archiveCase() {
    if (!user) return;
    if (role !== "admin") return alert("Solo el administrador puede archivar.");

    const ok = window.confirm("¿Confirmás archivar esta causa?");
    if (!ok) return;

    setArchivingCase(true);
    try {
      await updateDoc(doc(db, "cases", caseId), {
        status: "archived",
        archivedAt: serverTimestamp(),
        archivedByUid: user.uid,
      });

      await updateDoc(managementMetaRef(caseId), {
        updatedAt: serverTimestamp(),
        archivedAt: serverTimestamp(),
        archivedByUid: user.uid,
      });

      await addAutoLog({
        caseId,
        uid: user.uid,
        email: user.email ?? "",
        title: "Causa archivada",
        body: "La causa fue archivada por el administrador.",
        type: "informativa",
      });

      alert("La causa fue archivada.");
    } finally {
      setArchivingCase(false);
    }
  }

  const archiveStatusText = archiveRequestDone
    ? "Solicitud de archivo realizada"
    : "Solicitar archivo de la causa";

  return (
    <AppShell
      title="Gestionar causa"
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

      {!user ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Iniciá sesión...
        </div>
      ) : !caseDoc ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          No existe la causa o no tenés acceso.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-gray-600 dark:text-gray-300">Causa</div>
              <div className="truncate text-lg font-black text-gray-900 dark:text-gray-100">
                {caseDoc.caratulaTentativa || "(sin carátula)"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {role === "admin" ? (
                <button
                  type="button"
                  onClick={archiveCase}
                  disabled={archivingCase || caseDoc.status === "archived"}
                  className="rounded-xl bg-red-700 px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {caseDoc.status === "archived" ? "Archivada" : "Archivar"}
                </button>
              ) : null}

              <Link
                href="/cases/manage"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Volver →
              </Link>
            </div>
          </div>

          {!canWrite ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Estás en modo lectura: solo abogados intervinientes pueden editar.
            </div>
          ) : null}

          {caseDoc.status === "archived" ? (
            <div className="mb-4 rounded-xl border border-gray-300 bg-gray-100 p-3 text-sm font-bold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
              Esta causa está archivada.
            </div>
          ) : null}

          {caseDoc.status === "archsolicited" ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
              Esta causa tiene archivo solicitado y está pendiente de resolución por el administrador.
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">Datos de gestión</div>
                <button
                  type="button"
                  onClick={openMetaModal}
                  disabled={!canWrite}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Modificar
                </button>
              </div>

              <div className="mt-3 grid gap-2 text-sm text-gray-800 dark:text-gray-100">
                <div>
                  <span className="font-black">Carpeta física:</span>{" "}
                  <span>{valueOrDash(meta?.physicalFolder)}</span>
                </div>
                <div>
                  <span className="font-black">Vínculo carpeta Drive:</span>{" "}
                  <span className="break-all">{valueOrDash(meta?.driveFolderUrl)}</span>
                </div>
                <div>
                  <span className="font-black">Nº expediente:</span>{" "}
                  <span>{valueOrDash(meta?.expedienteNumber)}</span>
                </div>
                <div>
                  <span className="font-black">Juzgado:</span> <span>{valueOrDash(meta?.court)}</span>
                </div>
                <div>
                  <span className="font-black">Fuero:</span> <span>{valueOrDash(meta?.fuero)}</span>
                </div>
                <div>
                  <span className="font-black">Jurisdicción:</span>{" "}
                  <span>{valueOrDash(meta?.jurisdiccion ?? caseDoc?.jurisdiccion)}</span>
                </div>
                <div>
                  <span className="font-black">Departamento judicial:</span>{" "}
                  <span>{valueOrDash(meta?.deptoJudicial)}</span>
                </div>
                <div>
                  <span className="font-black">Estado:</span>{" "}
                  <span>{STATUS_LABEL[(meta?.status ?? "preliminar") as CaseStatus] ?? "-"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">Partes</div>
                <div className="text-xs text-gray-600 dark:text-gray-300">{parties.length} cargadas</div>
              </div>

              <div className="mt-3 rounded-xl border border-gray-100 dark:border-gray-800">
                {parties.length === 0 ? (
                  <div className="p-3 text-sm text-gray-700 dark:text-gray-200">No hay partes cargadas.</div>
                ) : (
                  parties.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`p-3 ${idx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/40"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">{p.name}</div>
                        {p.contactType ? (
                          <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                            {contactTypeLabel(p.contactType)}
                          </span>
                        ) : null}
                      </div>

                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        Rol: {roleLabel(p.role)}
                        {p.identification ? ` · ${p.identification}` : ""}
                        {p.email ? ` · ${p.email}` : ""}
                        {p.phone ? ` · ${p.phone}` : ""}
                        {p.address ? ` · ${p.address}` : ""}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">Agregar parte</div>

                <div className="mt-3">
                  <div className="relative">
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Buscar en contactos
                    </label>

                    <div className="mt-1 flex gap-2">
                      <input
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                        placeholder="Buscar por apellido y/o nombre…"
                        value={contactQuery}
                        onChange={(e) => {
                          setContactQuery(e.target.value);
                          setSelectedContact(null);
                        }}
                        disabled={!canWrite}
                      />
                      <button
                        type="button"
                        onClick={clearSelectedContact}
                        disabled={!canWrite}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Limpiar
                      </button>
                    </div>

                    {contactLoading ? (
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">Buscando…</div>
                    ) : null}

                    {contactError ? (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-200">{contactError}</div>
                    ) : null}

                    {contactResults.length > 0 ? (
                      <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
                        {contactResults.map((c) => {
                          const fullName =
                            String(c.fullName ?? "").trim() ||
                            `${String(c.name ?? "").trim()} ${String(c.lastName ?? "").trim()}`.trim();

                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => selectContact(c)}
                              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40"
                              disabled={!canWrite}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                                  {fullName || "(sin nombre)"}
                                </div>
                                <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                                  {contactTypeLabel(c.type)}
                                </span>
                              </div>

                              <div className="text-xs text-gray-600 dark:text-gray-300">
                                {c.dni ? `DNI: ${c.dni}` : ""}
                                {c.cuit ? `${c.dni ? " · " : ""}CUIT/CUIL: ${c.cuit}` : ""}
                                {c.email ? ` · ${c.email}` : ""}
                                {c.phone ? ` · ${c.phone}` : ""}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {selectedContact ? (
                    <div className="mt-2 rounded-xl border border-green-200 bg-green-50 p-2 text-xs text-green-900">
                      Contacto seleccionado:{" "}
                      <b>
                        {selectedContact.fullName ||
                          `${selectedContact.name ?? ""} ${selectedContact.lastName ?? ""}`.trim()}
                      </b>
                      {selectedContact.type ? ` · ${contactTypeLabel(selectedContact.type)}` : ""}
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Nombre / Razón social
                    </label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={newPartyName}
                      onChange={(e) => setNewPartyName(e.target.value)}
                      disabled={!canWrite}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Rol</label>
                    <select
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={newPartyRole}
                      onChange={(e) => setNewPartyRole(e.target.value as any)}
                      disabled={!canWrite}
                    >
                      <option value="actor">Actor</option>
                      <option value="demandado">Demandado</option>
                      <option value="citado_garantia">Citado en garantía</option>
                      <option value="imputado">Imputado</option>
                      <option value="querellante">Querellante</option>
                      <option value="causante">Causante</option>
                      <option value="fallido">Fallido</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      DNI / CUIT / CUIL
                    </label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={newPartyIdentification}
                      onChange={(e) => setNewPartyIdentification(e.target.value)}
                      disabled={!canWrite}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Email</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={newPartyEmail}
                      onChange={(e) => setNewPartyEmail(e.target.value)}
                      disabled={!canWrite}
                    />
                  </div>

                  <div>
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Teléfono</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={newPartyPhone}
                      onChange={(e) => setNewPartyPhone(e.target.value)}
                      disabled={!canWrite}
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Domicilio</label>
                    <input
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={newPartyAddress}
                      onChange={(e) => setNewPartyAddress(e.target.value)}
                      disabled={!canWrite}
                    />
                  </div>

                  <button
                    className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50 md:col-span-2"
                    disabled={!canWrite}
                    onClick={addParty}
                  >
                    Agregar parte
                  </button>
                </div>

                <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
                  ¿No existe el contacto?{" "}
                  <button
                    type="button"
                    className="font-extrabold underline"
                    onClick={() => setCreateContactModalOpen(true)}
                    disabled={!canWrite}
                  >
                    Crear contacto →
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">Nueva entrada de bitácora</div>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo</span>
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={logType}
                  onChange={(e) => setLogType(e.target.value as any)}
                  disabled={!canWrite}
                >
                  {Object.keys(LOGTYPE_LABEL).map((k) => (
                    <option key={k} value={k}>
                      {LOGTYPE_LABEL[k as LogType]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Título</span>
                <input
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={logTitle}
                  onChange={(e) => setLogTitle(e.target.value)}
                  disabled={!canWrite}
                  placeholder="Ej: Se contestó traslado / Vence plazo / Audiencia…"
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Detalle</span>
                <textarea
                  className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={logBody}
                  onChange={(e) => setLogBody(e.target.value)}
                  disabled={!canWrite}
                />
              </label>

              {["vencimiento", "control_cobro", "audiencia", "reunion_parte"].includes(logType) ? (
                <>
                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Inicio (para Calendar)
                    </span>
                    <input
                      type="datetime-local"
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarStart}
                      onChange={(e) => setCalendarStart(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Fin (opcional)</span>
                    <input
                      type="datetime-local"
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarEnd}
                      onChange={(e) => setCalendarEnd(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1 md:col-span-2">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Más datos</span>
                    <input
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarLocation}
                      onChange={(e) => setCalendarLocation(e.target.value)}
                      disabled={!canWrite}
                      placeholder="Lugar, sala, juzgado, enlace o cualquier dato útil"
                    />
                  </label>
                </>
              ) : null}

              {logType === "sentencia" ? (
                <>
                  <label className="grid gap-1 md:col-span-2">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      PDF de sentencia (obligatorio)
                    </span>
                    <input
                      type="file"
                      accept="application/pdf"
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      onChange={(e) => setSentPdf(e.target.files?.[0] ?? null)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1 md:col-span-2">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Resumen (obligatorio)
                    </span>
                    <textarea
                      className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={sentResumen}
                      onChange={(e) => setSentResumen(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Resultado</span>
                    <select
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={sentResult}
                      onChange={(e) => setSentResult(e.target.value as any)}
                      disabled={!canWrite}
                    >
                      <option value="ganado">Ganado</option>
                      <option value="perdido">Perdido</option>
                      <option value="empatado">Empatado</option>
                    </select>
                  </label>
                </>
              ) : null}

              <button
                className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50 md:col-span-2"
                disabled={!canWrite || savingLog}
                onClick={addLogEntry}
              >
                {savingLog ? "Guardando..." : "Guardar entrada"}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">Bitácora</div>
              <div className="text-xs text-gray-600 dark:text-gray-300">{logs.length} entradas</div>
            </div>

            <div className="mt-3">
              {logs.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Sin entradas.</div>
              ) : (
                logs.map((l, idx) => {
                  const cls = logTypeColor(l.type);
                  const createdAt = l.createdAt?.seconds;

                  const hasCal = !!l.calendar?.startAt?.seconds;
                  const calLink = hasCal
                    ? buildGoogleCalendarLink({
                        title: buildCalendarTitle(l.title),
                        details:
                          `${l.body || ""}` +
                          (involvedEmails.length
                            ? `\n\nInvitados sugeridos: ${involvedEmails.join(", ")}`
                            : "") +
                          `\n\nCalendario sugerido: Trabajo`,
                        location: l.calendar?.location || "",
                        start: new Date((l.calendar!.startAt!.seconds as number) * 1000),
                        end: l.calendar?.endAt?.seconds
                          ? new Date((l.calendar!.endAt!.seconds as number) * 1000)
                          : undefined,
                      })
                    : null;

                  return (
                    <div
                      key={l.id}
                      className={`rounded-xl p-3 ${idx % 2 === 0 ? "bg-gray-50 dark:bg-gray-800/40" : "bg-white dark:bg-gray-900"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-black ${cls}`}
                            >
                              {LOGTYPE_LABEL[l.type]}
                            </span>
                            <span className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                              {l.title}
                            </span>
                            {l.hasAttachments ? <span title="Con adjuntos" className="text-xs">📎</span> : null}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            {formatDateFromSeconds(createdAt)} · {l.createdByEmail || l.createdByUid}
                          </div>
                        </div>

                        {calLink ? (
                          <a
                            href={calLink}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                          >
                            Agregar a Calendar
                          </a>
                        ) : null}
                      </div>

                      {l.body ? (
                        <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                          {l.body}
                        </div>
                      ) : null}

                      {l.type === "sentencia" && l.sentencia ? (
                        <div className="mt-2 rounded-xl border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm">
                          <div className="font-black">Sentencia</div>
                          <div className="mt-1 text-xs text-gray-700">
                            Resultado: <b>{l.sentencia.resultado}</b>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800">
                            {l.sentencia.resumen}
                          </div>
                          <div className="mt-2">
                            <a
                              className="text-sm font-extrabold underline"
                              href={l.sentencia.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver PDF ({l.sentencia.pdfName})
                            </a>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
              {!archiveRequestDone ? (
                <>
                  <button
                    type="button"
                    onClick={() => setArchiveRequestOpen((v) => !v)}
                    disabled={!canWrite}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    {archiveStatusText}
                  </button>

                  {archiveRequestOpen ? (
                    <div className="mt-3 grid gap-3">
                      <label className="grid gap-1">
                        <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                          Justificación
                        </span>
                        <textarea
                          className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                          value={archiveRequestJustification}
                          onChange={(e) => setArchiveRequestJustification(e.target.value)}
                          disabled={!canWrite}
                        />
                      </label>

                      <div>
                        <button
                          type="button"
                          onClick={submitArchiveRequest}
                          disabled={!canWrite || archiveRequestSaving}
                          className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {archiveRequestSaving
                            ? "Enviando..."
                            : "Confirmar solicitud de archivo"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  disabled
                  className="rounded-xl border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-extrabold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  Solicitud de archivo realizada
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <Modal open={metaModalOpen} title="Modificar datos de gestión" onClose={() => setMetaModalOpen(false)}>
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Carpeta física (opcional)
            </span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={String(metaDraft.physicalFolder ?? "")}
              onChange={(e) => setMetaDraft((m) => ({ ...m, physicalFolder: e.target.value }))}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Vínculo carpeta Drive (opcional)
            </span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={String(metaDraft.driveFolderUrl ?? "")}
              onChange={(e) => setMetaDraft((m) => ({ ...m, driveFolderUrl: e.target.value }))}
              placeholder="https://drive.google.com/drive/folders/..."
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nº expediente</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.expedienteNumber ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, expedienteNumber: e.target.value }))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Juzgado</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.court ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, court: e.target.value }))}
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Fuero</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.fuero ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, fuero: e.target.value }))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Jurisdicción</span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, jurisdiccion: e.target.value as any }))}
              >
                <option value="nacional">Nacional</option>
                <option value="federal">Federal</option>
                <option value="caba">CABA</option>
                <option value="provincia_bs_as">Provincia Bs. As.</option>
              </select>
            </label>
          </div>

          {(metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion) === "provincia_bs_as" ? (
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Departamento judicial
              </span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.deptoJudicial ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, deptoJudicial: e.target.value }))}
              />
            </label>
          ) : null}

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Estado</span>
            <select
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={String(metaDraft.status ?? "preliminar")}
              onChange={(e) => setMetaDraft((m) => ({ ...m, status: e.target.value as CaseStatus }))}
            >
              {Object.keys(STATUS_LABEL).map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABEL[k as CaseStatus]}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={saveMetaFromModal}
              disabled={!canWrite || savingMeta}
              className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingMeta ? "Guardando..." : "Guardar cambios"}
            </button>

            <button
              type="button"
              onClick={() => setMetaModalOpen(false)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Descartar cambios
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={createContactModalOpen}
        title="Crear contacto"
        onClose={() => setCreateContactModalOpen(false)}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo</span>
            <select
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactType}
              onChange={(e) => setNewContactType(e.target.value)}
            >
              <option value="cliente">Cliente</option>
              <option value="abogado_contraria">Abogado contraria</option>
              <option value="demandado">Demandado</option>
              <option value="conciliador">Conciliador</option>
              <option value="perito">Perito</option>
              <option value="otro">Otro</option>
            </select>
          </label>

          <div />

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nombre</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Apellido</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactLastName}
              onChange={(e) => setNewContactLastName(e.target.value)}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactDni}
              onChange={(e) => setNewContactDni(e.target.value)}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">CUIT/CUIL</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactCuit}
              onChange={(e) => setNewContactCuit(e.target.value)}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Teléfono</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactPhone}
              onChange={(e) => setNewContactPhone(e.target.value)}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Email</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactEmail}
              onChange={(e) => setNewContactEmail(e.target.value)}
            />
          </label>

          <label className="grid gap-1 md:col-span-2">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Domicilio</span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={newContactAddress}
              onChange={(e) => setNewContactAddress(e.target.value)}
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-2 md:col-span-2">
            <button
              type="button"
              onClick={createContact}
              disabled={savingContact}
              className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
            >
              {savingContact ? "Guardando..." : "Guardar contacto"}
            </button>

            <button
              type="button"
              onClick={() => setCreateContactModalOpen(false)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Cancelar carga de contacto
            </button>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}