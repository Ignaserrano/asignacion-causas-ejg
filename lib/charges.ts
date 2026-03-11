// lib/charges.ts

import {
  collection,
  doc,
  serverTimestamp,
  addDoc,
  updateDoc,
  getDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import { buildGoogleCalendarLink, addAutoLog } from "@/lib/caseManagement";

export type ChargeStatus = "scheduled" | "paid" | "completed" | "cancelled";

export type ChargeCurrency = "ARS" | "USD";

export type ChargeConcept =
  | "honorarios"
  | "devolucion_gastos"
  | "aportes_previsionales"
  | "iva"
  | "otro";

export type ChargeDeductionType =
  | "aporte_previsional"
  | "iibb"
  | "reintegro_gastos"
  | "otro";

export type ChargeItem = {
  id: string;
  concept: ChargeConcept;
  label?: string;
  amount: number;
  currency: ChargeCurrency;
};

export type ChargeDeduction = {
  id: string;
  type: ChargeDeductionType;
  label?: string;
  amount: number;
};

export type ChargeParticipant = {
  id: string;
  uid?: string;
  displayName: string;
  percent: number;
  amount: number;
  kind: "lawyer" | "external";
};

export type ChargeDistribution = {
  grossAmount: number;
  deductionsTotal: number;
  baseNetAmount: number;
  studioFundPercent: number;
  studioFundAmount: number;
  distributableAmount: number;
  participants: ChargeParticipant[];
};

export type ChargeDoc = {
  status: ChargeStatus;

  ownerUid: string;

  visibleToUids: string[];

  caseRef: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase: boolean;
    extraCaseReason?: string;
  };

  payerRef: {
    contactId?: string | null;
    displayName: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };

  scheduledDate?: any;
  paidAt?: any;

  currency: ChargeCurrency;

  items: ChargeItem[];

  totalAmount: number;

  // SOLO para cobros agendados
  collectedAmount?: number;
  remainingAmount?: number;
  partialPaymentsCount?: number;

  installments?: {
    enabled: boolean;
    total?: number;
    current?: number;
  };

  deductions?: ChargeDeduction[];

  distribution?: ChargeDistribution;

  transferTicket?: {
    status: "pending" | "done";
    createdAt?: any;
    confirmedAt?: any;
    confirmedByUid?: string;
  };

  pendingTransferReceiverUids?: string[];

  sourceScheduledChargeId?: string | null;

  notes?: string;

  createdAt?: any;
  createdByUid?: string;
  createdByEmail?: string;

  updatedAt?: any;
};

function round2(n: number) {
  return Number((n || 0).toFixed(2));
}

export function chargesColRef() {
  return collection(db, "charges");
}

export function chargeDocRef(chargeId: string) {
  return doc(db, "charges", chargeId);
}

export function calcChargeTotal(items: ChargeItem[]) {
  return round2(items.reduce((sum, i) => sum + Number(i.amount || 0), 0));
}

export function calcDeductionsTotal(deductions: ChargeDeduction[]) {
  return round2(deductions.reduce((sum, d) => sum + Number(d.amount || 0), 0));
}

export function validateDistributionPercent(
  participants: Array<{ percent: number }>
) {
  const total = round2(
    participants.reduce((sum, p) => sum + Number(p.percent || 0), 0)
  );
  return total === 100;
}

export function calculateDistribution(params: {
  gross: number;
  deductions: ChargeDeduction[];
  participants: {
    uid?: string;
    displayName: string;
    percent: number;
    kind: "lawyer" | "external";
  }[];
}): ChargeDistribution {
  const grossAmount = round2(params.gross);
  const deductionsTotal = calcDeductionsTotal(params.deductions);
  const baseNetAmount = round2(grossAmount - deductionsTotal);

  const studioFundPercent = 15;
  const studioFundAmount = round2(baseNetAmount * 0.15);
  const distributableAmount = round2(Math.max(0, baseNetAmount - studioFundAmount));

  const participants: ChargeParticipant[] = params.participants.map((p) => ({
    id: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    uid: p.uid,
    displayName: p.displayName,
    percent: Number(p.percent || 0),
    kind: p.kind,
    amount: round2(distributableAmount * (Number(p.percent || 0) / 100)),
  }));

  return {
    grossAmount,
    deductionsTotal,
    baseNetAmount,
    studioFundPercent,
    studioFundAmount,
    distributableAmount,
    participants,
  };
}

