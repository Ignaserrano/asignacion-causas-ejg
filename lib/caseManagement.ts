// lib/caseManagement.ts
import {
  doc,
  serverTimestamp,
  collection,
  addDoc,
  updateDoc,
  runTransaction,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type Jurisdiccion =
  | "nacional"
  | "federal"
  | "caba"
  | "provincia_bs_as"
  | "entre_rios"
  | "etapa_administrativa"
  | "otra";

export type CaseStatus =
  | "preliminar"
  | "iniciada"
  | "en_prueba"
  | "a_alegar"
  | "a_sentencia"
  | "con_sentencia_primera_instancia"
  | "con_sentencia_segunda_instancia"
  | "con_sentencia_ulterior_instancia"
  | "en_apelacion"
  | "recurso_extraordinario_local"
  | "ref"
  | "en_ejecucion";

export type LogType =
  | "informativa"
  | "vencimiento"
  | "audiencia"
  | "control_cobro"
  | "reunion_parte"
  | "sentencia"
  | "recordatorio"
  | "registro_interaccion"
  | "despacho_importante"
  | "pase_vista";

export type PartyRole =
  | "actor"
  | "demandado"
  | "citado_garantia"
  | "imputado"
  | "querellante"
  | "causante"
  | "fallido"
  | "otro";

export type WitnessCitationMode =
  | "presencial"
  | "virtual";

export type WitnessLawyerCitationMode =
  | "presencial"
  | "virtual";

export type WitnessNotificationMode =
  | "cedula_a_cargo_de_la_parte"
  | "mail_a_cargo_de_la_parte"
  | "mail_a_cargo_del_juzgado"
  | "nota_con_firma_personal"
  | "cedula_a_cargo_del_juzgado"
  | "otro";

export type ProofKind =
  | "informativa"
  | "testimonial"
  | "pericial_medica"
  | "pericial_caligrafica"
  | "pericial_contable"
  | "pericial_informatica"
  | "reconocimiento"
  | "confesional"
  | "instrumental_en_poder_de_la_contraria"
  | "otro";

export type InformativaProcessingMode =
  | "deox"
  | "sistema_externo"
  | "email"
  | "papel";

export type InformativaReiterationMode =
  | "automatica"
  | "requiere_solicitud";

export type WitnessEntry = {
  id: string;

  contactId?: string | null;
  displayName: string;

  offeredBySide?: "nosotros" | "contraria";
  offeredByPartyId?: string | null;
  offeredByPartyName?: string;

  citationDateTime?: string;
  witnessCitationMode?: WitnessCitationMode;
  lawyerCitationMode?: WitnessLawyerCitationMode;
  connectionLink?: string;

  notificationMode?: WitnessNotificationMode;
  notificationModeOther?: string;

  notified?: boolean;
  desisted?: boolean;
  declared?: boolean;
  impugned?: boolean;

  notes?: string;

  reCitationOfWitnessId?: string | null;
  reCitationOfWitnessName?: string;

  createdAt?: any;
  updatedAt?: any;
};

export type InformativaOfficeEntry = {
  id: string;
  name: string;
  address?: string;
  processingMode?: InformativaProcessingMode;
  dueDate?: string;
  reiterationMode?: InformativaReiterationMode;
  diligenciado?: boolean;
  acreditadoDiligenciamiento?: boolean;
  solicitadoReiteratorio?: boolean;
  diligenciadoReiteratorio?: boolean;
  reiteratorioDueDate?: string;
  contestado?: boolean;
  ampliatorioSolicitado?: boolean;
  ampliatorioContestado?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type ExpertEntry = {
  id: string;
  expertName?: string;
  priorExpertNames?: string[];
  pointsByParty?: Array<{
    partyId?: string | null;
    partyName?: string;
    points?: string;
  }>;
  peritoRemovido?: boolean;
  desistida?: boolean;
  noSeRealizoPorCulpaDePartyId?: string | null;
  noSeRealizoPorCulpaDePartyName?: string;
  presentaInforme?: boolean;
  impugnadoPorPartyIds?: string[];
  impugnadoPorPartyNames?: string[];
  peritoContestaImpugnacion?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type InstrumentalContrariaEntry = {
  id: string;
  instrumentalRequerida: string;
  dueDate?: string;
  cumplioIntimacion?: boolean;
  noCumplioIntimacion?: boolean;
  solicitoPresuncion?: boolean;
  juezAplicaPresuncion?: boolean;
  juezOtorgaPlazoMayor?: boolean;
  nuevoVencimiento?: string;
  createdAt?: any;
  updatedAt?: any;
};

export type ConfesionalEntry = {
  id: string;
  absolventeName: string;
  audienciaNotificada?: boolean;
  pliegoPosiciones?: string;
  desistida?: boolean;
  audienciaDateTime?: string;
  realizada?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type ReconocimientoEntry = {
  id: string;
  documentalAReconocer: string;
  personaCitadaAReconocer: string;
  depositadaEnJuzgado?: boolean;
  llevaAAudiencia?: boolean;
  audienciaDateTime?: string;
  desistida?: boolean;
  createdAt?: any;
  updatedAt?: any;
};

export type OtherProofEntry = {
  id: string;
  title: string;
  body?: string;
  createdAt?: any;
  updatedAt?: any;
};

export type ProofControlItem = {
  id: string;
  kind: ProofKind;
  title?: string;
  notes?: string;
  summary?: string;

  witnesses?: WitnessEntry[];
  informativaOffices?: InformativaOfficeEntry[];
  experts?: ExpertEntry[];
  instrumentalContrariaItems?: InstrumentalContrariaEntry[];
  confesionales?: ConfesionalEntry[];
  reconocimientos?: ReconocimientoEntry[];
  others?: OtherProofEntry[];

  createdAt?: any;
  updatedAt?: any;
};

export type PaseVistaEntry = {
  organism: string;
  reason?: string;
  createdAt?: any;
  createdByUid?: string;
  createdByEmail?: string;
};

export type RedactionWorkflow = {
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

export type ManagementMeta = {
  physicalFolder?: string;
  driveFolderUrl?: string;
  expedienteNumber?: string;
  court?: string;
  fuero?: string;
  jurisdiccion?: Jurisdiccion;
  deptoJudicial?: string;
  status?: CaseStatus;

  tribunalAlzada?: string;

  // Compatibilidad con el esquema viejo
  otherOrganism?: string;

  // Nuevo esquema
  otherOrganisms?: string[];

  claimAmount?: number | null;
  claimAmountDate?: string;

  sentenceFirm?: boolean;
  sentenceFirmMarkedAt?: any;
  sentenceFirmMarkedByUid?: string;
  sentenceFirmMarkedByEmail?: string;

  lastPaseVista?: PaseVistaEntry | null;
  pasesYVistas?: PaseVistaEntry[];

  proofControl?: ProofControlItem[];

  alegatoWorkflow?: RedactionWorkflow;

  archiveRequest?: {
    requestedAt?: any;
    requestedByUid?: string;
    requestedByEmail?: string;
    justification?: string;
  };

  lastLogAt?: any;
  lastLogByUid?: string;
  lastLogTitle?: string;
  createdAt?: any;
  updatedAt?: any;
  archivedAt?: any;
  archivedByUid?: string;
};

export type ContactCaseLink = {
  caseId: string;
  caratula: string;
  roles: PartyRole[];
  updatedAt?: any;
};

export function managementMetaRef(caseId: string) {
  return doc(db, "cases", caseId, "management", "meta");
}

export function logsColRef(caseId: string) {
  return collection(db, "cases", caseId, "logs");
}

export function partiesColRef(caseId: string) {
  return collection(db, "cases", caseId, "parties");
}

export function contactCaseLinksColRef(contactId: string) {
  return collection(db, "contacts", contactId, "caseLinks");
}

export function contactCaseLinkRef(contactId: string, caseId: string) {
  return doc(db, "contacts", contactId, "caseLinks", caseId);
}

export async function ensureManagementInitialized(params: {
  caseId: string;
  uid: string;
  email?: string;
}) {
  const { caseId, uid, email } = params;

  await runTransaction(db, async (tx) => {
    const metaR = managementMetaRef(caseId);
    const metaSnap = await tx.get(metaR);

    if (!metaSnap.exists()) {
      tx.set(metaR, {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "preliminar",
        otherOrganisms: [],
        pasesYVistas: [],
        proofControl: [],
        sentenceFirm: false,
        lastLogAt: serverTimestamp(),
        lastLogByUid: uid,
        lastLogTitle: "Inicio de bitácora",
      } satisfies ManagementMeta);

      const logR = doc(logsColRef(caseId));
      tx.set(logR, {
        type: "informativa",
        title: "Inicio de bitácora",
        body: "Se inicia la bitácora de la causa.",
        createdAt: serverTimestamp(),
        createdByUid: uid,
        createdByEmail: email ?? "",
        hasAttachments: false,
        attachments: [],
      });
    }
  });
}

export async function addAutoLog(params: {
  caseId: string;
  uid: string;
  email?: string;
  title: string;
  body?: string;
  type?: LogType;
  extra?: Record<string, any>;
}) {
  const { caseId, uid, email, title, body, type, extra } = params;

  const metaRef = managementMetaRef(caseId);
  const metaSnap = await getDoc(metaRef);

  if (!metaSnap.exists()) {
    await setDoc(
      metaRef,
      {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: "preliminar",
        otherOrganisms: [],
        pasesYVistas: [],
        proofControl: [],
        sentenceFirm: false,
        lastLogAt: serverTimestamp(),
        lastLogByUid: uid,
        lastLogTitle: title,
      } satisfies ManagementMeta,
      { merge: true }
    );
  }

  const logRef = await addDoc(logsColRef(caseId), {
    type: type ?? "informativa",
    title,
    body: body ?? "",
    createdAt: serverTimestamp(),
    createdByUid: uid,
    createdByEmail: email ?? "",
    hasAttachments: false,
    attachments: [],
    ...(extra ?? {}),
  });

  await setDoc(
    metaRef,
    {
      updatedAt: serverTimestamp(),
      lastLogAt: serverTimestamp(),
      lastLogByUid: uid,
      lastLogTitle: title,
    },
    { merge: true }
  );

  return logRef.id;
}

export async function syncContactCaseLink(params: {
  contactId: string;
  caseId: string;
  caratula: string;
  role: PartyRole;
}) {
  const { contactId, caseId, caratula, role } = params;
  const ref = contactCaseLinkRef(contactId, caseId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      caseId,
      caratula: String(caratula ?? "").trim(),
      roles: [role],
      updatedAt: serverTimestamp(),
    } satisfies ContactCaseLink);
    return;
  }

  const data = snap.data() as ContactCaseLink;
  const currentRoles = Array.isArray(data.roles) ? data.roles : [];
  const nextRoles = Array.from(new Set([...currentRoles, role])) as PartyRole[];

  await updateDoc(ref, {
    caratula: String(caratula ?? "").trim(),
    roles: nextRoles,
    updatedAt: serverTimestamp(),
  });
}

export async function removeRoleFromContactCaseLink(params: {
  contactId: string;
  caseId: string;
  role: PartyRole;
}) {
  const { contactId, caseId, role } = params;
  const ref = contactCaseLinkRef(contactId, caseId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const data = snap.data() as ContactCaseLink;
  const currentRoles = Array.isArray(data.roles) ? data.roles : [];
  const nextRoles = currentRoles.filter((r) => r !== role) as PartyRole[];

  if (nextRoles.length === 0) {
    await deleteDoc(ref);
    return;
  }

  await updateDoc(ref, {
    roles: nextRoles,
    updatedAt: serverTimestamp(),
  });
}

export async function syncCaseCaratulaToContactLinks(params: {
  caseId: string;
  caratula: string;
}) {
  const { caseId, caratula } = params;
  const partiesSnap = await getDocs(partiesColRef(caseId));

  const contactIds = Array.from(
    new Set(
      partiesSnap.docs
        .map((d) => {
          const data = d.data() as any;
          return String(data?.contactRef?.contactId ?? "").trim();
        })
        .filter(Boolean)
    )
  );

  await Promise.all(
    contactIds.map(async (contactId) => {
      const ref = contactCaseLinkRef(contactId, caseId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      await updateDoc(ref, {
        caratula: String(caratula ?? "").trim(),
        updatedAt: serverTimestamp(),
      });
    })
  );
}

export function logTypeColor(type: LogType) {
  switch (type) {
    case "informativa":
      return "bg-sky-100 text-sky-900 border-sky-200";
    case "vencimiento":
      return "bg-red-100 text-red-900 border-red-200";
    case "audiencia":
      return "bg-orange-100 text-orange-900 border-orange-200";
    case "control_cobro":
      return "bg-green-100 text-green-900 border-green-200";
    case "reunion_parte":
      return "bg-blue-100 text-blue-900 border-blue-200";
    case "sentencia":
      return "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-200";
    case "recordatorio":
      return "bg-teal-100 text-teal-900 border-teal-200";
    case "registro_interaccion":
      return "bg-indigo-100 text-indigo-900 border-indigo-200";
    case "despacho_importante":
      return "bg-violet-100 text-violet-900 border-violet-200";
    case "pase_vista":
      return "bg-amber-100 text-amber-900 border-amber-200";
    default:
      return "bg-gray-100 text-gray-900 border-gray-200";
  }
}

export function buildGoogleCalendarLink(args: {
  title: string;
  details?: string;
  location?: string;
  start: Date;
  end?: Date;
}) {
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const yyyy = d.getUTCFullYear();
    const mm = pad(d.getUTCMonth() + 1);
    const dd = pad(d.getUTCDate());
    const hh = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    const ss = pad(d.getUTCSeconds());
    return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
  };

  const startUtc = new Date(args.start.getTime());
  const endUtc = args.end
    ? new Date(args.end.getTime())
    : new Date(args.start.getTime() + 60 * 60 * 1000);

  const params = new URLSearchParams({
    text: args.title,
    details: args.details ?? "",
    location: args.location ?? "",
    dates: `${fmt(startUtc)}/${fmt(endUtc)}`,
  });

  return `https://calendar.google.com/calendar/u/0/r/eventedit?${params.toString()}`;
}