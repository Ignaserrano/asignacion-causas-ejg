// lib/caseManagement.ts
import {
  Timestamp,
  doc,
  serverTimestamp,
  setDoc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  runTransaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CaseStatus =
  | "preliminar"
  | "iniciada"
  | "en_prueba"
  | "a_sentencia"
  | "en_apelacion"
  | "en_ejecucion";

export type LogType =
  | "informativa"
  | "vencimiento"
  | "audiencia"
  | "control_cobro"
  | "reunion_parte"
  | "sentencia";

export type PartyRole =
  | "actor"
  | "demandado"
  | "citado_garantia"
  | "imputado"
  | "querellante"
  | "causante"
  | "fallido"
  | "otro";

export type ManagementMeta = {
  physicalFolder?: string;
  driveFolderUrl?: string;
  expedienteNumber?: string;
  court?: string;
  fuero?: string;
  jurisdiccion?: "nacional" | "federal" | "caba" | "provincia_bs_as";
  deptoJudicial?: string;
  status?: CaseStatus;

  lastLogAt?: any;
  lastLogByUid?: string;
  lastLogTitle?: string;
  createdAt?: any;
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
        lastLogAt: serverTimestamp(),
        lastLogByUid: uid,
        lastLogTitle: "Inicio de bitácora",
      } satisfies ManagementMeta);

      // log inicial
      const logR = doc(logsColRef(caseId)); // genera id
      tx.set(logR, {
        type: "informativa",
        title: "Inicio de bitácora",
        body: "Se inicia la bitácora de la causa.",
        createdAt: serverTimestamp(),
        createdByUid: uid,
        createdByEmail: email ?? "",
        hasAttachments: false,
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
}) {
  const { caseId, uid, email, title, body, type } = params;

  const logRef = await addDoc(logsColRef(caseId), {
    type: type ?? "informativa",
    title,
    body: body ?? "",
    createdAt: serverTimestamp(),
    createdByUid: uid,
    createdByEmail: email ?? "",
    hasAttachments: false,
  });

  await updateDoc(managementMetaRef(caseId), {
    updatedAt: serverTimestamp(),
    lastLogAt: serverTimestamp(),
    lastLogByUid: uid,
    lastLogTitle: title,
  });

  return logRef.id;
}

export function logTypeColor(type: LogType) {
  // Tailwind classes
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
    default:
      return "bg-gray-100 text-gray-900 border-gray-200";
  }
}

// Link simple para “Agregar a Google Calendar”
export function buildGoogleCalendarLink(args: {
  title: string;
  details?: string;
  location?: string;
  start: Date;
  end?: Date;
}) {
  const fmt = (d: Date) => {
    // YYYYMMDDTHHMMSSZ
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
  const endUtc = args.end ? new Date(args.end.getTime()) : new Date(args.start.getTime() + 60 * 60 * 1000);

  const params = new URLSearchParams({
    text: args.title,
    details: args.details ?? "",
    location: args.location ?? "",
    dates: `${fmt(startUtc)}/${fmt(endUtc)}`,
  });

  return `https://calendar.google.com/calendar/u/0/r/eventedit?${params.toString()}`;
}