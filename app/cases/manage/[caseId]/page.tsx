"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
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
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import AppShell from "@/components/AppShell";
import ContactForm, { CreatedContact } from "@/components/contacts/ContactForm";
import ScrollToTopButton from "@/components/ScrollToTopButton";
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
  syncContactCaseLink,
  removeRoleFromContactCaseLink,
  syncCaseCaratulaToContactLinks,
} from "@/lib/caseManagement";
import { getChargeUserNetAmount } from "@/lib/charges";
import { createAutoEventFromCaseLog } from "@/lib/events";
import { generateCaseReport } from "@/lib/aiReports";



type MainCaseStatus = "draft" | "assigned" | "archsolicited" | "archived";

type RedactionWorkflow = {
  status?: "drafting" | "ready";
  responsibleUid?: string;
  responsibleEmail?: string;
  dueDate?: string;
  startedAt?: any;
  startedByUid?: string;
  startedByEmail?: string;
  firstDraftCompletedAt?: any;
  firstDraftCompletedByUid?: string;
  firstDraftCompletedByEmail?: string;
  reviewedAt?: any;
  reviewedByUid?: string;
  reviewedByEmail?: string;
};

type CaseDoc = {
  caratulaTentativa?: string;
    jurisdiccion?:
    | "nacional"
    | "federal"
    | "caba"
    | "provincia_bs_as"
    | "entre_rios"
    | "etapa_administrativa"
    | "otra";
  confirmedAssigneesUids?: string[];
  broughtByUid?: string;
  status?: MainCaseStatus;
  managementStatus?: CaseStatus;
    initialDraftWorkflow?: RedactionWorkflow;
  alegatoWorkflow?: RedactionWorkflow;
};

type Party = {
  id: string;
  name: string;
  role: PartyRole;
  identification?: string;
  email?: string;
  phone?: string;
  address?: string;
  contactRef?: { contactId: string } | null;
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
    interaction?: {
    contactId?: string;
    contactName?: string;
    report?: string;
  };
  despachoImportante?: {
    resumen?: string;
    pdfUrl?: string;
    pdfName?: string;
  };
  paseVista?: {
    organism?: string;
    reason?: string;
  };
};

type ContactDoc = {
  type?: string;
  personType?: "fisica" | "juridica";
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

type LawyerOption = {
  uid: string;
  email: string;
};

type QuickCaseRow = {
  id: string;
  caratulaTentativa?: string;
};

type MetaDraft = Partial<ManagementMeta> & {
  caratulaTentativa?: string;
  claimAmount?: number | null;
  otherOrganisms?: string[];
};

type CasePaidChargeRow = {
  id: string;
  status?: "scheduled" | "paid" | "cancelled";
  ownerUid?: string;
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
  totalAmount?: number;
  currency?: "ARS" | "USD";
  paidAt?: any;
  installments?: {
    enabled?: boolean;
    total?: number;
    current?: number;
  };
  distribution?: {
    grossAmount?: number;
    deductionsTotal?: number;
    baseNetAmount?: number;
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
};

const LOGS_PER_PAGE = 25;

const NACIONAL_FUEROS = ["Comercial", "Trabajo", "Civil", "Criminal y Correccional"];

const FEDERAL_FUEROS = [
  "Penal Económico",
  "Civil y Comercial Federal",
  "Contencioso Administrativo Federal",
  "Criminal y Correccional Federal",
  "Justicia Federal de Bahía Blanca",
  "Justicia Federal de Comodoro Rivadavia",
  "Justicia Federal de Córdoba",
  "Justicia Federal de Corrientes",
  "Justicia Federal de General Roca",
  "Justicia Federal de La Plata",
  "Justicia Federal de Mar del Plata",
  "Justicia Federal de Mendoza",
  "Justicia Federal de Entre Ríos",
  "Justicia Federal de Santa Fe",
  "Justicia Federal de Misiones",
  "Justicia Federal de Resistencia",
  "Justicia Federal de Salta",
  "Justicia Federal de San Martín",
  "Justicia Federal de Tucumán",
];

const CABA_FUEROS = [
  "Cont. Adm., Tributario y de RC",
  "Penal, Contr. y de Faltas",
];

const PROVINCIA_FUEROS = [
  "civil y comercial",
  "contencioso administrativo",
  "familia",
  "juzgados de paz",
  "penal",
  "trabajo",
];

const PROVINCIA_DEPTOS = [
  "Avellaneda-Lanús",
  "Azul",
  "Bahía Blanca",
  "Dolores",
  "Junín",
  "La Matanza",
  "La Plata",
  "Lomas de Zamora",
  "Mar del Plata",
  "Mercedes",
  "Moreno-Gral. Rodríguez",
  "Morón",
  "Necochea",
  "Pergamino",
  "Quilmes",
  "San Isidro",
  "San Martín",
  "San Nicolás",
  "Trenque Lauquen",
  "Zárate-Campana",
];

function buildNumberedOptions(prefix: string, from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => `${prefix} ${from + i}`);
}

function getFueroOptions(jurisdiccion?: string) {
  if (jurisdiccion === "nacional") return NACIONAL_FUEROS;
  if (jurisdiccion === "federal") return FEDERAL_FUEROS;
  if (jurisdiccion === "caba") return CABA_FUEROS;
  if (jurisdiccion === "provincia_bs_as") return PROVINCIA_FUEROS;
  return [];
}

function getCourtOptions(jurisdiccion?: string, fuero?: string) {
  if (jurisdiccion === "nacional") {
    if (fuero === "Trabajo") {
      return buildNumberedOptions("Juzgado Nacional del Trabajo N°", 1, 80);
    }
    if (fuero === "Civil") {
      return buildNumberedOptions("Juzgado Nacional en lo Civil N°", 1, 110);
    }
    if (fuero === "Comercial") {
      return buildNumberedOptions("Juzgado Nacional en lo Comercial N°", 1, 31);
    }
  }

  if (jurisdiccion === "caba") {
    if (fuero === "Cont. Adm., Tributario y de RC") {
      return buildNumberedOptions("Juzgado CAYT N°", 1, 27);
    }
    if (fuero === "Penal, Contr. y de Faltas") {
      return buildNumberedOptions("Juzgado Penal CABA N°", 1, 30);
    }
  }

  return [];
}

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("es-AR");
}

function formatDateTimeFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function toDate(value?: any) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(value?: any) {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleDateString("es-AR");
}

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString("es-AR")} ${currency ?? ""}`.trim();
}

function fmtAmount(n?: number) {
  if (typeof n !== "number" || Number.isNaN(n)) return "-";
  return Number(n).toLocaleString("es-AR");
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function safeText(v: any) {
  return String(v ?? "").trim();
}

function valueOrDash(v?: string | null) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

function normalizeUrl(url?: string | null) {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function normalizeOrganisms(values?: string[]) {
  return Array.from(
    new Set((values ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))
  );
}

function getAllOrganismsFromMeta(meta?: any) {
  const multi = Array.isArray(meta?.otherOrganisms) ? meta.otherOrganisms : [];
  const single = String(meta?.otherOrganism ?? "").trim();

  return Array.from(
    new Set(
      [...multi, single]
        .map((x: any) => String(x ?? "").trim())
        .filter(Boolean)
    )
  );
}

function getContactFullName(c?: ContactDoc | null) {
  if (!c) return "";
  return (
    String(c.fullName ?? "").trim() ||
    `${String(c.name ?? "").trim()} ${String(c.lastName ?? "").trim()}`.trim()
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

function addMinutesToDateTimeLocal(value: string, minutes: number) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() + minutes);
  return formatDateTimeLocal(d);
}

const STATUS_LABEL: Record<CaseStatus, string> = {
  preliminar: "Preliminar",
  iniciada: "Iniciada",
  en_prueba: "En prueba",
  a_alegar: "A alegar",
  a_sentencia: "A sentencia",
  con_sentencia_primera_instancia: "Con sentencia de primera instancia",
  con_sentencia_segunda_instancia: "Con sentencia de segunda instancia",
  con_sentencia_ulterior_instancia: "Con sentencia de ulterior instancia",
  en_apelacion: "En apelación",
  recurso_extraordinario_local: "Recurso extraordinario local",
  ref: "REF",
  en_ejecucion: "En ejecución",
};

const LOGTYPE_LABEL: Record<LogType, string> = {
  informativa: "Informativa",
  vencimiento: "Vencimiento",
  audiencia: "Audiencia",
  control_cobro: "Control de cobro",
  reunion_parte: "Reunión con parte",
  sentencia: "Sentencia",
  recordatorio: "Recordatorio",
  registro_interaccion: "Registro de interacción",
  despacho_importante: "Despacho importante",
  pase_vista: "Pase / vista",
};

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

function jurisdiccionLabel(v?: string) {
  switch (v) {
    case "nacional":
      return "Nacional";
    case "federal":
      return "Federal";
    case "caba":
      return "CABA";
    case "provincia_bs_as":
      return "Provincia Bs. As.";
    case "entre_rios":
      return "Entre Ríos";
    case "etapa_administrativa":
      return "Etapa administrativa";
    case "otra":
      return "Otra";
    default:
      return valueOrDash(v);
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




export default function ManageCasePage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [myCases, setMyCases] = useState<QuickCaseRow[]>([]);
  const [quickSearch, setQuickSearch] = useState("");
  const [quickSearchFocused, setQuickSearchFocused] = useState(false);
  const [quickSearchSelectedIndex, setQuickSearchSelectedIndex] = useState(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);

  const [caseDoc, setCaseDoc] = useState<CaseDoc | null>(null);
  const [meta, setMeta] = useState<ManagementMeta | null>(null);
  const [savingMeta, setSavingMeta] = useState(false);

  const [parties, setParties] = useState<Party[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsPage, setLogsPage] = useState(1);

  const [involvedEmails, setInvolvedEmails] = useState<string[]>([]);
  const [assignedLawyerEmails, setAssignedLawyerEmails] = useState<string[]>([]);

  const [metaModalOpen, setMetaModalOpen] = useState(false);
    const [metaDraft, setMetaDraft] = useState<MetaDraft>({
    caratulaTentativa: "",
    physicalFolder: "",
    driveFolderUrl: "",
    expedienteNumber: "",
    court: "",
    fuero: "",
    jurisdiccion: "provincia_bs_as",
    deptoJudicial: "",
    status: "preliminar",
    tribunalAlzada: "",
    otherOrganism: "",
    otherOrganisms: [""],
    claimAmount: null,
    claimAmountDate: "",
  });

  const [lawyersModalOpen, setLawyersModalOpen] = useState(false);
  const [allLawyers, setAllLawyers] = useState<LawyerOption[]>([]);
  const [loadingLawyers, setLoadingLawyers] = useState(false);
  const [savingLawyers, setSavingLawyers] = useState(false);
  const [selectedAssignedUids, setSelectedAssignedUids] = useState<string[]>([]);

  const [newPartyRole, setNewPartyRole] = useState<PartyRole>("actor");

  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<Array<{ id: string } & ContactDoc>>([]);
  const [contactLoading, setContactLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState<({ id: string } & ContactDoc) | null>(
    null
  );
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSelectedIndex, setContactSelectedIndex] = useState(0);
  const [contactFocused, setContactFocused] = useState(false);

  const [createContactModalOpen, setCreateContactModalOpen] = useState(false);

  const [logType, setLogType] = useState<LogType>("informativa");
  const [logTitle, setLogTitle] = useState("");
  const [logBody, setLogBody] = useState("");
  const [calendarStart, setCalendarStart] = useState("");
  const [calendarEnd, setCalendarEnd] = useState("");
  const [calendarLocation, setCalendarLocation] = useState("");
  const [calendarEndManuallyEdited, setCalendarEndManuallyEdited] = useState(false);

  const [sentResult, setSentResult] = useState<"ganado" | "perdido" | "empatado">("ganado");
  const [sentResumen, setSentResumen] = useState("");
  const [sentPdf, setSentPdf] = useState<File | null>(null);
  const [savingLog, setSavingLog] = useState(false);

  const [archiveRequestOpen, setArchiveRequestOpen] = useState(false);
  const [archiveRequestJustification, setArchiveRequestJustification] = useState("");
  const [archiveRequestDone, setArchiveRequestDone] = useState(false);
  const [archiveRequestSaving, setArchiveRequestSaving] = useState(false);

  const [archivingCase, setArchivingCase] = useState(false);
  const [deletingPartyId, setDeletingPartyId] = useState<string | null>(null);

  const [caseChargesModalOpen, setCaseChargesModalOpen] = useState(false);
  const [caseChargesLoading, setCaseChargesLoading] = useState(false);
  const [caseChargesRows, setCaseChargesRows] = useState<CasePaidChargeRow[]>([]);
const [aiReportOpen, setAiReportOpen] = useState(false);
const [aiReportKind, setAiReportKind] = useState<"cliente" | "interno">("cliente");
const [aiReportTone, setAiReportTone] = useState<"breve" | "detallado">("breve");
const [aiReportText, setAiReportText] = useState("");
const [aiReportLoading, setAiReportLoading] = useState(false);
  const [participantLawyers, setParticipantLawyers] = useState<LawyerOption[]>([]);

const [initialDraftMarked, setInitialDraftMarked] = useState(false);
const [initialDraftResponsibleUid, setInitialDraftResponsibleUid] = useState("");
const [initialDraftDueDate, setInitialDraftDueDate] = useState("");
const [savingInitialDraftWorkflow, setSavingInitialDraftWorkflow] = useState(false);
const [alegatoMarked, setAlegatoMarked] = useState(false);
const [alegatoResponsibleUid, setAlegatoResponsibleUid] = useState("");
const [alegatoDueDate, setAlegatoDueDate] = useState("");
const [savingAlegatoWorkflow, setSavingAlegatoWorkflow] = useState(false);

const [interactionContactQuery, setInteractionContactQuery] = useState("");
const [interactionContactResults, setInteractionContactResults] = useState<
  Array<{ id: string } & ContactDoc>
>([]);
const [interactionSelectedContact, setInteractionSelectedContact] = useState<
  ({ id: string } & ContactDoc) | null
>(null);
const [interactionReport, setInteractionReport] = useState("");

const [despachoResumen, setDespachoResumen] = useState("");
const [despachoPdf, setDespachoPdf] = useState<File | null>(null);






// informativa
const [informativaOfficeNameDraft, setInformativaOfficeNameDraft] = useState("");
const [informativaOfficeAddressDraft, setInformativaOfficeAddressDraft] = useState("");
const [informativaProcessingModeDraft, setInformativaProcessingModeDraft] = useState<
  "deox" | "sistema_externo" | "email" | "papel"
>("deox");
const [informativaDueDateDraft, setInformativaDueDateDraft] = useState("");
const [informativaReiterationModeDraft, setInformativaReiterationModeDraft] = useState<
  "automatica" | "requiere_solicitud"
>("automatica");

// pericial
const [expertNameDraft, setExpertNameDraft] = useState("");
const [expertPointsDraft, setExpertPointsDraft] = useState("");

// instrumental en poder de la contraria
const [instrumentalRequiredDraft, setInstrumentalRequiredDraft] = useState("");
const [instrumentalDueDateDraft, setInstrumentalDueDateDraft] = useState("");

// confesional
const [confesionalAbsolventeDraft, setConfesionalAbsolventeDraft] = useState("");
const [confesionalDateTimeDraft, setConfesionalDateTimeDraft] = useState("");
const [confesionalPliegoDraft, setConfesionalPliegoDraft] = useState("");

// reconocimiento
const [reconocimientoDocumentalDraft, setReconocimientoDocumentalDraft] = useState("");
const [reconocimientoPersonaDraft, setReconocimientoPersonaDraft] = useState("");
const [reconocimientoDateTimeDraft, setReconocimientoDateTimeDraft] = useState("");

// otro
const [otherProofBodyDraft, setOtherProofBodyDraft] = useState("");  


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

  useEffect(() => {
    (async () => {
      if (!user) {
        setMyCases([]);
        return;
      }

      try {
        const qCases = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", user.uid),
          orderBy("createdAt", "desc"),
          limit(200)
        );

        const snap = await getDocs(qCases);

        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as QuickCaseRow[];

        setMyCases(rows);
      } catch {
        setMyCases([]);
      }
    })();
  }, [user]);

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
    if (!user) return;
    (async () => {
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

  useEffect(() => {
    setLogsPage(1);
  }, [logs.length, caseId]);

  const canWrite = useMemo(() => {
    if (role === "admin") return true;
    const u = user?.uid;
    const assignees = caseDoc?.confirmedAssigneesUids ?? [];
    return !!u && assignees.includes(u);
  }, [user, caseDoc, role]);

 const availableOrganisms = useMemo(() => {
  return getAllOrganismsFromMeta(meta);
}, [meta]);

useEffect(() => {
  if (!caseDoc) return;

  (async () => {
    try {
      const assignedUids = Array.from(
        new Set((caseDoc.confirmedAssigneesUids ?? []).filter(Boolean))
      );
      const involvedUids = Array.from(
        new Set([...(caseDoc.confirmedAssigneesUids ?? []), caseDoc.broughtByUid ?? ""].filter(Boolean))
      );

      if (involvedUids.length === 0) {
        setInvolvedEmails([]);
        setAssignedLawyerEmails([]);
        setParticipantLawyers([]);
        return;
      }

      const involvedDocs = await Promise.all(
        involvedUids.map((uid) => getDoc(doc(db, "users", uid)))
      );

      const involved = involvedDocs
        .map((s, idx) =>
          s.exists()
            ? {
                uid: involvedUids[idx],
                email: String((s.data() as UserDoc).email ?? "").trim(),
              }
            : null
        )
        .filter(Boolean) as LawyerOption[];

      setInvolvedEmails(
        Array.from(new Set(involved.map((x) => x.email).filter(Boolean)))
      );

      const assigned = involved.filter((x) => assignedUids.includes(x.uid));
      setAssignedLawyerEmails(
        Array.from(new Set(assigned.map((x) => x.email).filter(Boolean)))
      );
      setParticipantLawyers(assigned);
    } catch {
      setInvolvedEmails([]);
      setAssignedLawyerEmails([]);
      setParticipantLawyers([]);
    }
  })();
}, [caseDoc]);

useEffect(() => {
  const wf = caseDoc?.initialDraftWorkflow;

  if (wf?.status === "drafting" || wf?.status === "ready") {
    setInitialDraftMarked(true);
    setInitialDraftResponsibleUid(String(wf.responsibleUid ?? ""));
    setInitialDraftDueDate(String(wf.dueDate ?? ""));
    return;
  }

  setInitialDraftMarked(false);
  setInitialDraftResponsibleUid("");
  setInitialDraftDueDate("");
}, [caseDoc?.initialDraftWorkflow]);

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
          const full = safeLower(c.fullName || `${c.name ?? ""} ${c.lastName ?? ""}`.trim());
          return tokens.every((t) => full.includes(t));
        });

        if (!alive) return;
        setContactResults(filtered.slice(0, 10));
        setContactSelectedIndex(0);
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
    setQuickSearchSelectedIndex(0);
  }, [quickSearch]);

  function selectContact(c: { id: string } & ContactDoc) {
    const fullName = getContactFullName(c);
    setSelectedContact(c);
    setContactQuery(fullName);
    setContactResults([]);
    setContactSelectedIndex(0);
  }

  function clearSelectedContact() {
    setSelectedContact(null);
    setContactQuery("");
    setContactResults([]);
    setContactSelectedIndex(0);
    setNewPartyRole("actor");
  }

  function handleContactSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (contactResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setContactSelectedIndex((prev) =>
        prev + 1 >= contactResults.length ? 0 : prev + 1
      );
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

    if (e.key === "Escape") {
      e.preventDefault();
      setContactResults([]);
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

  function openMetaModal() {
    setMetaDraft({
      caratulaTentativa: caseDoc?.caratulaTentativa ?? "",
      physicalFolder: meta?.physicalFolder ?? "",
      driveFolderUrl: meta?.driveFolderUrl ?? "",
      expedienteNumber: meta?.expedienteNumber ?? "",
      court: meta?.court ?? "",
      fuero: meta?.fuero ?? "",
      jurisdiccion: meta?.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as",
      deptoJudicial: meta?.deptoJudicial ?? "",
      status: meta?.status ?? "preliminar",
      tribunalAlzada: String((meta as any)?.tribunalAlzada ?? ""),
            otherOrganism: "",
otherOrganisms:
  normalizeOrganisms((meta as any)?.otherOrganisms).length > 0
    ? normalizeOrganisms((meta as any)?.otherOrganisms)
    : String((meta as any)?.otherOrganism ?? "").trim()
    ? [String((meta as any)?.otherOrganism ?? "").trim()]
    : [""],
      claimAmount:
        typeof (meta as any)?.claimAmount === "number" ? (meta as any).claimAmount : null,
      claimAmountDate: String((meta as any)?.claimAmountDate ?? ""),
    });
    setMetaModalOpen(true);
  }

  async function openLawyersModal() {
    if (role !== "admin") return;

    setLawyersModalOpen(true);
    setLoadingLawyers(true);

    try {
      const currentAssigned = Array.from(
        new Set((caseDoc?.confirmedAssigneesUids ?? []).filter(Boolean))
      );

      const snap = await getDocs(query(collection(db, "users"), orderBy("email", "asc")));
      const lawyers = snap.docs
        .map((d) => ({
          uid: d.id,
          ...(d.data() as UserDoc),
        }))
        .filter((u) => {
          const roleValue = String(u.role ?? "").trim();
          return (
            roleValue === "abogado" ||
            roleValue === "lawyer" ||
            roleValue === "admin" ||
            currentAssigned.includes(u.uid)
          );
        })
        .map((u) => ({
          uid: u.uid,
          email: String(u.email ?? "").trim(),
        }))
        .filter((u) => u.uid && u.email);

      setAllLawyers(lawyers);
      setSelectedAssignedUids(currentAssigned);
    } catch (e: any) {
      alert(e?.message ?? "No pude cargar los abogados.");
      setAllLawyers([]);
      setSelectedAssignedUids(Array.from(new Set((caseDoc?.confirmedAssigneesUids ?? []).filter(Boolean))));
    } finally {
      setLoadingLawyers(false);
    }
  }

  function toggleAssignedLawyer(uid: string) {
    setSelectedAssignedUids((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  }

  async function saveAssignedLawyers() {
    if (!user) return;
    if (role !== "admin") {
      alert("Solo el administrador puede modificar los abogados asignados.");
      return;
    }

    const nextUids = Array.from(new Set(selectedAssignedUids.filter(Boolean)));
    const prevUids = Array.from(new Set((caseDoc?.confirmedAssigneesUids ?? []).filter(Boolean)));

    setSavingLawyers(true);
    try {
      await updateDoc(doc(db, "cases", caseId), {
        confirmedAssigneesUids: nextUids,
      });

      await updateDoc(managementMetaRef(caseId), {
        updatedAt: serverTimestamp(),
      });

            const prevEmails = allLawyers
        .filter((l) => prevUids.includes(l.uid))
        .map((l) => l.email)
        .sort((a, b) => a.localeCompare(b, "es"));

      const nextEmails = allLawyers
        .filter((l) => nextUids.includes(l.uid))
        .map((l) => l.email)
        .sort((a, b) => a.localeCompare(b, "es"));

      await addAutoLog({
        caseId,
        uid: user.uid,
        email: user.email ?? "",
        title: "Modificación de abogados asignados",
        body:
          `Antes: ${prevEmails.length > 0 ? prevEmails.join(", ") : "sin abogados asignados"}\n` +
          `Ahora: ${nextEmails.length > 0 ? nextEmails.join(", ") : "sin abogados asignados"}`,
        type: "informativa",
      });

      setLawyersModalOpen(false);
    } catch (e: any) {
      alert(e?.message ?? "No pude guardar los abogados asignados.");
    } finally {
      setSavingLawyers(false);
    }
  }

  async function saveMeta(
    patch: Partial<ManagementMeta>,
    maybeStatusChanged?: { from?: CaseStatus; to?: CaseStatus },
    casePatch?: Partial<CaseDoc>
  ) {
    if (!user) return;
    if (!canWrite) {
      alert("No tenés permisos de escritura en esta causa.");
      return;
    }

    setSavingMeta(true);

    try {
      await updateDoc(managementMetaRef(caseId), {
        ...(patch as any),
        updatedAt: serverTimestamp(),
      });

            setMeta((prev) => ({
        ...(prev ?? {}),
        ...(patch as any),
      }));

      const nextCaratula = String(
        casePatch?.caratulaTentativa ?? caseDoc?.caratulaTentativa ?? ""
      ).trim();
      const currentCaratula = String(caseDoc?.caratulaTentativa ?? "").trim();

      if (casePatch && Object.keys(casePatch).length > 0) {
        await updateDoc(doc(db, "cases", caseId), {
          ...casePatch,
        });
      }

      if (nextCaratula !== currentCaratula) {
        await syncCaseCaratulaToContactLinks({
          caseId,
          caratula: nextCaratula,
        });
      }

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
    const nextJurisdiccion =
      (metaDraft.jurisdiccion as any) ?? caseDoc?.jurisdiccion ?? "provincia_bs_as";

    let nextFuero = String(metaDraft.fuero ?? "");
    let nextCourt = String(metaDraft.court ?? "");

    const availableFueros = getFueroOptions(nextJurisdiccion);
    if (availableFueros.length > 0 && nextFuero && !availableFueros.includes(nextFuero)) {
      nextFuero = "";
      nextCourt = "";
    }

    const availableCourts = getCourtOptions(nextJurisdiccion, nextFuero);
    if (availableCourts.length > 0 && nextCourt && !availableCourts.includes(nextCourt)) {
      nextCourt = "";
    }

    const normalizedOtherOrganisms = normalizeOrganisms(
      (metaDraft.otherOrganisms ?? []).map((x) => String(x ?? ""))
    );

    await saveMeta(
      {
        physicalFolder: String(metaDraft.physicalFolder ?? ""),
        driveFolderUrl: String(metaDraft.driveFolderUrl ?? ""),
        expedienteNumber: String(metaDraft.expedienteNumber ?? ""),
        court: nextCourt,
        fuero: nextFuero,
        jurisdiccion: nextJurisdiccion,
        deptoJudicial:
          nextJurisdiccion === "provincia_bs_as" ? String(metaDraft.deptoJudicial ?? "") : "",
        status: to,
        tribunalAlzada: String(metaDraft.tribunalAlzada ?? ""),
otherOrganism: normalizedOtherOrganisms[0] ?? "",
otherOrganisms: normalizedOtherOrganisms,
        claimAmount:
          metaDraft.claimAmount == null
            ? null
            : Number(metaDraft.claimAmount),
        claimAmountDate: String(metaDraft.claimAmountDate ?? ""),
      } as any,
      { from, to },
     {
  caratulaTentativa: String(metaDraft.caratulaTentativa ?? ""),
  jurisdiccion: nextJurisdiccion,
  managementStatus: to,
}
    );
  }

  async function addParty() {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");
    if (!selectedContact) return alert("Seleccioná un contacto existente.");

    const name = getContactFullName(selectedContact).trim();
    if (!name) return alert("El contacto seleccionado no tiene nombre o razón social.");

    const contactId = selectedContact.id;
    const caratula = String(caseDoc?.caratulaTentativa ?? "").trim();

    await addDoc(partiesColRef(caseId), {
      name,
      role: newPartyRole,
      identification: String(selectedContact.dni ?? selectedContact.cuit ?? "").trim(),
      email: String(selectedContact.email ?? "").trim(),
      phone: String(selectedContact.phone ?? "").trim(),
      address: String(selectedContact.address ?? "").trim(),
      contactRef: { contactId },
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
    });

    await updateDoc(managementMetaRef(caseId), {
      updatedAt: serverTimestamp(),
    });

    await syncContactCaseLink({
      contactId,
      caseId,
      caratula,
      role: newPartyRole,
    });

    clearSelectedContact();
  }

  async function removeParty(partyId: string) {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");

    const party = parties.find((p) => p.id === partyId);
    if (!party) return;

    const ok = window.confirm(
      "¿Confirmás eliminar esta parte de esta causa? Esto no borrará el contacto de la agenda."
    );
    if (!ok) return;

    setDeletingPartyId(partyId);
    try {
      await deleteDoc(doc(partiesColRef(caseId), partyId));

      await updateDoc(managementMetaRef(caseId), {
        updatedAt: serverTimestamp(),
      });

      const contactId = String(party.contactRef?.contactId ?? "").trim();
      if (contactId) {
        await removeRoleFromContactCaseLink({
          contactId,
          caseId,
          role: party.role,
        });
      }
    } finally {
      setDeletingPartyId(null);
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
      storagePath: path,
    };
  }

  function buildCalendarTitle(rawTitle: string) {
    const prefix = (caseDoc?.caratulaTentativa ?? "").trim().slice(0, 15);
    const bracket = prefix ? `[${prefix}] ` : "";
    return `${bracket}${rawTitle}`.trim();
  }

async function createInitialDraftDeadlineEvent(params: {
  responsibleUid: string;
  responsibleEmail: string;
  dueDate: string;
}) {
  if (!user) throw new Error("No auth");

  const visibleToUids = Array.from(
    new Set((caseDoc?.confirmedAssigneesUids ?? []).filter(Boolean))
  );

  if (!params.dueDate || visibleToUids.length === 0) return;

  const start = new Date(`${params.dueDate}T09:00:00`);
  const end = new Date(`${params.dueDate}T10:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("La fecha límite no es válida.");
  }

  await addDoc(collection(db, "events"), {
    title: buildCalendarTitle("Vence redacción de presentación inicial"),
    description:
      `Responsable: ${params.responsibleEmail}\n` +
      `Fecha límite: ${params.dueDate}\n\n` +
      `Evento generado automáticamente al pasar la causa a redacción.`,
    startAt: Timestamp.fromDate(start),
    endAt: Timestamp.fromDate(end),
    allDay: false,
    color: "#dc2626",
    visibility: "selected_users",
    visibleToUids,
    ownerUid: user.uid,
    ownerEmail: user.email ?? "",
    source: "system",
    status: "active",
    createdAt: serverTimestamp(),
    createdByUid: user.uid,
    createdByEmail: user.email ?? "",
    caseRef: {
      caseId,
      caratula: String(caseDoc?.caratulaTentativa ?? "").trim(),
    },
    initialDraftWorkflowRef: {
      responsibleUid: params.responsibleUid,
      responsibleEmail: params.responsibleEmail,
      dueDate: params.dueDate,
    },
  });
}

  function handleCalendarStartChange(value: string) {
    setCalendarStart(value);

    if (!value) {
      setCalendarEnd("");
      setCalendarEndManuallyEdited(false);
      return;
    }

    if (!calendarEndManuallyEdited || !calendarEnd) {
      setCalendarEnd(addMinutesToDateTimeLocal(value, 30));
    }
  }

  function handleCalendarEndChange(value: string) {
    setCalendarEnd(value);
    setCalendarEndManuallyEdited(Boolean(value));
  }

  function openCaseFromQuickSearch(targetCaseId: string) {
    setQuickSearch("");
    setQuickSearchFocused(false);
    setQuickSearchSelectedIndex(0);
    router.push(`/cases/manage/${targetCaseId}`);
  }

  function handleQuickSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (quickSearchResults.length === 0) return;
      setQuickSearchSelectedIndex((prev) =>
        prev + 1 >= quickSearchResults.length ? 0 : prev + 1
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (quickSearchResults.length === 0) return;
      setQuickSearchSelectedIndex((prev) =>
        prev - 1 < 0 ? quickSearchResults.length - 1 : prev - 1
      );
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (quickSearchResults.length > 0) {
        const picked =
          quickSearchResults[
            Math.min(quickSearchSelectedIndex, quickSearchResults.length - 1)
          ];
        if (picked) openCaseFromQuickSearch(picked.id);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setQuickSearchFocused(false);
    }
  }

  async function addLogEntry() {
    if (!user) return;
    if (!canWrite) return alert("Sin permisos.");

    const title = logTitle.trim();
    if (!title) return alert("Ingresá un título.");

    if (logType === "sentencia") {
      if (!sentPdf) return alert("Para 'Sentencia' tenés que subir sí o sí el PDF.");
      if (sentPdf.type !== "application/pdf") {
        return alert("El archivo de sentencia debe ser un PDF.");
      }
      if (sentPdf.size > 20 * 1024 * 1024) {
        return alert("El PDF no puede superar los 20 MB.");
      }
      if (!sentResumen.trim()) return alert("Para 'Sentencia' tenés que completar el resumen.");
      if (!sentResult) return alert("Para 'Sentencia' tenés que indicar resultado.");
    }

    const calendarTypesWithRange: LogType[] = [
      "vencimiento",
      "control_cobro",
      "audiencia",
      "reunion_parte",
    ];
    const singleDateTypes: LogType[] = ["recordatorio"];

    const wantsCalendar =
      (calendarTypesWithRange.includes(logType) || singleDateTypes.includes(logType)) &&
      calendarStart;

    if ((calendarTypesWithRange.includes(logType) || singleDateTypes.includes(logType)) && !calendarStart) {
      return alert("Ingresá fecha y hora.");
    }

    setSavingLog(true);

    let uploadedSentenciaFile:
      | {
          pdfUrl: string;
          pdfName: string;
          storagePath: string;
        }
      | null = null;

    try {
            let sentenciaPayload: any = null;
      let interactionPayload: any = null;
      let despachoPayload: any = null;
      let uploadedDespachoFile:
        | {
            pdfUrl: string;
            pdfName: string;
            storagePath: string;
          }
        | null = null;

      if (logType === "sentencia") {
        uploadedSentenciaFile = await uploadSentenciaPdf(sentPdf!);

        sentenciaPayload = {
          resumen: sentResumen.trim(),
          resultado: sentResult,
          pdfUrl: uploadedSentenciaFile.pdfUrl,
          pdfName: uploadedSentenciaFile.pdfName,
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
          pdfUrl: uploadedSentenciaFile.pdfUrl,
          pdfName: uploadedSentenciaFile.pdfName,
        });
      }

      if (logType === "registro_interaccion") {
        interactionPayload = {
          contactId: interactionSelectedContact?.id ?? "",
          contactName: getContactFullName(interactionSelectedContact),
          report: interactionReport.trim(),
        };
      }

      if (logType === "despacho_importante" && despachoPdf) {
        const safeName = sanitizeFileName(despachoPdf.name);
        const path = `cases/${caseId}/despachos/${Date.now()}_${safeName}`;
        const fileRef = ref(storage, path);

        await uploadBytes(fileRef, despachoPdf, {
          contentType: despachoPdf.type || "application/pdf",
        });

        const pdfUrl = await getDownloadURL(fileRef);

        uploadedDespachoFile = {
          pdfUrl,
          pdfName: despachoPdf.name,
          storagePath: path,
        };

        despachoPayload = {
          resumen: despachoResumen.trim(),
          pdfUrl,
          pdfName: despachoPdf.name,
        };
      }

      let calendarPayload: any = null;
      let calendarStartDate: Date | null = null;
      let calendarEndDate: Date | null = null;

      if (wantsCalendar) {
        const start = new Date(calendarStart);
        if (Number.isNaN(start.getTime())) {
          throw new Error("La fecha/hora ingresada no es válida.");
        }

        calendarStartDate = start;

        if (calendarTypesWithRange.includes(logType)) {
          const end = calendarEnd ? new Date(calendarEnd) : new Date(start.getTime() + 60 * 60 * 1000);
          calendarEndDate = end;

          calendarPayload = {
            startAt: Timestamp.fromDate(start),
            endAt: Timestamp.fromDate(end),
            location: calendarLocation.trim(),
            generatedTitle: buildCalendarTitle(title),
            attendees: involvedEmails,
            preferredCalendarName: "Trabajo",
          };
        } else {
          calendarPayload = {
            startAt: Timestamp.fromDate(start),
            endAt: null,
            location: calendarLocation.trim(),
            generatedTitle: buildCalendarTitle(title),
            attendees: involvedEmails,
            preferredCalendarName: "Trabajo",
          };
        }
      }

      const logRef = await addDoc(logsColRef(caseId), {
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
                interaction: interactionPayload,
        despachoImportante: despachoPayload,
      });

      if (wantsCalendar && calendarStartDate) {
        await createAutoEventFromCaseLog({
          caseId,
          caratula: String(caseDoc?.caratulaTentativa ?? "").trim(),
          ownerUid: user.uid,
          ownerEmail: user.email ?? "",
          caseParticipantUids: caseDoc?.confirmedAssigneesUids ?? [],
          logId: logRef.id,
          logType,
          title: buildCalendarTitle(title),
          body: logBody.trim(),
          startAt: calendarStartDate,
          endAt: calendarEndDate ?? undefined,
          location: calendarLocation.trim(),
        });
      }

      await updateDoc(managementMetaRef(caseId), {
        updatedAt: serverTimestamp(),
        lastLogAt: serverTimestamp(),
        lastLogByUid: user.uid,
        lastLogTitle: title,
      });

      await updateDoc(doc(db, "cases", caseId), {
        dashboardLastLogAt: serverTimestamp(),
        dashboardLastLogTitle: title,
        dashboardLastLogByEmail: user.email ?? "",
      });

      setLogTitle("");
      setLogBody("");
      setCalendarStart("");
      setCalendarEnd("");
      setCalendarEndManuallyEdited(false);
      setCalendarLocation("");
      setSentPdf(null);
      setSentResumen("");
      setSentResult("ganado");
      setLogType("informativa");
            setInteractionContactQuery("");
      setInteractionSelectedContact(null);
      setInteractionReport("");
      setDespachoResumen("");
      setDespachoPdf(null);
    } catch (e: any) {
      if (uploadedSentenciaFile?.storagePath) {
        try {
          await deleteObject(ref(storage, uploadedSentenciaFile.storagePath));
        } catch (cleanupError) {
          console.error("No se pudo borrar el PDF subido tras el error:", cleanupError);
        }
      }

      console.error(e);
      alert(e?.message ?? "No se pudo guardar la entrada.");
    } finally {
      setSavingLog(false);
    }
  }

  function handleLogFormKeyDown(
    e:
      | React.KeyboardEvent<HTMLInputElement>
      | React.KeyboardEvent<HTMLSelectElement>
      | React.KeyboardEvent<HTMLTextAreaElement>
  ) {
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;
    if ((e.target as HTMLElement).tagName.toLowerCase() === "textarea") return;

    e.preventDefault();
    if (!savingLog && canWrite) {
      void addLogEntry();
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

  async function openCaseChargesModal() {
    if (!user) return;

    setCaseChargesModalOpen(true);
    setCaseChargesLoading(true);

    try {
      const qCharges = query(
        collection(db, "charges"),
        where("visibleToUids", "array-contains", user.uid),
        where("status", "==", "paid"),
        limit(1000)
      );

      const snap = await getDocs(qCharges);

      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as CasePaidChargeRow)
        .filter((row) => String(row.caseRef?.caseId ?? "").trim() === caseId);

      setCaseChargesRows(rows);
    } catch (e: any) {
      alert(e?.message ?? "No pude cargar los cobros de esta causa.");
      setCaseChargesRows([]);
    } finally {
      setCaseChargesLoading(false);
    }
  }

async function handleGenerateAiReport() {
  try {
    setAiReportLoading(true);
    setAiReportText("");

    const res = await generateCaseReport({
      caseId,
      kind: aiReportKind,
      tone: aiReportTone,
    });

    const text = String(res.report ?? "").trim();
    if (!text) {
      throw new Error("La IA no devolvió contenido.");
    }

    setAiReportText(text);
    setAiReportOpen(true);
  } catch (e: any) {
    alert(e?.message ?? "No se pudo generar el informe con IA.");
  } finally {
    setAiReportLoading(false);
  }
}

  const archiveStatusText = archiveRequestDone
    ? "Solicitud de archivo realizada"
    : "Solicitar archivo de la causa";

  const driveFolderHref = normalizeUrl(meta?.driveFolderUrl);

  const showNoContactsFound =
    contactQuery.trim().length >= 2 &&
    !contactLoading &&
    !contactError &&
    contactResults.length === 0 &&
    !selectedContact;

  const sortedCaseCharges = useMemo(() => {
    return [...caseChargesRows].sort((a, b) => {
      const aa = toDate(a.paidAt)?.getTime() ?? 0;
      const bb = toDate(b.paidAt)?.getTime() ?? 0;
      return bb - aa;
    });
  }, [caseChargesRows]);

  const caseChargesGrossTotal = useMemo(() => {
    return sortedCaseCharges.reduce(
      (sum, row) => sum + Number(row.distribution?.grossAmount ?? row.totalAmount ?? 0),
      0
    );
  }, [sortedCaseCharges]);

  const caseChargesMyNetTotal = useMemo(() => {
    return sortedCaseCharges.reduce((sum, row) => sum + getChargeUserNetAmount(row, user?.uid), 0);
  }, [sortedCaseCharges, user?.uid]);

  const quickSearchResults = useMemo(() => {
    const term = safeLower(quickSearch);
    if (!term) return [];

    return [...myCases]
      .filter((c) => {
        if (c.id === caseId) return false;
        const caratula = safeLower(c.caratulaTentativa);
        return Boolean(caratula) && caratula.includes(term);
      })
      .sort((a, b) =>
        safeText(a.caratulaTentativa).localeCompare(safeText(b.caratulaTentativa), "es")
      )
      .slice(0, 8);
  }, [myCases, quickSearch, caseId]);

  const availableMetaFueroOptions = useMemo(() => {
    return getFueroOptions(
      metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as"
    );
  }, [metaDraft.jurisdiccion, caseDoc?.jurisdiccion]);

  const availableMetaCourtOptions = useMemo(() => {
    return getCourtOptions(
      metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as",
      String(metaDraft.fuero ?? "")
    );
  }, [metaDraft.jurisdiccion, caseDoc?.jurisdiccion, metaDraft.fuero]);

  const totalLogPages = Math.max(1, Math.ceil(logs.length / LOGS_PER_PAGE));

  const paginatedLogs = useMemo(() => {
    const start = (logsPage - 1) * LOGS_PER_PAGE;
    return logs.slice(start, start + LOGS_PER_PAGE);
  }, [logs, logsPage]);

  useEffect(() => {
    if (logsPage > totalLogPages) {
      setLogsPage(totalLogPages);
    }
  }, [logsPage, totalLogPages]);

const currentManagementStatus = (meta?.status ??
  caseDoc?.managementStatus ??
  "preliminar") as CaseStatus;

const initialDraftWorkflow = caseDoc?.initialDraftWorkflow;
const alegatoWorkflow = caseDoc?.alegatoWorkflow;

const isAlegatoInDrafting =
  currentManagementStatus === "a_alegar" &&
  alegatoWorkflow?.status === "drafting";

const isAlegatoReady =
  currentManagementStatus !== "a_sentencia" &&
  alegatoWorkflow?.status === "ready";

const canMarkAlegatoFirstDraftCompleted =
  !!user &&
  isAlegatoInDrafting &&
  user.uid === alegatoWorkflow?.responsibleUid &&
  !alegatoWorkflow?.firstDraftCompletedAt;

const canMarkAlegatoReviewed =
  !!user &&
  isAlegatoInDrafting &&
  !!alegatoWorkflow?.firstDraftCompletedAt &&
  user.uid !== alegatoWorkflow?.responsibleUid &&
  (caseDoc?.confirmedAssigneesUids ?? []).includes(user.uid) &&
  !alegatoWorkflow?.reviewedAt;
const isInitialDraftInDrafting =
  currentManagementStatus === "preliminar" &&
  initialDraftWorkflow?.status === "drafting";

const isInitialDraftReady =
  currentManagementStatus !== "iniciada" &&
  initialDraftWorkflow?.status === "ready";

const canMarkFirstDraftCompleted =
  !!user &&
  isInitialDraftInDrafting &&
  user.uid === initialDraftWorkflow?.responsibleUid &&
  !initialDraftWorkflow?.firstDraftCompletedAt;

const canMarkDraftReviewed =
  !!user &&
  isInitialDraftInDrafting &&
  !!initialDraftWorkflow?.firstDraftCompletedAt &&
  user.uid !== initialDraftWorkflow?.responsibleUid &&
  (caseDoc?.confirmedAssigneesUids ?? []).includes(user.uid) &&
  !initialDraftWorkflow?.reviewedAt;

function resetLocalInitialDraftForm() {
  setInitialDraftMarked(false);
  setInitialDraftResponsibleUid("");
  setInitialDraftDueDate("");
}

async function saveInitialDraftWorkflow() {
  if (!user) return;
  if (!canWrite) return alert("No tenés permisos de escritura en esta causa.");
  if (currentManagementStatus !== "preliminar") {
    return alert("Este panel solo está disponible para causas en estado preliminar.");
  }
  if (!initialDraftMarked) {
    return alert("Primero tildá 'Pasar causa a redacción'.");
  }
  if (!initialDraftResponsibleUid) {
    return alert("Seleccioná un responsable de redacción.");
  }
  if (!initialDraftDueDate) {
    return alert("Ingresá una fecha límite.");
  }

  const responsible = participantLawyers.find((x) => x.uid === initialDraftResponsibleUid);
  if (!responsible) {
    return alert("No encontré al abogado responsable seleccionado.");
  }

  const ok = window.confirm(
    "¿Confirmás pasar la causa a redacción de demanda o presentación inicial?"
  );
  if (!ok) return;

  setSavingInitialDraftWorkflow(true);
  try {
    await updateDoc(doc(db, "cases", caseId), {
      initialDraftWorkflow: {
        status: "drafting",
        responsibleUid: responsible.uid,
        responsibleEmail: responsible.email,
        dueDate: initialDraftDueDate,
        startedAt: serverTimestamp(),
        startedByUid: user.uid,
        startedByEmail: user.email ?? "",
      },
      managementStatus: currentManagementStatus,
    });

    await createInitialDraftDeadlineEvent({
      responsibleUid: responsible.uid,
      responsibleEmail: responsible.email,
      dueDate: initialDraftDueDate,
    });

    await addAutoLog({
      caseId,
      uid: user.uid,
      email: user.email ?? "",
      title: "Causa pasada a redacción de presentación inicial",
      body:
        `Responsable: ${responsible.email}\n` +
        `Fecha límite: ${initialDraftDueDate}`,
      type: "informativa",
    });
  } catch (e: any) {
    alert(e?.message ?? "No se pudo guardar el flujo de redacción.");
  } finally {
    setSavingInitialDraftWorkflow(false);
  }
}


async function markFirstDraftCompleted() {
  if (!user) return;
  if (!canMarkFirstDraftCompleted) return;

  const ok = window.confirm("¿Confirmás marcar la primera redacción como terminada?");
  if (!ok) return;

  setSavingInitialDraftWorkflow(true);
  try {
    await updateDoc(doc(db, "cases", caseId), {
      "initialDraftWorkflow.firstDraftCompletedAt": serverTimestamp(),
      "initialDraftWorkflow.firstDraftCompletedByUid": user.uid,
      "initialDraftWorkflow.firstDraftCompletedByEmail": user.email ?? "",
    });

    await addAutoLog({
      caseId,
      uid: user.uid,
      email: user.email ?? "",
      title: "Primera redacción terminada",
      body: "La primera versión de la presentación inicial quedó terminada.",
      type: "informativa",
    });
  } catch (e: any) {
    alert(e?.message ?? "No se pudo marcar la primera redacción como terminada.");
  } finally {
    setSavingInitialDraftWorkflow(false);
  }
}

async function markDraftReviewed() {
  if (!user) return;
  if (!canMarkDraftReviewed) return;

  const ok = window.confirm(
    "¿Confirmás marcar la revisión realizada por otro abogado? La causa quedará como lista para presentar."
  );
  if (!ok) return;

  setSavingInitialDraftWorkflow(true);
  try {
    await updateDoc(doc(db, "cases", caseId), {
      "initialDraftWorkflow.status": "ready",
      "initialDraftWorkflow.reviewedAt": serverTimestamp(),
      "initialDraftWorkflow.reviewedByUid": user.uid,
      "initialDraftWorkflow.reviewedByEmail": user.email ?? "",
    });

    await addAutoLog({
      caseId,
      uid: user.uid,
      email: user.email ?? "",
      title: "Presentación inicial redactada y revisada",
      body: "La primera presentación quedó redactada y lista para presentar.",
      type: "informativa",
    });
  } catch (e: any) {
    alert(e?.message ?? "No se pudo marcar la revisión.");
  } finally {
    setSavingInitialDraftWorkflow(false);
  }
}

async function saveAlegatoWorkflow() {
  if (!user) return;
  if (!canWrite) return alert("No tenés permisos de escritura en esta causa.");
  if (currentManagementStatus !== "a_alegar") {
    return alert("Este panel solo está disponible para causas en estado 'A alegar'.");
  }
  if (!alegatoMarked) {
    return alert("Primero tildá 'Pasar alegato a redacción'.");
  }
  if (!alegatoResponsibleUid) {
    return alert("Seleccioná un responsable.");
  }
  if (!alegatoDueDate) {
    return alert("Ingresá una fecha límite.");
  }

  const responsible = participantLawyers.find((x) => x.uid === alegatoResponsibleUid);
  if (!responsible) return alert("No encontré al abogado responsable seleccionado.");

  const ok = window.confirm("¿Confirmás pasar el alegato a redacción?");
  if (!ok) return;

  setSavingAlegatoWorkflow(true);
  try {
    await updateDoc(doc(db, "cases", caseId), {
      alegatoWorkflow: {
        status: "drafting",
        responsibleUid: responsible.uid,
        responsibleEmail: responsible.email,
        dueDate: alegatoDueDate,
        startedAt: serverTimestamp(),
        startedByUid: user.uid,
        startedByEmail: user.email ?? "",
      },
    });

    await addAutoLog({
      caseId,
      uid: user.uid,
      email: user.email ?? "",
      title: "Alegato pasado a redacción",
      body: `Responsable: ${responsible.email}\nFecha límite: ${alegatoDueDate}`,
      type: "informativa",
    });
  } catch (e: any) {
    alert(e?.message ?? "No se pudo guardar el flujo de alegato.");
  } finally {
    setSavingAlegatoWorkflow(false);
  }
}

async function markAlegatoFirstDraftCompleted() {
  if (!user || !canMarkAlegatoFirstDraftCompleted) return;

  const ok = window.confirm("¿Confirmás marcar la primera redacción del alegato como terminada?");
  if (!ok) return;

  setSavingAlegatoWorkflow(true);
  try {
    await updateDoc(doc(db, "cases", caseId), {
      "alegatoWorkflow.firstDraftCompletedAt": serverTimestamp(),
      "alegatoWorkflow.firstDraftCompletedByUid": user.uid,
      "alegatoWorkflow.firstDraftCompletedByEmail": user.email ?? "",
    });

    await addAutoLog({
      caseId,
      uid: user.uid,
      email: user.email ?? "",
      title: "Primera redacción del alegato terminada",
      body: "",
      type: "informativa",
    });
  } catch (e: any) {
    alert(e?.message ?? "No se pudo marcar la primera redacción del alegato.");
  } finally {
    setSavingAlegatoWorkflow(false);
  }
}

async function markAlegatoReviewed() {
  if (!user || !canMarkAlegatoReviewed) return;

  const ok = window.confirm("¿Confirmás marcar el alegato como revisado por otro abogado?");
  if (!ok) return;

  setSavingAlegatoWorkflow(true);
  try {
    await updateDoc(doc(db, "cases", caseId), {
      "alegatoWorkflow.status": "ready",
      "alegatoWorkflow.reviewedAt": serverTimestamp(),
      "alegatoWorkflow.reviewedByUid": user.uid,
      "alegatoWorkflow.reviewedByEmail": user.email ?? "",
    });

    await addAutoLog({
      caseId,
      uid: user.uid,
      email: user.email ?? "",
      title: "Alegato redactado y revisado",
      body: "El alegato quedó listo.",
      type: "informativa",
    });
  } catch (e: any) {
    alert(e?.message ?? "No se pudo marcar la revisión del alegato.");
  } finally {
    setSavingAlegatoWorkflow(false);
  }
}

const proofControlItems = Array.isArray((meta as any)?.proofControl)
  ? ((meta as any).proofControl as any[])
  : [];



  return (
    <AppShell
      title="Gestionar causa"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Gestión de causas", href: "/cases/manage" },
        { label: "Gestionar causa" },
      ]}
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
          <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Buscador rápido de causas
            </div>

            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Buscá otra causa en la que intervenís para saltar directo a su gestión.
            </div>

            <div className="relative mt-3">
              <input
                value={quickSearch}
                onChange={(e) => setQuickSearch(e.target.value)}
                onFocus={() => setQuickSearchFocused(true)}
                onBlur={() => {
                  setTimeout(() => setQuickSearchFocused(false), 150);
                }}
                onKeyDown={handleQuickSearchKeyDown}
                placeholder="Ej.: Pérez c/ Gómez s/ alimentos"
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
              />

              {quickSearchFocused && safeText(quickSearch) ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
                  {quickSearchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                      No hay coincidencias.
                    </div>
                  ) : (
                    quickSearchResults.map((item, idx) => {
                      const isActive = idx === quickSearchSelectedIndex;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setQuickSearchSelectedIndex(idx)}
                          onClick={() => openCaseFromQuickSearch(item.id)}
                          className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 dark:border-gray-800 ${
                            isActive
                              ? "bg-gray-100 dark:bg-gray-800"
                              : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                          }`}
                        >
                          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                            {item.caratulaTentativa || "(sin carátula)"}
                          </div>
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            Abrir gestión de la causa
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          </div>

<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
  <div className="min-w-0">
    <div className="text-xs text-gray-600 dark:text-gray-300">Causa</div>
    <div className="truncate text-lg font-black text-gray-900 dark:text-gray-100">
      {caseDoc.caratulaTentativa || "(sin carátula)"}
    </div>

    {isInitialDraftInDrafting ? (
      <div className="mt-2 inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-black text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
        Causa con presentación inicial en redacción
      </div>
    ) : null}

    {isInitialDraftReady ? (
      <div className="mt-2 inline-flex rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-black text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-200">
        Primera presentación redactada - lista para presentar
      </div>
    ) : null}
  </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <button
                type="button"
                onClick={openCaseChargesModal}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Ver cobros
              </button>

<button
  type="button"
  onClick={handleGenerateAiReport}
  disabled={aiReportLoading}
  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
>
  {aiReportLoading ? "Generando..." : "Generar informe con IA"}
</button>

              <Link
                href={`/cobranzas/registrar?caseId=${caseId}`}
                className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90"
              >
                Registrar cobro
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
{[
  "con_sentencia_primera_instancia",
  "con_sentencia_segunda_instancia",
  "con_sentencia_ulterior_instancia",
].includes(currentManagementStatus) ? (
  <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-100">
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={false}
        onChange={async () => {
          if (!user) return;
          if (!canWrite) return;

          const ok = window.confirm(
            "¿Confirmás que la sentencia adquirió firmeza? El estado procesal pasará a 'En ejecución'."
          );
          if (!ok) return;

          try {
            await updateDoc(managementMetaRef(caseId), {
              status: "en_ejecucion",
              sentenceFirm: true,
              sentenceFirmMarkedAt: serverTimestamp(),
              sentenceFirmMarkedByUid: user.uid,
              sentenceFirmMarkedByEmail: user.email ?? "",
              updatedAt: serverTimestamp(),
            });

            await updateDoc(doc(db, "cases", caseId), {
              managementStatus: "en_ejecucion",
            });

            await addAutoLog({
              caseId,
              uid: user.uid,
              email: user.email ?? "",
              title: "Sentencia adquirió firmeza",
              body: "La causa pasó automáticamente a etapa de ejecución.",
              type: "informativa",
            });
          } catch (e: any) {
            alert(e?.message ?? "No se pudo registrar la firmeza.");
          }
        }}
        className="h-4 w-4"
      />
      <span className="font-black">Sentencia adquirió firmeza</span>
    </label>
  </div>
) : null}

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  Información de la causa
                </div>
                <button
                  type="button"
                  onClick={openMetaModal}
                  disabled={!canWrite}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Modificar Información de la causa
                </button>
              </div>

              <div className="mt-3 grid gap-2 text-sm text-gray-800 dark:text-gray-100">
                <div>
                  <span className="font-black">Carátula:</span>{" "}
                  <span>{valueOrDash(caseDoc.caratulaTentativa)}</span>
                </div>
                <div>
                  <span className="font-black">Carpeta física:</span>{" "}
                  <span>{valueOrDash(meta?.physicalFolder)}</span>
                </div>

                <div>
                  <span className="font-black">Vínculo carpeta Drive:</span>{" "}
                  {driveFolderHref ? (
                    <a
                      href={driveFolderHref}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-extrabold text-blue-700 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                      title="Abrir carpeta de Google Drive"
                    >
                      {meta?.driveFolderUrl}
                    </a>
                  ) : (
                    <span className="break-all">{valueOrDash(meta?.driveFolderUrl)}</span>
                  )}
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
                  <span>{jurisdiccionLabel(meta?.jurisdiccion ?? caseDoc?.jurisdiccion)}</span>
                </div>
                <div>
                  <span className="font-black">Departamento judicial:</span>{" "}
                  <span>{valueOrDash(meta?.deptoJudicial)}</span>
                </div>
                <div>
                  <span className="font-black">Tribunal de Alzada:</span>{" "}
                  <span>{valueOrDash((meta as any)?.tribunalAlzada)}</span>
                </div>
                <div>
  <span className="font-black">Otros organismos intervinientes:</span>{" "}
  <span>{availableOrganisms.length > 0 ? availableOrganisms.join(", ") : "-"}</span>
</div>
                <div>
                  <span className="font-black">Monto del juicio:</span>{" "}
                  <span>${fmtAmount((meta as any)?.claimAmount)}</span>
                </div>
                <div>
                  <span className="font-black">Fecha determinación monto:</span>{" "}
                  <span>{valueOrDash((meta as any)?.claimAmountDate)}</span>
                </div>
                <div>
                  <span className="font-black">Estado:</span>{" "}
                  <span>{STATUS_LABEL[(meta?.status ?? "preliminar") as CaseStatus] ?? "-"}</span>
                </div>

                <div className="flex flex-wrap items-start gap-2">
                  <span className="font-black">Abogados asignados:</span>
                  <span className="flex-1">
                    {assignedLawyerEmails.length > 0 ? assignedLawyerEmails.join(", ") : "-"}
                  </span>

                  {role === "admin" ? (
                    <button
                      type="button"
                      onClick={openLawyersModal}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      Modificar abogados
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">Partes</div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {parties.length} cargadas
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-gray-100 dark:border-gray-800">
                {parties.length === 0 ? (
                  <div className="p-3 text-sm text-gray-700 dark:text-gray-200">
                    No hay partes cargadas.
                  </div>
                ) : (
                  parties.map((p, idx) => (
                    <div
                      key={p.id}
                      className={`flex items-start justify-between gap-3 p-3 ${
                        idx % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/40"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                          {roleLabel(p.role).toUpperCase()}: {p.name}
                        </div>

                        {p.email || p.phone ? (
                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {p.email ? p.email : ""}
                            {p.email && p.phone ? " · " : ""}
                            {p.phone ? p.phone : ""}
                          </div>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        onClick={() => removeParty(p.id)}
                        disabled={!canWrite || deletingPartyId === p.id}
                        className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                      >
                        {deletingPartyId === p.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  Agregar parte
                </div>

                <div className="mt-3">
                  <div className="relative">
                    <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Buscar por apellido, nombre o razón social
                    </label>

                    <div className="mt-1 flex gap-2">
                      <input
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                        placeholder="Buscar por apellido, nombre o razón social"
                        value={contactQuery}
                        onFocus={() => setContactFocused(true)}
                        onBlur={() => {
                          setTimeout(() => setContactFocused(false), 150);
                        }}
                        onKeyDown={handleContactSearchKeyDown}
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
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-200">
                        {contactError}
                      </div>
                    ) : null}

                    {showNoContactsFound ? (
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        No hay contactos con ese nombre.
                      </div>
                    ) : null}

                    {contactFocused && contactResults.length > 0 ? (
                      <div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
                        {contactResults.map((c, idx) => {
                          const fullName = getContactFullName(c);
                          const isActive = idx === contactSelectedIndex;

                          return (
                            <button
                              key={c.id}
                              type="button"
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setContactSelectedIndex(idx)}
                              onClick={() => selectContact(c)}
                              className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                                isActive
                                  ? "bg-gray-100 dark:bg-gray-800"
                                  : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                              }`}
                              disabled={!canWrite}
                            >
                              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                                {fullName || "(sin nombre)"}
                              </div>

                              <div className="text-xs text-gray-600 dark:text-gray-300">
                                {c.dni ? `DNI: ${c.dni}` : ""}
                                {c.cuit ? `${c.dni ? " · " : ""}CUIT/CUIL: ${c.cuit}` : ""}
                                {c.email ? `${c.dni || c.cuit ? " · " : ""}${c.email}` : ""}
                                {c.phone ? `${c.dni || c.cuit || c.email ? " · " : ""}${c.phone}` : ""}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {selectedContact ? (
                    <div className="mt-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                      <div className="font-black">{getContactFullName(selectedContact)}</div>

                      <div className="mt-1 text-xs">
                        {selectedContact.dni ? `DNI: ${selectedContact.dni}` : ""}
                        {selectedContact.cuit
                          ? `${selectedContact.dni ? " · " : ""}CUIT/CUIL: ${selectedContact.cuit}`
                          : ""}
                        {selectedContact.email
                          ? `${selectedContact.dni || selectedContact.cuit ? " · " : ""}${selectedContact.email}`
                          : ""}
                        {selectedContact.phone
                          ? `${selectedContact.dni || selectedContact.cuit || selectedContact.email ? " · " : ""}${selectedContact.phone}`
                          : ""}
                      </div>

                      {selectedContact.address ? (
                        <div className="mt-1 text-xs">Domicilio: {selectedContact.address}</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {selectedContact ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div>
                      <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                        Agregar parte
                      </label>
                      <select
                        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                        value={newPartyRole}
                        onChange={(e) => setNewPartyRole(e.target.value as PartyRole)}
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

                    <div className="flex items-end">
                      <button
                        className="w-full rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                        disabled={!canWrite}
                        onClick={addParty}
                      >
                        Agregar parte
                      </button>
                    </div>
                  </div>
                ) : null}

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

{currentManagementStatus === "preliminar" && !isInitialDraftReady ? (
  <div className="mt-4 rounded-2xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-900 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
        Redacción de demanda o presentación inicial
      </div>

      {initialDraftWorkflow?.status === "drafting" ? (
        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-black text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          EN REDACCIÓN
        </span>
      ) : null}
    </div>

    {!initialDraftWorkflow?.status ? (
      <>
        <div className="mt-3 grid gap-3">
          <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
            <input
              type="checkbox"
              checked={initialDraftMarked}
              onChange={() => {
                if (!initialDraftMarked) setInitialDraftMarked(true);
              }}
              disabled={!canWrite || initialDraftMarked}
              className="h-4 w-4"
            />
            <span>Pasar causa a redacción</span>
          </label>

          {initialDraftMarked ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  Responsable de redacción
                </span>
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={initialDraftResponsibleUid}
                  onChange={(e) => setInitialDraftResponsibleUid(e.target.value)}
                  disabled={!canWrite}
                >
                  <option value="">Seleccionar…</option>
                  {participantLawyers.map((lawyer) => (
                    <option key={lawyer.uid} value={lawyer.uid}>
                      {lawyer.email}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  Fecha límite
                </span>
                <input
                  type="date"
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={initialDraftDueDate}
                  onChange={(e) => setInitialDraftDueDate(e.target.value)}
                  disabled={!canWrite}
                />
              </label>

              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button
                  type="button"
                  onClick={saveInitialDraftWorkflow}
                  disabled={!canWrite || savingInitialDraftWorkflow}
                  className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingInitialDraftWorkflow ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </>
    ) : (
      <div className="mt-3 grid gap-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Responsable: {initialDraftWorkflow.responsibleEmail || "-"}
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Fecha límite: {initialDraftWorkflow.dueDate || "-"}
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          <input
            type="checkbox"
            checked={!!initialDraftWorkflow.firstDraftCompletedAt}
            onChange={() => {
              if (!initialDraftWorkflow.firstDraftCompletedAt) {
                void markFirstDraftCompleted();
              }
            }}
            disabled={!canMarkFirstDraftCompleted || savingInitialDraftWorkflow}
            className="h-4 w-4"
          />
          <span>
            Primera redacción terminada
            {user?.uid === initialDraftWorkflow.responsibleUid ? "" : " (solo la marca el responsable)"}
          </span>
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          <input
            type="checkbox"
            checked={!!initialDraftWorkflow.reviewedAt}
            onChange={() => {
              if (!initialDraftWorkflow.reviewedAt) {
                void markDraftReviewed();
              }
            }}
            disabled={!canMarkDraftReviewed || savingInitialDraftWorkflow}
            className="h-4 w-4"
          />
          <span>
            Revisión realizada por otro abogado
            {user?.uid === initialDraftWorkflow.responsibleUid
              ? " (no la puede marcar quien redactó)"
              : ""}
          </span>
        </label>
      </div>
    )}
  </div>
) : null}

{currentManagementStatus === "a_alegar" ? (
  <div className="mt-4 rounded-2xl border border-violet-200 bg-white p-4 shadow-sm dark:border-violet-900 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-2">
      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
        Redacción de alegato
      </div>

      {alegatoWorkflow?.status === "drafting" ? (
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-black text-violet-800 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-200">
          EN REDACCIÓN
        </span>
      ) : null}
    </div>

    {!alegatoWorkflow?.status ? (
      <div className="mt-3 grid gap-3">
        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
          <input
            type="checkbox"
            checked={alegatoMarked}
            onChange={() => {
              if (!alegatoMarked) setAlegatoMarked(true);
            }}
            disabled={!canWrite || alegatoMarked}
            className="h-4 w-4"
          />
          <span>Pasar alegato a redacción</span>
        </label>

        {alegatoMarked ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Responsable de redacción
              </span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={alegatoResponsibleUid}
                onChange={(e) => setAlegatoResponsibleUid(e.target.value)}
                disabled={!canWrite}
              >
                <option value="">Seleccionar…</option>
                {participantLawyers.map((lawyer) => (
                  <option key={lawyer.uid} value={lawyer.uid}>
                    {lawyer.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Fecha límite
              </span>
              <input
                type="date"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={alegatoDueDate}
                onChange={(e) => setAlegatoDueDate(e.target.value)}
                disabled={!canWrite}
              />
            </label>

            <div className="flex flex-wrap gap-2 md:col-span-2">
              <button
                type="button"
                onClick={saveAlegatoWorkflow}
                disabled={!canWrite || savingAlegatoWorkflow}
                className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingAlegatoWorkflow ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    ) : (
      <div className="mt-3 grid gap-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Responsable: {alegatoWorkflow.responsibleEmail || "-"}
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Fecha límite: {alegatoWorkflow.dueDate || "-"}
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          <input
            type="checkbox"
            checked={!!alegatoWorkflow.firstDraftCompletedAt}
            onChange={() => {
              if (!alegatoWorkflow.firstDraftCompletedAt) {
                void markAlegatoFirstDraftCompleted();
              }
            }}
            disabled={!canMarkAlegatoFirstDraftCompleted || savingAlegatoWorkflow}
            className="h-4 w-4"
          />
          <span>Primera redacción del alegato terminada</span>
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          <input
            type="checkbox"
            checked={!!alegatoWorkflow.reviewedAt}
            onChange={() => {
              if (!alegatoWorkflow.reviewedAt) {
                void markAlegatoReviewed();
              }
            }}
            disabled={!canMarkAlegatoReviewed || savingAlegatoWorkflow}
            className="h-4 w-4"
          />
          <span>Revisión realizada por otro abogado</span>
        </label>
      </div>
    )}
  </div>
) : null}




            

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                     
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Nueva entrada de bitácora
            </div>



            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo</span>
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={logType}
                  onKeyDown={handleLogFormKeyDown}
                  onChange={(e) => {
                    const next = e.target.value as LogType;
                    setLogType(next);
                    setCalendarStart("");
                    setCalendarEnd("");
                    setCalendarEndManuallyEdited(false);
                    setCalendarLocation("");
                  }}
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
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  Título
                </span>
                <input
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={logTitle}
                  onKeyDown={handleLogFormKeyDown}
                  onChange={(e) => setLogTitle(e.target.value)}
                  disabled={!canWrite}
                  placeholder="Ej: Se contestó traslado / Vence plazo / Audiencia…"
                />
              </label>

              <label className="grid gap-1 md:col-span-2">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  Detalle
                </span>
                <textarea
                  className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={logBody}
                  onChange={(e) => setLogBody(e.target.value)}
                  disabled={!canWrite}
                  placeholder={logType === "recordatorio" ? "Opcional" : undefined}
                />
              </label>

{logType === "registro_interaccion" ? (
  <>
    <label className="grid gap-1">
      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
        Seleccionar con
      </span>
      <input
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        value={interactionContactQuery}
        onChange={(e) => setInteractionContactQuery(e.target.value)}
        disabled={!canWrite}
        placeholder="Buscar contacto"
      />
    </label>

    <label className="grid gap-1 md:col-span-2">
      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
        Informe de interacción
      </span>
      <textarea
        className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        value={interactionReport}
        onChange={(e) => setInteractionReport(e.target.value)}
        disabled={!canWrite}
      />
    </label>
  </>
) : null}

{logType === "despacho_importante" ? (
  <>
    <label className="grid gap-1 md:col-span-2">
      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
        Resumen (opcional)
      </span>
      <textarea
        className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        value={despachoResumen}
        onChange={(e) => setDespachoResumen(e.target.value)}
        disabled={!canWrite}
      />
    </label>

    <label className="grid gap-1 md:col-span-2">
      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
        Adjuntar PDF
      </span>
      <input
        type="file"
        accept="application/pdf"
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        onChange={(e) => setDespachoPdf(e.target.files?.[0] ?? null)}
        disabled={!canWrite}
      />
    </label>
  </>
) : null}

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
                      onKeyDown={handleLogFormKeyDown}
                      onChange={(e) => handleCalendarStartChange(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Fin (opcional)
                    </span>
                    <input
                      type="datetime-local"
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarEnd}
                      onKeyDown={handleLogFormKeyDown}
                      onChange={(e) => handleCalendarEndChange(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1 md:col-span-2">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Más datos
                    </span>
                    <input
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarLocation}
                      onKeyDown={handleLogFormKeyDown}
                      onChange={(e) => setCalendarLocation(e.target.value)}
                      disabled={!canWrite}
                      placeholder="Lugar, sala, juzgado, enlace o cualquier dato útil"
                    />
                  </label>
                </>
              ) : null}

              {logType === "recordatorio" ? (
                <>
                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Fecha y hora de recordatorio
                    </span>
                    <input
                      type="datetime-local"
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarStart}
                      onKeyDown={handleLogFormKeyDown}
                      onChange={(e) => setCalendarStart(e.target.value)}
                      disabled={!canWrite}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Más datos
                    </span>
                    <input
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={calendarLocation}
                      onKeyDown={handleLogFormKeyDown}
                      onChange={(e) => setCalendarLocation(e.target.value)}
                      disabled={!canWrite}
                      placeholder="Lugar, enlace o cualquier dato útil"
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
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;

                        if (!f) {
                          setSentPdf(null);
                          return;
                        }

                        if (f.type !== "application/pdf") {
                          alert("Solo se permite subir archivos PDF.");
                          e.currentTarget.value = "";
                          setSentPdf(null);
                          return;
                        }

                        if (f.size > 20 * 1024 * 1024) {
                          alert("El PDF no puede superar los 20 MB.");
                          e.currentTarget.value = "";
                          setSentPdf(null);
                          return;
                        }

                        setSentPdf(f);
                      }}
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
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                      Resultado
                    </span>
                    <select
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      value={sentResult}
                      onKeyDown={handleLogFormKeyDown}
                      onChange={(e) =>
                        setSentResult(e.target.value as "ganado" | "perdido" | "empatado")
                      }
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
              <div className="text-xs text-gray-600 dark:text-gray-300">
                {logs.length} entradas · página {logsPage} de {totalLogPages}
              </div>
            </div>

            <div className="mt-3">
              {logs.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Sin entradas.</div>
              ) : (
                paginatedLogs.map((l, idx) => {
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
                      className={`rounded-xl p-3 ${
                        idx % 2 === 0 ? "bg-gray-50 dark:bg-gray-800/40" : "bg-white dark:bg-gray-900"
                      }`}
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

                      {hasCal ? (
                        <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-100">
                          <div>
                            <span className="font-black">
                              {l.type === "recordatorio" ? "Recordatorio:" : "Inicio:"}
                            </span>{" "}
                            {formatDateTimeFromSeconds(l.calendar?.startAt?.seconds)}
                          </div>

                          {l.calendar?.endAt?.seconds ? (
                            <div className="mt-1">
                              <span className="font-black">Fin:</span>{" "}
                              {formatDateTimeFromSeconds(l.calendar?.endAt?.seconds)}
                            </div>
                          ) : null}

                          {String(l.calendar?.location ?? "").trim() ? (
                            <div className="mt-1">
                              <span className="font-black">Más datos:</span> {l.calendar?.location}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {l.body ? (
                        <div className="mt-2 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                          {l.body}
                        </div>
                      ) : null}


{l.type === "registro_interaccion" && (l as any).interaction ? (
  <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-100">
    <div>
      <span className="font-black">Con:</span>{" "}
      {valueOrDash((l as any).interaction?.contactName)}
    </div>
    <div className="mt-1 whitespace-pre-wrap">
      {(l as any).interaction?.report || "-"}
    </div>
  </div>
) : null}

{l.type === "despacho_importante" && (l as any).despachoImportante ? (
  <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-100">
    {(l as any).despachoImportante?.resumen ? (
      <div className="whitespace-pre-wrap">{(l as any).despachoImportante.resumen}</div>
    ) : null}
    {(l as any).despachoImportante?.pdfUrl ? (
      <div className="mt-2">
        <a
          className="font-extrabold underline"
          href={(l as any).despachoImportante.pdfUrl}
          target="_blank"
          rel="noreferrer"
        >
          Ver PDF ({(l as any).despachoImportante.pdfName || "archivo"})
        </a>
      </div>
    ) : null}
  </div>
) : null}

{l.type === "pase_vista" && (l as any).paseVista ? (
  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
    <div>
      <span className="font-black">Organismo:</span>{" "}
      {valueOrDash((l as any).paseVista?.organism)}
    </div>
    <div className="mt-1">
      <span className="font-black">Motivo:</span>{" "}
      {valueOrDash((l as any).paseVista?.reason)}
    </div>
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

            {logs.length > 0 ? (
              <div className="mt-4 flex items-center justify-center gap-2 border-t border-gray-200 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                  disabled={logsPage <= 1}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Anterior
                </button>

                <div className="px-3 text-sm font-black text-gray-700 dark:text-gray-200">
                  {logsPage} / {totalLogPages}
                </div>

                <button
                  type="button"
                  onClick={() => setLogsPage((p) => Math.min(totalLogPages, p + 1))}
                  disabled={logsPage >= totalLogPages}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Siguiente
                </button>
              </div>
            ) : null}

            <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
              {!archiveRequestDone ? (
                <>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => setArchiveRequestOpen((v) => !v)}
                      disabled={!canWrite}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      {archiveStatusText}
                    </button>
                  </div>

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

                      <div className="flex justify-center">
                        <button
                          type="button"
                          onClick={submitArchiveRequest}
                          disabled={!canWrite || archiveRequestSaving}
                          className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {archiveRequestSaving ? "Enviando..." : "Confirmar solicitud de archivo"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="flex justify-center">
                  <button
                    type="button"
                    disabled
                    className="rounded-xl border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-extrabold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    Solicitud de archivo realizada
                  </button>
                </div>
              )}
            </div>
          </div>
       
        </>
      )}
      <Modal
        open={metaModalOpen}
        title="Modificar información de la causa"
        onClose={() => setMetaModalOpen(false)}
      >
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Carátula
            </span>
            <input
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={String(metaDraft.caratulaTentativa ?? "")}
              onChange={(e) => setMetaDraft((m) => ({ ...m, caratulaTentativa: e.target.value }))}
            />
          </label>

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
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Nº expediente
              </span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.expedienteNumber ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, expedienteNumber: e.target.value }))}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Jurisdicción
              </span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as")}
                onChange={(e) => {
                  const next = e.target.value as any;
                  setMetaDraft((m) => ({
                    ...m,
                    jurisdiccion: next,
                    fuero: "",
                    court: "",
                    deptoJudicial: next === "provincia_bs_as" ? String(m.deptoJudicial ?? "") : "",
                  }));
                }}
              >
                <option value="nacional">Nacional</option>
                <option value="federal">Federal</option>
                <option value="caba">CABA</option>
                <option value="provincia_bs_as">Provincia Bs. As.</option>
                <option value="entre_rios">Entre Ríos</option>
<option value="etapa_administrativa">Etapa administrativa</option>
<option value="otra">Otra</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Fuero
              </span>

              {availableMetaFueroOptions.length > 0 ? (
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={String(metaDraft.fuero ?? "")}
                  onChange={(e) => {
                    const nextFuero = e.target.value;
                    const allowedCourts = getCourtOptions(
                      metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion ?? "provincia_bs_as",
                      nextFuero
                    );
                    setMetaDraft((m) => ({
                      ...m,
                      fuero: nextFuero,
                      court:
                        allowedCourts.length > 0 && !allowedCourts.includes(String(m.court ?? ""))
                          ? ""
                          : m.court,
                    }));
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {availableMetaFueroOptions.map((fuero) => (
                    <option key={fuero} value={fuero}>
                      {fuero}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={String(metaDraft.fuero ?? "")}
                  onChange={(e) => setMetaDraft((m) => ({ ...m, fuero: e.target.value }))}
                />
              )}
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Juzgado
              </span>

              {availableMetaCourtOptions.length > 0 ? (
                <select
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={String(metaDraft.court ?? "")}
                  onChange={(e) => setMetaDraft((m) => ({ ...m, court: e.target.value }))}
                >
                  <option value="">Seleccionar…</option>
                  {availableMetaCourtOptions.map((court) => (
                    <option key={court} value={court}>
                      {court}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={String(metaDraft.court ?? "")}
                  onChange={(e) => setMetaDraft((m) => ({ ...m, court: e.target.value }))}
                />
              )}
            </label>
          </div>

          {(metaDraft.jurisdiccion ?? caseDoc?.jurisdiccion) === "provincia_bs_as" ? (
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Departamento judicial
              </span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.deptoJudicial ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, deptoJudicial: e.target.value }))}
              >
                <option value="">Seleccionar…</option>
                {PROVINCIA_DEPTOS.map((depto) => (
                  <option key={depto} value={depto}>
                    {depto}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Tribunal de Alzada
              </span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.tribunalAlzada ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, tribunalAlzada: e.target.value }))}
              />
            </label>

<div className="grid gap-2">
  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
    Otros organismos intervinientes
  </span>

  {(metaDraft.otherOrganisms ?? [""]).map((org, idx) => (
    <div key={idx} className="flex gap-2">
      <input
        className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        value={String(org ?? "")}
        onChange={(e) =>
          setMetaDraft((m) => {
            const next = [...(m.otherOrganisms ?? [""])];
            next[idx] = e.target.value;
            return { ...m, otherOrganisms: next };
          })
        }
        placeholder="Otro organismo interviniente"
      />

      {(metaDraft.otherOrganisms ?? []).length > 1 ? (
        <button
          type="button"
          onClick={() =>
            setMetaDraft((m) => {
              const next = [...(m.otherOrganisms ?? [""])];
              next.splice(idx, 1);
              return {
                ...m,
                otherOrganisms: next.length > 0 ? next : [""],
              };
            })
          }
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
        >
          Quitar
        </button>
      ) : null}
    </div>
  ))}

  <div>
    <button
      type="button"
      onClick={() =>
        setMetaDraft((m) => ({
          ...m,
          otherOrganisms: [...(m.otherOrganisms ?? [""]), ""],
        }))
      }
      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
    >
      Agregar más organismos
    </button>
  </div>
</div>          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Monto del juicio
              </span>
              <input
                type="number"
                step="0.01"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={metaDraft.claimAmount ?? ""}
                onChange={(e) =>
                  setMetaDraft((m) => ({
                    ...m,
                    claimAmount: e.target.value === "" ? null : Number(e.target.value),
                  }))
                }
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Fecha de determinación del monto
              </span>
              <input
                type="date"
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={String(metaDraft.claimAmountDate ?? "")}
                onChange={(e) => setMetaDraft((m) => ({ ...m, claimAmountDate: e.target.value }))}
              />
            </label>
          </div>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Estado
            </span>
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
        open={lawyersModalOpen}
        title="Modificar abogados asignados"
        onClose={() => setLawyersModalOpen(false)}
      >
        {loadingLawyers ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            Cargando abogados...
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="text-sm text-gray-700 dark:text-gray-200">
              Tildá o destildá los abogados que intervienen en esta causa.
            </div>

            {allLawyers.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                No encontré abogados en la colección <b>users</b>.
              </div>
            ) : (
              <div className="grid gap-2">
                {allLawyers.map((lawyer) => {
                  const checked = selectedAssignedUids.includes(lawyer.uid);

                  return (
                    <label
                      key={lawyer.uid}
                      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignedLawyer(lawyer.uid)}
                        className="h-4 w-4"
                      />
                      <span>{lawyer.email}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={saveAssignedLawyers}
                disabled={savingLawyers}
                className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingLawyers ? "Guardando..." : "Guardar abogados asignados"}
              </button>

              <button
                type="button"
                onClick={() => setLawyersModalOpen(false)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
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

      <Modal
        open={caseChargesModalOpen}
        title={`Cobros realizados de la causa${
          caseDoc?.caratulaTentativa ? ` · ${caseDoc.caratulaTentativa}` : ""
        }`}
        onClose={() => setCaseChargesModalOpen(false)}
      >
        {caseChargesLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            Cargando cobros...
          </div>
        ) : sortedCaseCharges.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            No hay cobros registrados para esta causa.
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Cantidad de cobros
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {sortedCaseCharges.length}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Total bruto
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(caseChargesGrossTotal, sortedCaseCharges[0]?.currency)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Mi neto total
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(caseChargesMyNetTotal, sortedCaseCharges[0]?.currency)}
                </div>
              </div>
            </div>

            <div className="divide-y divide-gray-100 rounded-2xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {sortedCaseCharges.map((r) => {
                const myNet = getChargeUserNetAmount(r, user?.uid);
                const gross = Number(r.distribution?.grossAmount ?? r.totalAmount ?? 0);

                return (
                  <div key={r.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[220px] flex-1">
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                          {valueOrDash(r.payerRef?.displayName)}
                        </div>

                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          Fecha: {fmtDate(r.paidAt)}
                          {r.installments?.enabled && r.installments?.total
                            ? ` · Cuota ${Number(r.installments.current ?? 0)} de ${Number(
                                r.installments.total ?? 0
                              )}`
                            : ""}
                        </div>

                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                          {valueOrDash(r.payerRef?.email)}
                          {String(r.payerRef?.email ?? "").trim() &&
                          String(r.payerRef?.phone ?? "").trim()
                            ? " · "
                            : ""}
                          {String(r.payerRef?.phone ?? "").trim() ? r.payerRef?.phone : ""}
                          {String(r.payerRef?.cuit ?? "").trim()
                            ? `${
                                String(r.payerRef?.email ?? "").trim() ||
                                String(r.payerRef?.phone ?? "").trim()
                                  ? " · "
                                  : ""
                              }CUIT/CUIL: ${r.payerRef?.cuit}`
                            : ""}
                        </div>
                      </div>

                      <div className="min-w-[180px] text-right">
                        <div className="text-xs text-gray-500 dark:text-gray-400">Bruto</div>
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                          {fmtMoney(gross, r.currency)}
                        </div>

                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Mi neto</div>
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                          {fmtMoney(myNet, r.currency)}
                        </div>

                        <div className="mt-2 text-xs font-bold">
                          {r.transferTicket?.status === "done" ? (
                            <span className="text-green-700 dark:text-green-300">
                              Transferencias confirmadas
                            </span>
                          ) : r.transferTicket?.status === "pending" ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              Ticket pendiente
                            </span>
                          ) : (
                            <span className="text-gray-500 dark:text-gray-400">Sin ticket</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {(r.distribution?.participants ?? []).length > 0 ? (
                      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                        <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                          Participantes de la distribución
                        </div>

                        <div className="mt-2 grid gap-2">
                          {(r.distribution?.participants ?? []).map((p) => (
                            <div
                              key={p.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                            >
                              <div className="font-semibold text-gray-900 dark:text-gray-100">
                                {p.displayName}
                              </div>
                              <div className="font-black text-gray-900 dark:text-gray-100">
                                {p.percent}% · {fmtMoney(p.amount, r.currency)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
<Modal
  open={aiReportOpen}
  title="Informe generado con IA"
  onClose={() => setAiReportOpen(false)}
>
  <div className="grid gap-4">
    <div className="grid gap-3 md:grid-cols-2">
      <label className="grid gap-1">
        <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
          Tipo de informe
        </span>
        <select
          value={aiReportKind}
          onChange={(e) => setAiReportKind(e.target.value as "cliente" | "interno")}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="cliente">Para cliente</option>
          <option value="interno">Interno del estudio</option>
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
          Extensión
        </span>
        <select
          value={aiReportTone}
          onChange={(e) => setAiReportTone(e.target.value as "breve" | "detallado")}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="breve">Breve</option>
          <option value="detallado">Detallado</option>
        </select>
      </label>
    </div>

    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
      Borrador generado con asistencia de IA. Revisalo antes de entregarlo al cliente o usarlo internamente en el estudio.
    </div>

    <textarea
      value={aiReportText}
      onChange={(e) => setAiReportText(e.target.value)}
      className="min-h-[420px] w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
      placeholder="El informe generado aparecerá acá."
    />

    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(aiReportText);
            alert("Informe copiado al portapapeles.");
          } catch {
            alert("No se pudo copiar el informe.");
          }
        }}
        disabled={!aiReportText.trim()}
        className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
      >
        Copiar
      </button>

      <button
        type="button"
        onClick={handleGenerateAiReport}
        disabled={aiReportLoading}
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
      >
        {aiReportLoading ? "Regenerando..." : "Regenerar"}
      </button>

      <button
        type="button"
        onClick={async () => {
          if (!user) return;
          if (!aiReportText.trim()) return alert("No hay informe para guardar.");

          const title =
            aiReportKind === "cliente"
              ? "Informe para cliente generado con IA"
              : "Informe interno generado con IA";

          try {
            await addAutoLog({
              caseId,
              uid: user.uid,
              email: user.email ?? "",
              title,
              body: aiReportText,
              type: "informativa",
            });

            await updateDoc(managementMetaRef(caseId), {
              updatedAt: serverTimestamp(),
              lastLogAt: serverTimestamp(),
              lastLogByUid: user.uid,
              lastLogTitle: title,
            });

            await updateDoc(doc(db, "cases", caseId), {
              dashboardLastLogAt: serverTimestamp(),
              dashboardLastLogTitle: title,
              dashboardLastLogByEmail: user.email ?? "",
            });

            alert("Informe guardado en la bitácora.");
          } catch (e: any) {
            alert(e?.message ?? "No se pudo guardar el informe en la bitácora.");
          }
        }}
        disabled={!aiReportText.trim()}
        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
      >
        Guardar en bitácora
      </button>
    </div>
  </div>
</Modal>

      <ScrollToTopButton />
    </AppShell>
  );
}