export function getScheduledCollectedAmount(charge: Partial<ChargeDoc> | any) {
  return round2(Number(charge?.collectedAmount ?? 0));
}

export function getScheduledRemainingAmount(charge: Partial<ChargeDoc> | any) {
  const total = round2(Number(charge?.totalAmount ?? 0));
  const explicitRemaining = charge?.remainingAmount;
  if (explicitRemaining !== undefined && explicitRemaining !== null) {
    return round2(Number(explicitRemaining));
  }
  const collected = getScheduledCollectedAmount(charge);
  return round2(Math.max(0, total - collected));
}

export function isScheduledChargeCompleted(charge: Partial<ChargeDoc> | any) {
  return getScheduledRemainingAmount(charge) <= 0;
}

export function isRealPaidCharge(charge: Partial<ChargeDoc> | any) {
  return (
    String(charge?.status ?? "") === "paid" &&
    !!charge?.distribution &&
    !!charge?.transferTicket
  );
}

export function getChargeUserNetAmount(
  charge: Partial<ChargeDoc> | any,
  userUid?: string | null
) {
  if (!userUid) return 0;

  const participants = Array.isArray(charge?.distribution?.participants)
    ? charge.distribution.participants
    : [];

  const found = participants.find((p: any) => String(p?.uid ?? "") === String(userUid));
  if (found) return round2(Number(found.amount ?? 0));

  if (participants.length === 0 && String(charge?.ownerUid ?? "") === String(userUid)) {
    return round2(Number(charge?.totalAmount ?? 0));
  }

  return 0;
}

export async function createScheduledCharge(params: {
  ownerUid: string;
  ownerEmail?: string;
  visibleToUids: string[];

  caseId?: string;
  caratula?: string;

  extraCaseReason?: string;

  payer: {
    contactId?: string;
    displayName: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };

  items: ChargeItem[];

  scheduledDate: Date;

  currency: ChargeCurrency;

  installments?: {
    enabled: boolean;
    total?: number;
    current?: number;
  };

  notes?: string;
}) {
  const totalAmount = calcChargeTotal(params.items);

  const ref = await addDoc(chargesColRef(), {
    status: "scheduled",

    ownerUid: params.ownerUid,

    visibleToUids: params.visibleToUids,

    caseRef: {
      caseId: params.caseId ?? null,
      caratula: params.caratula ?? "",
      isExtraCase: !params.caseId,
      extraCaseReason: params.extraCaseReason ?? "",
    },

    payerRef: {
      contactId: params.payer.contactId ?? null,
      displayName: params.payer.displayName,
      email: params.payer.email ?? "",
      phone: params.payer.phone ?? "",
      cuit: params.payer.cuit ?? "",
    },

    scheduledDate: params.scheduledDate,

    currency: params.currency,

    items: params.items,

    totalAmount,
    collectedAmount: 0,
    remainingAmount: totalAmount,
    partialPaymentsCount: 0,

    installments: params.installments ?? { enabled: false },

    notes: params.notes ?? "",

    createdAt: serverTimestamp(),
    createdByUid: params.ownerUid,
    createdByEmail: params.ownerEmail ?? "",

    updatedAt: serverTimestamp(),
  } satisfies Partial<ChargeDoc>);

  if (params.caseId) {
    await addAutoLog({
      caseId: params.caseId,
      uid: params.ownerUid,
      email: params.ownerEmail,
      title: "Cobro previsto",
      body: `Se agendó cobro previsto por ${totalAmount} ${params.currency}`,
      type: "control_cobro",
    });
  }

  return ref.id;
}

