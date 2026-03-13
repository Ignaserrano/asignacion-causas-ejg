import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getChargeUserNetAmount, getScheduledRemainingAmount, isRealPaidCharge } from "@/lib/charges";

export type KpiSnapshotTotals = {
  activeCases: number;
  archivedCases: number;
  newCasesInMonth: number;
  chargesPaidCount: number;
  chargesPaidGross: number;
  chargesPaidNet: number;
  scheduledPendingCount: number;
  scheduledPendingAmount: number;
  overdueCount: number;
  overdueAmount: number;
  contactsCount: number;
  sentencesCount: number;
  wonSentences: number;
  lostSentences: number;
  tiedSentences: number;
  pendingInvitesCount: number;
};

export type KpiSnapshotBreakdowns = {
  byJurisdiction: Array<{ label: string; count: number }>;
  byCaseStatus: Array<{ label: string; count: number }>;
  byCurrency: Array<{ currency: string; gross: number; net: number }>;
  byLawyer: Array<{
    uid: string;
    email: string;
    paidGross: number;
    paidNet: number;
    casesCount: number;
  }>;
};

export type KpiSnapshotDoc = {
  periodKey: string;
  year: number;
  month: number;
  createdAt?: any;
  createdByUid?: string;
  createdByEmail?: string;
  locked?: boolean;
  notes?: string;
  totals: KpiSnapshotTotals;
  breakdowns: KpiSnapshotBreakdowns;
};

type CaseRow = {
  id: string;
  status?: "draft" | "assigned" | "archsolicited" | "archived";
  jurisdiccion?: string;
  confirmedAssigneesUids?: string[];
  createdAt?: any;
};

type ChargeRow = {
  id: string;
  status?: "scheduled" | "paid" | "completed" | "cancelled";
  currency?: "ARS" | "USD";
  totalAmount?: number;
  visibleToUids?: string[];
  paidAt?: any;
  scheduledDate?: any;
  distribution?: {
    grossAmount?: number;
  };
};

type UserRow = {
  id: string;
  email?: string;
};

type SentenceRow = {
  id: string;
  resultado?: "ganado" | "perdido" | "empatado";
  createdAt?: any;
};

function safeText(v: any) {
  return String(v ?? "").trim();
}

