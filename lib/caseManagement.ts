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
        lastLogAt: serverTimestamp(),
        lastLogByUid: uid,
        lastLogTitle: "Inicio de bitácora",
      } satisfies ManagementMeta);

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
    attachments: [],
  });

  await updateDoc(managementMetaRef(caseId), {
  updatedAt: serverTimestamp(),
  lastLogAt: serverTimestamp(),
  lastLogByUid: uid,
  lastLogTitle: title,
});

await updateDoc(doc(db, "cases", caseId), {
  dashboardLastLogAt: serverTimestamp(),
  dashboardLastLogTitle: title,
  dashboardLastLogByEmail: email ?? "",
});

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