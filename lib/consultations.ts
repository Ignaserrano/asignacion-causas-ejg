import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ConsultationStatus = "open" | "closed";
export type ConsultationDerivationStatus = "pending" | "accepted" | "rejected";

export type ConsultationInteractionType =
  | "consulta_inicial"
  | "seguimiento"
  | "nota_interna"
  | "derivacion"
  | "cierre";

export type ConsultationDoc = {
  contactRef?: {
    contactId?: string | null;
    displayName?: string;
    email?: string;
    phone?: string;
  };

  subject: string;
  summary?: string;

  openedAt: any;
  openedByUid: string;
  openedByEmail?: string;

  ownerUid: string;
  ownerEmail?: string;

  visibleToUids: string[];

  status: ConsultationStatus;
  result?: string;

  followUp?: {
    scheduled: boolean;
    eventId?: string | null;
    at?: any;
    createdByUid?: string;
    createdByEmail?: string;
  };

  derivation?: {
    status?: ConsultationDerivationStatus;
    fromUid?: string;
    fromEmail?: string;
    toUid?: string;
    toEmail?: string;
    requestedAt?: any;
    respondedAt?: any;
    rejectionReason?: string;
    acceptedVisibleUntil?: any;
  };

  createdAt?: any;
  createdByUid?: string;
  createdByEmail?: string;
  updatedAt?: any;

  closedAt?: any;
  closedByUid?: string;
  closedByEmail?: string;

  sourceCaseId?: string | null;
};

export type ConsultationRow = ConsultationDoc & {
  id: string;
};

export type ConsultationInteractionDoc = {
  type: ConsultationInteractionType;
  title: string;
  body?: string;
  createdAt: any;
  createdByUid: string;
  createdByEmail?: string;
};

export type ConsultationInteractionRow = ConsultationInteractionDoc & {
  id: string;
};

export function consultationsColRef() {
  return collection(db, "consultations");
}

export function consultationDocRef(consultationId: string) {
  return doc(db, "consultations", consultationId);
}

export function consultationInteractionsColRef(consultationId: string) {
  return collection(db, "consultations", consultationId, "interactions");
}

function cleanObject<T extends Record<string, any>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

export async function createConsultation(params: {
  contactRef?: {
    contactId?: string | null;
    displayName?: string;
    email?: string;
    phone?: string;
  };
  subject: string;
  summary?: string;
  openedByUid: string;
  openedByEmail?: string;
  ownerUid?: string;
  ownerEmail?: string;
  visibleToUids?: string[];
  followUp?: {
    scheduled: boolean;
    eventId?: string | null;
    at?: any;
    createdByUid?: string;
    createdByEmail?: string;
  };
}) {
  const ownerUid = String(params.ownerUid ?? params.openedByUid ?? "").trim();
  const ownerEmail = String(params.ownerEmail ?? params.openedByEmail ?? "").trim();
  const visibleToUids = Array.from(
    new Set([ownerUid, ...(params.visibleToUids ?? [])].filter(Boolean))
  );

  const docData: ConsultationDoc = cleanObject({
    contactRef: params.contactRef
      ? cleanObject({
          contactId: params.contactRef.contactId ?? null,
          displayName: params.contactRef.displayName ?? "",
          email: params.contactRef.email ?? "",
          phone: params.contactRef.phone ?? "",
        })
      : undefined,
    subject: String(params.subject ?? "").trim(),
    summary: String(params.summary ?? "").trim(),
    openedAt: serverTimestamp(),
    openedByUid: params.openedByUid,
    openedByEmail: params.openedByEmail ?? "",
    ownerUid,
    ownerEmail,
    visibleToUids,
    status: "open",
    followUp: params.followUp
      ? cleanObject({
          scheduled: Boolean(params.followUp.scheduled),
          eventId: params.followUp.eventId ?? null,
          at: params.followUp.at ?? null,
          createdByUid: params.followUp.createdByUid ?? "",
          createdByEmail: params.followUp.createdByEmail ?? "",
        })
      : {
          scheduled: false,
          eventId: null,
          at: null,
          createdByUid: "",
          createdByEmail: "",
        },
    createdAt: serverTimestamp(),
    createdByUid: params.openedByUid,
    createdByEmail: params.openedByEmail ?? "",
    updatedAt: serverTimestamp(),
  }) as ConsultationDoc;

  const ref = await addDoc(consultationsColRef(), docData);

  await addConsultationInteraction({
    consultationId: ref.id,
    type: "consulta_inicial",
    title: "Consulta inicial",
    body: String(params.summary ?? "").trim(),
    createdByUid: params.openedByUid,
    createdByEmail: params.openedByEmail ?? "",
  });

  return ref.id;
}