function toDate(value?: any) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function periodKeyFromDate(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

function isDateInsideMonth(value: any, year: number, month: number) {
  const d = toDate(value);
  if (!d) return false;
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

export function kpiSnapshotRef(periodKey: string) {
  return doc(db, "kpi_snapshots", periodKey);
}

export async function listKpiSnapshots(): Promise<KpiSnapshotDoc[]> {
  const snap = await getDocs(
    query(collection(db, "kpi_snapshots"), orderBy("year", "desc"), orderBy("month", "desc"), limit(120))
  );

  return snap.docs.map((d) => d.data() as KpiSnapshotDoc);
}

export async function getKpiSnapshot(periodKey: string): Promise<KpiSnapshotDoc | null> {
  const snap = await getDoc(kpiSnapshotRef(periodKey));
  if (!snap.exists()) return null;
  return snap.data() as KpiSnapshotDoc;
}

export async function buildKpiSnapshot(params: {
  year: number;
  month: number;
  createdByUid: string;
  createdByEmail?: string;
  notes?: string;
  locked?: boolean;
}): Promise<KpiSnapshotDoc> {
  const { year, month } = params;
  const periodKey = periodKeyFromDate(year, month);
  const { start, end } = monthRange(year, month);

  const [
    casesSnap,
    chargesSnap,
    contactsSnap,
    sentencesSnap,
    pendingInvitesSnap,
    usersSnap,
  ] = await Promise.all([
    getDocs(query(collection(db, "cases"), limit(5000))),
    getDocs(query(collection(db, "charges"), limit(5000))),
    getDocs(query(collection(db, "contacts"), limit(5000))),
    getDocs(query(collection(db, "sentences"), limit(5000))),
    getDocs(
      query(
        collectionGroup(db, "invites"),
        where("status", "==", "pending"),
        limit(5000)
      )
    ),
    getDocs(query(collection(db, "users"), limit(5000))),
  ]);

  const users = usersSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  })) as UserRow[];

  const userEmailByUid: Record<string, string> = {};
  users.forEach((u) => {
    userEmailByUid[u.id] = safeText(u.email) || u.id;
  });

  const cases = casesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  })) as CaseRow[];

  const charges = chargesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  })) as ChargeRow[];

  const sentences = sentencesSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as any),
  })) as SentenceRow[];

  const contactsCount = contactsSnap.size;
  const pendingInvitesCount = pendingInvitesSnap.size;

  const activeCases = cases.filter((c) => c.status !== "archived").length;
  const archivedCases = cases.filter((c) => c.status === "archived").length;
  const newCasesInMonth = cases.filter((c) => isDateInsideMonth(c.createdAt, year, month)).length;

  const paidCharges = charges.filter((c) => {
    if (c.status !== "paid") return false;
    return isDateInsideMonth(c.paidAt, year, month) && isRealPaidCharge(c);
  });

  const scheduledPending = charges.filter((c) => {
    return c.status === "scheduled";
  });

  const overdue = scheduledPending.filter((c) => {
    const d = toDate(c.scheduledDate);
    if (!d) return false;
    return d.getTime() < end.getTime() && Number(getScheduledRemainingAmount(c) || 0) > 0;
  });

  const chargesPaidGross = round2(
    paidCharges.reduce(
      (sum, c) => sum + Number(c.distribution?.grossAmount ?? c.totalAmount ?? 0),
      0
    )
  );

  const chargesPaidNet = round2(
    paidCharges.reduce((sum, c) => {
      const visibleTo = Array.isArray(c.visibleToUids) ? c.visibleToUids : [];
      const perChargeNet = visibleTo.reduce(
        (acc, uid) => acc + Number(getChargeUserNetAmount(c as any, uid) || 0),
        0
      );
      return sum + perChargeNet;
    }, 0)
  );

  const scheduledPendingAmount = round2(
    scheduledPending.reduce((sum, c) => sum + Number(getScheduledRemainingAmount(c) || 0), 0)
  );

  const overdueAmount = round2(
    overdue.reduce((sum, c) => sum + Number(getScheduledRemainingAmount(c) || 0), 0)
  );

  const sentencesInMonth = sentences.filter((s) => isDateInsideMonth(s.createdAt, year, month));
  const wonSentences = sentencesInMonth.filter((s) => s.resultado === "ganado").length;
  const lostSentences = sentencesInMonth.filter((s) => s.resultado === "perdido").length;
  const tiedSentences = sentencesInMonth.filter((s) => s.resultado === "empatado").length;

  const byJurisdictionMap = new Map<string, number>();
  cases.forEach((c) => {
    const key = safeText(c.jurisdiccion) || "(sin jurisdicción)";
    byJurisdictionMap.set(key, (byJurisdictionMap.get(key) ?? 0) + 1);
  });

  const byCaseStatusMap = new Map<string, number>();
  cases.forEach((c) => {
    const key = safeText(c.status) || "(sin estado)";
    byCaseStatusMap.set(key, (byCaseStatusMap.get(key) ?? 0) + 1);
  });

  const byCurrencyMap = new Map<string, { gross: number; net: number }>();
  paidCharges.forEach((c) => {
    const currency = safeText(c.currency) || "ARS";
    const prev = byCurrencyMap.get(currency) ?? { gross: 0, net: 0 };

    const visibleTo = Array.isArray(c.visibleToUids) ? c.visibleToUids : [];
    const perChargeNet = visibleTo.reduce(
      (acc, uid) => acc + Number(getChargeUserNetAmount(c as any, uid) || 0),
      0
    );

    prev.gross += Number(c.distribution?.grossAmount ?? c.totalAmount ?? 0);
    prev.net += perChargeNet;

    byCurrencyMap.set(currency, prev);
  });

  const byLawyerMap = new Map<
    string,
    { uid: string; email: string; paidGross: number; paidNet: number; casesCount: number }
  >();

  users.forEach((u) => {
    byLawyerMap.set(u.id, {
      uid: u.id,
      email: safeText(u.email) || u.id,
      paidGross: 0,
      paidNet: 0,
      casesCount: 0,
    });
  });

  cases.forEach((c) => {
    (c.confirmedAssigneesUids ?? []).forEach((uid) => {
      const found = byLawyerMap.get(uid);
      if (found) found.casesCount += 1;
    });
  });

  paidCharges.forEach((c) => {
    const visibleTo = Array.isArray(c.visibleToUids) ? c.visibleToUids : [];
    visibleTo.forEach((uid) => {
      const found = byLawyerMap.get(uid);
      if (!found) return;
      found.paidNet += Number(getChargeUserNetAmount(c as any, uid) || 0);
    });

    const ownerUid = safeText((c as any).ownerUid);
    if (ownerUid && byLawyerMap.has(ownerUid)) {
      byLawyerMap.get(ownerUid)!.paidGross += Number(
        c.distribution?.grossAmount ?? c.totalAmount ?? 0
      );
    }
  });

  const snapshot: KpiSnapshotDoc = {
    periodKey,
    year,
    month,
    createdByUid: params.createdByUid,
    createdByEmail: safeText(params.createdByEmail),
    locked: Boolean(params.locked),
    notes: safeText(params.notes),
    totals: {
      activeCases,
      archivedCases,
      newCasesInMonth,
      chargesPaidCount: paidCharges.length,
      chargesPaidGross: round2(chargesPaidGross),
      chargesPaidNet: round2(chargesPaidNet),
      scheduledPendingCount: scheduledPending.length,
      scheduledPendingAmount: round2(scheduledPendingAmount),
      overdueCount: overdue.length,
      overdueAmount: round2(overdueAmount),
      contactsCount,
      sentencesCount: sentencesInMonth.length,
      wonSentences,
      lostSentences,
      tiedSentences,
      pendingInvitesCount,
    },
    breakdowns: {
      byJurisdiction: Array.from(byJurisdictionMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      byCaseStatus: Array.from(byCaseStatusMap.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count),
      byCurrency: Array.from(byCurrencyMap.entries())
        .map(([currency, values]) => ({
          currency,
          gross: round2(values.gross),
          net: round2(values.net),
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency, "es")),
      byLawyer: Array.from(byLawyerMap.values())
        .map((x) => ({
          ...x,
          paidGross: round2(x.paidGross),
          paidNet: round2(x.paidNet),
        }))
        .sort((a, b) => b.paidNet - a.paidNet),
    },
  };

  return snapshot;
}

export async function saveKpiSnapshot(params: {
  year: number;
  month: number;
  createdByUid: string;
  createdByEmail?: string;
  notes?: string;
  locked?: boolean;
}) {
  const snapshot = await buildKpiSnapshot(params);

  await setDoc(kpiSnapshotRef(snapshot.periodKey), {
    ...snapshot,
    createdAt: serverTimestamp(),
  });

  return snapshot;
}