export async function registerPaidCharge(params: {
  scheduledChargeId?: string | null;

  ownerUid: string;
  ownerEmail?: string;
  visibleToUids: string[];

  caseRef: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase: boolean;
    extraCaseReason?: string;
  };

  payerRef: {
    contactId?: string | null;
    displayName: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };

  paidAt: Date;
  currency: ChargeCurrency;
  items: ChargeItem[];

  installments?: {
    enabled: boolean;
    total?: number;
    current?: number;
  };

  deductions: ChargeDeduction[];
  distribution: ChargeDistribution;
  pendingTransferReceiverUids: string[];
  notes?: string;
}) {
  const totalAmount = calcChargeTotal(params.items);

  const paidRef = await addDoc(chargesColRef(), {
    status: "paid",
    ownerUid: params.ownerUid,
    visibleToUids: params.visibleToUids,
    caseRef: params.caseRef,
    payerRef: params.payerRef,
    paidAt: params.paidAt,
    currency: params.currency,
    items: params.items,
    totalAmount,
    installments: params.installments ?? { enabled: false },
    deductions: params.deductions,
    distribution: params.distribution,
    pendingTransferReceiverUids: params.pendingTransferReceiverUids,
    transferTicket: {
      status: "pending",
      createdAt: serverTimestamp(),
    },
    sourceScheduledChargeId: params.scheduledChargeId ?? null,
    notes: params.notes ?? "",
    createdAt: serverTimestamp(),
    createdByUid: params.ownerUid,
    createdByEmail: params.ownerEmail ?? "",
    updatedAt: serverTimestamp(),
  } satisfies Partial<ChargeDoc>);

  let remainingAmount = 0;
  let scheduledCompleted = false;

  if (params.scheduledChargeId) {
    const scheduledRef = chargeDocRef(params.scheduledChargeId);
    const scheduledSnap = await getDoc(scheduledRef);

    if (scheduledSnap.exists()) {
      const data = scheduledSnap.data() as ChargeDoc;

      const prevCollected = round2(Number(data.collectedAmount ?? 0));
      const scheduledTotal = round2(Number(data.totalAmount ?? 0));

      const newCollected = round2(prevCollected + totalAmount);
      remainingAmount = round2(Math.max(0, scheduledTotal - newCollected));
      scheduledCompleted = remainingAmount === 0;

      await updateDoc(scheduledRef, {
        collectedAmount: newCollected,
        remainingAmount,
        partialPaymentsCount: Number(data.partialPaymentsCount ?? 0) + 1,
        status: scheduledCompleted ? "completed" : "scheduled",
        ...(scheduledCompleted ? { paidAt: params.paidAt } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  }

  return {
    paidChargeId: paidRef.id,
    remainingAmount,
    scheduledCompleted,
  };
}

export async function markChargeAsPaid(params: {
  chargeId: string;
  paidAt: Date;
  deductions: ChargeDeduction[];
  distribution: ChargeDistribution;
  pendingReceiverUids: string[];
}) {
  await updateDoc(chargeDocRef(params.chargeId), {
    status: "paid",
    paidAt: params.paidAt,
    deductions: params.deductions,
    distribution: params.distribution,
    pendingTransferReceiverUids: params.pendingReceiverUids,
    transferTicket: {
      status: "pending",
      createdAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  });
}

export async function confirmChargeTransfers(params: {
  chargeId: string;
  confirmedByUid: string;
}) {
  await updateDoc(chargeDocRef(params.chargeId), {
    transferTicket: {
      status: "done",
      confirmedAt: serverTimestamp(),
      confirmedByUid: params.confirmedByUid,
    },
    updatedAt: serverTimestamp(),
  });
}

export function buildChargeCalendarLink(args: {
  title: string;
  details?: string;
  date: Date;
}) {
  return buildGoogleCalendarLink({
    title: args.title,
    details: args.details,
    start: args.date,
  });
}