export async function addConsultationInteraction(params: {
  consultationId: string;
  type: ConsultationInteractionType;
  title: string;
  body?: string;
  createdByUid: string;
  createdByEmail?: string;
}) {
  const ref = await addDoc(consultationInteractionsColRef(params.consultationId), {
    type: params.type,
    title: String(params.title ?? "").trim(),
    body: String(params.body ?? "").trim(),
    createdAt: serverTimestamp(),
    createdByUid: params.createdByUid,
    createdByEmail: params.createdByEmail ?? "",
  });

  await updateDoc(consultationDocRef(params.consultationId), {
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

export async function closeConsultation(params: {
  consultationId: string;
  result: string;
  uid: string;
  email?: string;
}) {
  await updateDoc(consultationDocRef(params.consultationId), {
    status: "closed",
    result: String(params.result ?? "").trim(),
    closedAt: serverTimestamp(),
    closedByUid: params.uid,
    closedByEmail: params.email ?? "",
    updatedAt: serverTimestamp(),
  });

  await addConsultationInteraction({
    consultationId: params.consultationId,
    type: "cierre",
    title: "Consulta cerrada",
    body: String(params.result ?? "").trim(),
    createdByUid: params.uid,
    createdByEmail: params.email ?? "",
  });
}

export async function requestConsultationDerivation(params: {
  consultationId: string;
  fromUid: string;
  fromEmail?: string;
  toUid: string;
  toEmail?: string;
}) {
  const snap = await getDoc(consultationDocRef(params.consultationId));
  if (!snap.exists()) throw new Error("La consulta no existe.");

  const data = snap.data() as ConsultationDoc;
  const visibleToUids = Array.from(
    new Set([...(data.visibleToUids ?? []), params.fromUid, params.toUid].filter(Boolean))
  );

  await updateDoc(consultationDocRef(params.consultationId), {
    visibleToUids,
    derivation: {
      status: "pending",
      fromUid: params.fromUid,
      fromEmail: params.fromEmail ?? "",
      toUid: params.toUid,
      toEmail: params.toEmail ?? "",
      requestedAt: serverTimestamp(),
      respondedAt: null,
      rejectionReason: "",
      acceptedVisibleUntil: null,
    },
    updatedAt: serverTimestamp(),
  });

  await addConsultationInteraction({
    consultationId: params.consultationId,
    type: "derivacion",
    title: "Consulta derivada",
    body: `Se derivó la consulta a ${params.toEmail ?? params.toUid}.`,
    createdByUid: params.fromUid,
    createdByEmail: params.fromEmail ?? "",
  });
}

export async function respondConsultationDerivation(params: {
  consultationId: string;
  decision: "accepted" | "rejected";
  uid: string;
  email?: string;
  rejectionReason?: string;
}) {
  const snap = await getDoc(consultationDocRef(params.consultationId));
  if (!snap.exists()) throw new Error("La consulta no existe.");

  const data = snap.data() as ConsultationDoc;
  const derivation = data.derivation ?? {};

  if (!derivation.toUid) {
    throw new Error("La consulta no tiene una derivación pendiente.");
  }

  const acceptedVisibleUntil = new Date();
  acceptedVisibleUntil.setDate(acceptedVisibleUntil.getDate() + 1);

  if (params.decision === "accepted") {
    await updateDoc(consultationDocRef(params.consultationId), {
      ownerUid: params.uid,
      ownerEmail: params.email ?? "",
      derivation: {
        ...derivation,
        status: "accepted",
        respondedAt: serverTimestamp(),
        rejectionReason: "",
        acceptedVisibleUntil,
      },
      updatedAt: serverTimestamp(),
    });

    await addConsultationInteraction({
      consultationId: params.consultationId,
      type: "derivacion",
      title: "Derivación aceptada",
      body: `La derivación fue aceptada por ${params.email ?? params.uid}.`,
      createdByUid: params.uid,
      createdByEmail: params.email ?? "",
    });

    return;
  }

  await updateDoc(consultationDocRef(params.consultationId), {
    derivation: {
      ...derivation,
      status: "rejected",
      respondedAt: serverTimestamp(),
      rejectionReason: String(params.rejectionReason ?? "").trim(),
      acceptedVisibleUntil: null,
    },
    updatedAt: serverTimestamp(),
  });

  await addConsultationInteraction({
    consultationId: params.consultationId,
    type: "derivacion",
    title: "Derivación rechazada",
    body:
      `La derivación fue rechazada por ${params.email ?? params.uid}.` +
      (String(params.rejectionReason ?? "").trim()
        ? `\n\nMotivo: ${String(params.rejectionReason ?? "").trim()}`
        : ""),
    createdByUid: params.uid,
    createdByEmail: params.email ?? "",
  });
}

export async function rederiveConsultation(params: {
  consultationId: string;
  fromUid: string;
  fromEmail?: string;
  toUid: string;
  toEmail?: string;
}) {
  await requestConsultationDerivation(params);
}