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
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import { getKpiTarget, saveKpiTarget, type KpiTarget } from "@/lib/kpiTarget";

type MainCaseStatus = "draft" | "assigned" | "archsolicited" | "archived";

type CaseRow = {
  id: string;
  caratulaTentativa?: string;
  status?: MainCaseStatus;
  confirmedAssigneesUids?: string[];
  broughtByUid?: string;
  dashboardLastLogAt?: any;
  dashboardLastLogTitle?: string;
  createdAt?: any;
};

type ChargeParticipant = {
  id: string;
  uid?: string;
  displayName?: string;
  percent?: number;
  amount?: number;
  kind?: "lawyer" | "external";
};

type ChargeRow = {
  id: string;
  status?: "scheduled" | "paid" | "completed" | "cancelled";
  visibleToUids?: string[];
  ownerUid?: string;
  currency?: "ARS" | "USD" | string;
  totalAmount?: number;
  collectedAmount?: number;
  remainingAmount?: number;
  paidAt?: any;
  scheduledDate?: any;
  payerRef?: {
    displayName?: string;
  };
  caseRef?: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase?: boolean;
    extraCaseReason?: string;
  };
  distribution?: {
    grossAmount?: number;
    deductionsTotal?: number;
    baseNetAmount?: number;
    studioFundAmount?: number;
    distributableAmount?: number;
    participants?: ChargeParticipant[];
  };
  transferTicket?: {
    status?: "pending" | "done";
  };
};

type SentenceRow = {
  id: string;
  resultado?: "ganado" | "perdido" | "empatado";
  createdAt?: any;
  jurisdiccion?: string;
  fuero?: string;
};

type ContactRow = {
  id: string;
  type?: string;
  personType?: string;
};

type UserDoc = {
  email?: string;
  role?: string;
};

type LawyerKpiRow = {
  uid: string;
  email: string;
  casesCount: number;
  netPaidMonth: number;
  pendingToReceive: number;
};

type SnapshotTotals = {
  activeCases?: number;
  archivedCases?: number;
  archiveRequestedCases?: number;
  inactiveCases60?: number;
  chargesPaidGross?: number;
  chargesPaidDistributable?: number;
  chargesPaidStudioFund?: number;
  pendingScheduledAmount?: number;
  overdueAmount?: number;
  next30DaysAmount?: number;
  transferPendingCount?: number;
  contactsCount?: number;
  sentencesCount?: number;
  wonSentences?: number;
  lostSentences?: number;
  drawSentences?: number;
  winRate?: number;
  newCasesMonth?: number;
};

type SnapshotLawyerKpi = {
  uid: string;
  email?: string;
  casesCount?: number;
  netPaidMonth?: number;
  pendingToReceive?: number;
};

type KpiSnapshotRow = {
  id: string;
  periodKey?: string;
  createdAt?: any;
  totals?: SnapshotTotals;
  lawyerKpis?: SnapshotLawyerKpi[];
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

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString("es-AR")} ${currency ?? ""}`.trim();
}

function fmtDate(value?: any) {
  const d = toDate(value);
  if (!d) return "-";
  return d.toLocaleDateString("es-AR");
}

function sameMonth(value: any, base: Date) {
  const d = toDate(value);
  if (!d) return false;
  return d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth();
}

function inNextDays(value: any, days: number) {
  const d = toDate(value);
  if (!d) return false;
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return d >= now && d <= end;
}

function isPast(value: any) {
  const d = toDate(value);
  if (!d) return false;
  return d.getTime() < Date.now();
}

function getRemainingAmount(row: ChargeRow) {
  if (typeof row.remainingAmount === "number") return Number(row.remainingAmount || 0);
  const total = Number(row.totalAmount || 0);
  const collected = Number(row.collectedAmount || 0);
  return Math.max(0, total - collected);
}

function getGrossPaid(row: ChargeRow) {
  return Number(row.distribution?.grossAmount ?? row.totalAmount ?? 0);
}

function getDistributable(row: ChargeRow) {
  return Number(row.distribution?.distributableAmount ?? 0);
}

function getStudioFund(row: ChargeRow) {
  return Number(row.distribution?.studioFundAmount ?? 0);
}

function getUserNet(row: ChargeRow, uid?: string | null) {
  if (!uid) return 0;
  const participants = row.distribution?.participants ?? [];
  const found = participants.find((p) => p.uid === uid);
  return Number(found?.amount ?? 0);
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(key?: string) {
  if (!key) return "-";
  const [y, m] = String(key).split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
}

function getPreviousMonthKey(periodKey: string) {
  const [y, m] = periodKey.split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return monthKeyFromDate(d);
}

function daysInMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function percentChange(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / previous) * 100;
}

function getEarliestCaseMonth(cases: CaseRow[]) {
  const validDates = cases
    .map((c) => toDate(c.createdAt))
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());

  if (validDates.length === 0) {
    return monthKeyFromDate(new Date());
  }

  return monthKeyFromDate(validDates[0]);
}

async function generarSnapshotManual(periodKey: string, force = false) {
  const fn = httpsCallable(functions, "generateKpiSnapshotManual");
  const res: any = await fn({ periodKey, force });
  return res.data;
}

async function reconstruirHistoricoCompleto(firstPeriodKey: string, force = false) {
  const fn = httpsCallable(functions, "rebuildKpiHistoryManual");
  const res: any = await fn({ firstPeriodKey, force });
  return res.data;
}

function BarRow({
  label,
  value,
  max,
  helper,
}: {
  label: string;
  value: number;
  max: number;
  helper?: string;
}) {
  const width = max > 0 ? Math.max(4, (value / max) * 100) : 0;

  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-gray-900 dark:text-gray-100">{label}</span>
        <span className="text-xs font-black text-gray-700 dark:text-gray-200">
          {helper ?? Number(value).toLocaleString("es-AR")}
        </span>
      </div>
      <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className="h-3 rounded-full bg-gray-900 dark:bg-gray-200"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  helper,
}: {
  title: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </div>
      <div className="mt-2 text-2xl font-black text-gray-900 dark:text-gray-100">{value}</div>
      {helper ? (
        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{helper}</div>
      ) : null}
    </div>
  );
}

function DeltaBadge({ value }: { value: number }) {
  const positive = value > 0;
  const neutral = Math.abs(value) < 0.05;

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${
        neutral
          ? "border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          : positive
          ? "border-green-300 bg-green-100 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-200"
          : "border-red-300 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
      }`}
    >
      {neutral ? "0%" : `${positive ? "+" : ""}${round1(value)}%`}
    </span>
  );
}

export default function KpiPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [loadingShell, setLoadingShell] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [cases, setCases] = useState<CaseRow[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [sentences, setSentences] = useState<SentenceRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<KpiSnapshotRow[]>([]);

  const [historyRange, setHistoryRange] = useState<number>(6);
  const [savingTarget, setSavingTarget] = useState(false);
  const [rebuildingHistory, setRebuildingHistory] = useState(false);
  const [generatingManualSnapshot, setGeneratingManualSnapshot] = useState(false);

  const currentPeriodKey = monthKeyFromDate(new Date());
  const previousPeriodKey = getPreviousMonthKey(currentPeriodKey);

  const [target, setTarget] = useState<KpiTarget | null>(null);
  const [targetDraft, setTargetDraft] = useState<KpiTarget>({
    revenueTarget: 0,
    studioFundTarget: 0,
    newCasesTarget: 0,
  });

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

        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const pendingSnap = await getDocs(qPending);
        setPendingInvites(pendingSnap.size);
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando KPI");
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
        const [
          casesSnap,
          chargesSnap,
          sentencesSnap,
          contactsSnap,
          usersSnap,
          snapshotsSnap,
          targetData,
        ] = await Promise.all([
          getDocs(query(collection(db, "cases"), limit(1000))),
          getDocs(query(collection(db, "charges"), limit(1000))),
          getDocs(query(collection(db, "sentences"), limit(1000))),
          getDocs(query(collection(db, "contacts"), limit(1000))),
          getDocs(query(collection(db, "users"), limit(500))),
          getDocs(query(collection(db, "kpi_snapshots"), orderBy("periodKey", "asc"), limit(120))),
          getKpiTarget(currentPeriodKey),
        ]);

        setCases(casesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as CaseRow[]);
        setCharges(chargesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ChargeRow[]);
        setSentences(
          sentencesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as SentenceRow[]
        );
        setContacts(contactsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ContactRow[]);
        setSnapshots(
          snapshotsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as KpiSnapshotRow[]
        );

        const nextUsersMap: Record<string, string> = {};
        usersSnap.docs.forEach((d) => {
          const data = d.data() as UserDoc;
          nextUsersMap[d.id] = safeText(data?.email) || d.id;
        });
        setUsersMap(nextUsersMap);

        setTarget(targetData);
        setTargetDraft({
          revenueTarget: Number(targetData?.revenueTarget ?? 0),
          studioFundTarget: Number(targetData?.studioFundTarget ?? 0),
          newCasesTarget: Number(targetData?.newCasesTarget ?? 0),
        });
      } catch (e: any) {
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando indicadores"));
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user, currentPeriodKey]);

  const visibleCases = useMemo(() => cases, [cases]);
  const visibleCharges = useMemo(() => charges, [charges]);
  const now = new Date();

  const paidCharges = useMemo(
    () => visibleCharges.filter((c) => c.status === "paid"),
    [visibleCharges]
  );

  const scheduledCharges = useMemo(
    () => visibleCharges.filter((c) => c.status === "scheduled"),
    [visibleCharges]
  );

  const paidThisMonth = useMemo(
    () => paidCharges.filter((c) => sameMonth(c.paidAt, now)),
    [paidCharges, now]
  );

  const scheduledNext30Days = useMemo(
    () => scheduledCharges.filter((c) => inNextDays(c.scheduledDate, 30)),
    [scheduledCharges]
  );

  const overdueScheduled = useMemo(
    () => scheduledCharges.filter((c) => isPast(c.scheduledDate) && getRemainingAmount(c) > 0),
    [scheduledCharges]
  );

  const transferPending = useMemo(
    () => paidCharges.filter((c) => c.transferTicket?.status === "pending"),
    [paidCharges]
  );

  const totalActiveCases = useMemo(
    () => visibleCases.filter((c) => c.status !== "archived").length,
    [visibleCases]
  );

  const totalArchivedCases = useMemo(
    () => visibleCases.filter((c) => c.status === "archived").length,
    [visibleCases]
  );

  const totalArchiveRequested = useMemo(
    () => visibleCases.filter((c) => c.status === "archsolicited").length,
    [visibleCases]
  );

  const totalInactive60 = useMemo(() => {
    const nowMs = Date.now();
    const maxAgeMs = 60 * 24 * 60 * 60 * 1000;
    return visibleCases.filter((c) => {
      if (c.status === "archived") return false;
      const last = toDate(c.dashboardLastLogAt);
      if (!last) return true;
      return nowMs - last.getTime() > maxAgeMs;
    }).length;
  }, [visibleCases]);

  const grossPaidThisMonth = useMemo(
    () => paidThisMonth.reduce((sum, c) => sum + getGrossPaid(c), 0),
    [paidThisMonth]
  );

  const distributableThisMonth = useMemo(
    () => paidThisMonth.reduce((sum, c) => sum + getDistributable(c), 0),
    [paidThisMonth]
  );

  const studioFundThisMonth = useMemo(
    () => paidThisMonth.reduce((sum, c) => sum + getStudioFund(c), 0),
    [paidThisMonth]
  );

  const pendingScheduledTotal = useMemo(
    () => scheduledCharges.reduce((sum, c) => sum + getRemainingAmount(c), 0),
    [scheduledCharges]
  );

  const overdueScheduledTotal = useMemo(
    () => overdueScheduled.reduce((sum, c) => sum + getRemainingAmount(c), 0),
    [overdueScheduled]
  );

  const next30DaysScheduledTotal = useMemo(
    () => scheduledNext30Days.reduce((sum, c) => sum + getRemainingAmount(c), 0),
    [scheduledNext30Days]
  );

  const sentenceStats = useMemo(() => {
    const total = sentences.length;
    const won = sentences.filter((s) => s.resultado === "ganado").length;
    const lost = sentences.filter((s) => s.resultado === "perdido").length;
    const draw = sentences.filter((s) => s.resultado === "empatado").length;
    const winRate = total > 0 ? (won / total) * 100 : 0;
    return { total, won, lost, draw, winRate };
  }, [sentences]);

  const newCasesThisMonth = useMemo(() => {
    return visibleCases.filter((c) => sameMonth(c.createdAt, now)).length;
  }, [visibleCases, now]);

  const casesByStatus = useMemo(() => {
    const map = new Map<string, number>();
    visibleCases.forEach((c) => {
      const key = safeText(c.status) || "sin_estado";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [visibleCases]);

  const sentencesByJurisdiction = useMemo(() => {
    const map = new Map<string, number>();
    sentences.forEach((s) => {
      const key = safeText(s.jurisdiccion) || "sin jurisdicción";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [sentences]);

  const topDebtors = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    scheduledCharges.forEach((c) => {
      const key = safeText(c.payerRef?.displayName) || "(sin pagador)";
      const prev = map.get(key) ?? { name: key, amount: 0, count: 0 };
      prev.amount += getRemainingAmount(c);
      prev.count += 1;
      map.set(key, prev);
    });
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [scheduledCharges]);

  const lawyerKpis = useMemo(() => {
    const userIds = Object.keys(usersMap);

    const rows: LawyerKpiRow[] = userIds.map((uid) => {
      const email = usersMap[uid] || uid;
      const casesCount = visibleCases.filter((c) =>
        (c.confirmedAssigneesUids ?? []).includes(uid)
      ).length;
      const netPaidMonth = paidThisMonth.reduce((sum, row) => sum + getUserNet(row, uid), 0);
      const pendingToReceive = transferPending.reduce((sum, row) => sum + getUserNet(row, uid), 0);

      return {
        uid,
        email,
        casesCount,
        netPaidMonth,
        pendingToReceive,
      };
    });

    return rows
      .filter((r) => r.casesCount > 0 || r.netPaidMonth > 0 || r.pendingToReceive > 0)
      .sort((a, b) => b.netPaidMonth - a.netPaidMonth || b.casesCount - a.casesCount)
      .slice(0, 20);
  }, [usersMap, visibleCases, paidThisMonth, transferPending]);

  const defaultCurrency = useMemo(() => {
    return safeText(
      paidThisMonth[0]?.currency ||
        scheduledCharges[0]?.currency ||
        paidCharges[0]?.currency ||
        "ARS"
    );
  }, [paidThisMonth, scheduledCharges, paidCharges]);

  const currentLiveSnapshot = useMemo<KpiSnapshotRow>(() => {
    return {
      id: `live-${currentPeriodKey}`,
      periodKey: currentPeriodKey,
      totals: {
        activeCases: totalActiveCases,
        archivedCases: totalArchivedCases,
        archiveRequestedCases: totalArchiveRequested,
        inactiveCases60: totalInactive60,
        chargesPaidGross: grossPaidThisMonth,
        chargesPaidDistributable: distributableThisMonth,
        chargesPaidStudioFund: studioFundThisMonth,
        pendingScheduledAmount: pendingScheduledTotal,
        overdueAmount: overdueScheduledTotal,
        next30DaysAmount: next30DaysScheduledTotal,
        transferPendingCount: transferPending.length,
        contactsCount: contacts.length,
        sentencesCount: sentenceStats.total,
        wonSentences: sentenceStats.won,
        lostSentences: sentenceStats.lost,
        drawSentences: sentenceStats.draw,
        winRate: sentenceStats.winRate,
        newCasesMonth: newCasesThisMonth,
      },
      lawyerKpis: lawyerKpis.map((r) => ({
        uid: r.uid,
        email: r.email,
        casesCount: r.casesCount,
        netPaidMonth: r.netPaidMonth,
        pendingToReceive: r.pendingToReceive,
      })),
    };
  }, [
    currentPeriodKey,
    totalActiveCases,
    totalArchivedCases,
    totalArchiveRequested,
    totalInactive60,
    grossPaidThisMonth,
    distributableThisMonth,
    studioFundThisMonth,
    pendingScheduledTotal,
    overdueScheduledTotal,
    next30DaysScheduledTotal,
    transferPending.length,
    contacts.length,
    sentenceStats,
    newCasesThisMonth,
    lawyerKpis,
  ]);

  const mergedSnapshots = useMemo(() => {
    const map = new Map<string, KpiSnapshotRow>();

    snapshots.forEach((s) => {
      const key = safeText(s.periodKey);
      if (key) map.set(key, s);
    });

    map.set(currentPeriodKey, currentLiveSnapshot);

    return Array.from(map.values()).sort((a, b) =>
      safeText(a.periodKey).localeCompare(safeText(b.periodKey), "es")
    );
  }, [snapshots, currentPeriodKey, currentLiveSnapshot]);

  const currentSnapshot = useMemo(() => {
    return mergedSnapshots.find((s) => safeText(s.periodKey) === currentPeriodKey) ?? null;
  }, [mergedSnapshots, currentPeriodKey]);

  const previousSnapshot = useMemo(() => {
    return mergedSnapshots.find((s) => safeText(s.periodKey) === previousPeriodKey) ?? null;
  }, [mergedSnapshots, previousPeriodKey]);

  const compareMetrics = useMemo(() => {
    const currentGross = Number(currentSnapshot?.totals?.chargesPaidGross ?? 0);
    const previousGross = Number(previousSnapshot?.totals?.chargesPaidGross ?? 0);

    const currentFund = Number(currentSnapshot?.totals?.chargesPaidStudioFund ?? 0);
    const previousFund = Number(previousSnapshot?.totals?.chargesPaidStudioFund ?? 0);

    const currentOverdue = Number(currentSnapshot?.totals?.overdueAmount ?? 0);
    const previousOverdue = Number(previousSnapshot?.totals?.overdueAmount ?? 0);

    const currentNewCases = Number(currentSnapshot?.totals?.newCasesMonth ?? 0);
    const previousNewCases = Number(previousSnapshot?.totals?.newCasesMonth ?? 0);

    const currentWinRate = Number(currentSnapshot?.totals?.winRate ?? 0);
    const previousWinRate = Number(previousSnapshot?.totals?.winRate ?? 0);

    return {
      grossDiffPct: percentChange(currentGross, previousGross),
      fundDiffPct: percentChange(currentFund, previousFund),
      overdueDiffPct: percentChange(currentOverdue, previousOverdue),
      newCasesDiffPct: percentChange(currentNewCases, previousNewCases),
      winRateDiffPct: percentChange(currentWinRate, previousWinRate),
    };
  }, [currentSnapshot, previousSnapshot]);

  const chartSnapshots = useMemo(() => {
    const ordered = [...mergedSnapshots];
    if (historyRange === 999) return ordered;
    return ordered.slice(-historyRange);
  }, [mergedSnapshots, historyRange]);

  const chartMaxGross = useMemo(() => {
    return Math.max(
      1,
      ...chartSnapshots.map((s) => Number(s.totals?.chargesPaidGross ?? 0))
    );
  }, [chartSnapshots]);

  const chartMaxFund = useMemo(() => {
    return Math.max(
      1,
      ...chartSnapshots.map((s) => Number(s.totals?.chargesPaidStudioFund ?? 0))
    );
  }, [chartSnapshots]);

  const chartMaxOverdue = useMemo(() => {
    return Math.max(
      1,
      ...chartSnapshots.map((s) => Number(s.totals?.overdueAmount ?? 0))
    );
  }, [chartSnapshots]);

  const revenueProgress = useMemo(() => {
    const targetValue = Number(target?.revenueTarget ?? 0);
    if (!targetValue) return null;
    return (grossPaidThisMonth / targetValue) * 100;
  }, [target, grossPaidThisMonth]);

  const studioFundProgress = useMemo(() => {
    const targetValue = Number(target?.studioFundTarget ?? 0);
    if (!targetValue) return null;
    return (studioFundThisMonth / targetValue) * 100;
  }, [target, studioFundThisMonth]);

  const newCasesProgress = useMemo(() => {
    const targetValue = Number(target?.newCasesTarget ?? 0);
    if (!targetValue) return null;
    return (newCasesThisMonth / targetValue) * 100;
  }, [target, newCasesThisMonth]);

  const projectedMonthRevenue = useMemo(() => {
    const dayOfMonth = now.getDate();
    const totalDays = daysInMonth(now);
    if (dayOfMonth <= 0) return grossPaidThisMonth;
    return (grossPaidThisMonth / dayOfMonth) * totalDays;
  }, [grossPaidThisMonth, now]);

  const projectedMonthStudioFund = useMemo(() => {
    const dayOfMonth = now.getDate();
    const totalDays = daysInMonth(now);
    if (dayOfMonth <= 0) return studioFundThisMonth;
    return (studioFundThisMonth / dayOfMonth) * totalDays;
  }, [studioFundThisMonth, now]);

  const historicalLawyerRanking = useMemo(() => {
    const map = new Map<string, { email: string; total: number }>();

    mergedSnapshots.forEach((snap) => {
      (snap.lawyerKpis ?? []).forEach((row) => {
        const uid = safeText(row.uid);
        if (!uid) return;
        const prev = map.get(uid) ?? {
          email: safeText(row.email) || usersMap[uid] || uid,
          total: 0,
        };
        prev.total += Number(row.netPaidMonth ?? 0);
        if (!prev.email) prev.email = safeText(row.email) || usersMap[uid] || uid;
        map.set(uid, prev);
      });
    });

    return Array.from(map.entries())
      .map(([uid, data]) => ({
        uid,
        email: data.email,
        total: data.total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [mergedSnapshots, usersMap]);

  const alerts = useMemo(() => {
    const result: string[] = [];

    if (compareMetrics.grossDiffPct < 0) {
      result.push("⚠️ La facturación del mes cayó respecto del período anterior.");
    }

    if (compareMetrics.overdueDiffPct > 0) {
      result.push("⚠️ La morosidad aumentó respecto del período anterior.");
    }

    if (compareMetrics.newCasesDiffPct < 0) {
      result.push("⚠️ Ingresaron menos causas nuevas que en el período anterior.");
    }

    if (compareMetrics.winRateDiffPct < 0) {
      result.push("⚠️ La tasa de éxito bajó respecto del período anterior.");
    }

    if (totalInactive60 >= 5) {
      result.push("⚠️ Hay varias causas sin movimiento hace más de 60 días.");
    }

    if (transferPending.length >= 5) {
      result.push("⚠️ Hay muchos tickets de transferencias internas pendientes.");
    }

    return result;
  }, [compareMetrics, totalInactive60, transferPending.length]);

  async function handleSaveTarget() {
    try {
      setSavingTarget(true);
      const payload: KpiTarget = {
        revenueTarget: Number(targetDraft.revenueTarget ?? 0),
        studioFundTarget: Number(targetDraft.studioFundTarget ?? 0),
        newCasesTarget: Number(targetDraft.newCasesTarget ?? 0),
      };
      await saveKpiTarget(currentPeriodKey, payload);
      setTarget(payload);
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudieron guardar las metas.");
    } finally {
      setSavingTarget(false);
    }
  }

  async function handleGeneratePreviousMonthSnapshot() {
    try {
      setGeneratingManualSnapshot(true);
      const result = await generarSnapshotManual(previousPeriodKey, true);

      alert(`Snapshot generado: ${result.periodKey}`);

      const snapshotsSnap = await getDocs(
        query(collection(db, "kpi_snapshots"), orderBy("periodKey", "asc"), limit(120))
      );

      setSnapshots(
        snapshotsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as KpiSnapshotRow[]
      );
    } catch (e: any) {
      alert(`Error generando snapshot: ${e?.message ?? "desconocido"}`);
    } finally {
      setGeneratingManualSnapshot(false);
    }
  }

  async function handleRebuildHistory() {
    try {
      setRebuildingHistory(true);

      const firstPeriodKey = getEarliestCaseMonth(cases);
      const result = await reconstruirHistoricoCompleto(firstPeriodKey, true);

      alert(`Histórico reconstruido correctamente. Meses procesados: ${result.count}`);

      const snapshotsSnap = await getDocs(
        query(collection(db, "kpi_snapshots"), orderBy("periodKey", "asc"), limit(120))
      );

      setSnapshots(
        snapshotsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as KpiSnapshotRow[]
      );
    } catch (e: any) {
      alert(`Error reconstruyendo histórico: ${e?.message ?? "desconocido"}`);
    } finally {
      setRebuildingHistory(false);
    }
  }

  function exportKpiReport() {
    const rows = chartSnapshots.map((s) => [
      safeText(s.periodKey),
      Number(s.totals?.chargesPaidGross ?? 0),
      Number(s.totals?.chargesPaidStudioFund ?? 0),
      Number(s.totals?.overdueAmount ?? 0),
      Number(s.totals?.activeCases ?? 0),
      Number(s.totals?.newCasesMonth ?? 0),
      Number(s.totals?.winRate ?? 0),
    ]);

    const csv = [
      [
        "Periodo",
        "Cobrado bruto",
        "Fondo estudio",
        "Morosidad",
        "Causas activas",
        "Causas nuevas",
        "Tasa exito",
      ],
      ...rows,
    ]
      .map((r) => r.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kpi-estudio-${currentPeriodKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="KPI del estudio"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "KPI del estudio" },
      ]}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loadingShell || loadingData ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando indicadores...
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div>
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Panel estratégico
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            Período actual: {monthLabelFromKey(currentPeriodKey)}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[3, 6, 12, 999].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setHistoryRange(m)}
              className={`rounded-xl px-3 py-2 text-sm font-extrabold ${
                historyRange === m
                  ? "bg-black text-white"
                  : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              }`}
            >
              {m === 999 ? "Todo" : `${m} meses`}
            </button>
          ))}

          <button
            type="button"
            onClick={exportKpiReport}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Exportar reporte
          </button>

          {role === "admin" ? (
            <button
              type="button"
              onClick={handleGeneratePreviousMonthSnapshot}
              disabled={generatingManualSnapshot}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {generatingManualSnapshot
                ? "Generando snapshot..."
                : "Generar snapshot mes anterior"}
            </button>
          ) : null}

          {role === "admin" ? (
            <button
              type="button"
              onClick={handleRebuildHistory}
              disabled={rebuildingHistory}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {rebuildingHistory ? "Reconstruyendo..." : "Reconstruir histórico completo"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Causas activas"
          value={String(totalActiveCases)}
          helper={`${totalArchivedCases} archivadas · ${totalArchiveRequested} con archivo solicitado`}
        />
        <KpiCard
          title="Cobrado bruto del mes"
          value={fmtMoney(grossPaidThisMonth, defaultCurrency)}
          helper={`Comparación: ${round1(compareMetrics.grossDiffPct)}% vs. período anterior`}
        />
        <KpiCard
          title="Fondo estudio del mes"
          value={fmtMoney(studioFundThisMonth, defaultCurrency)}
          helper={`Comparación: ${round1(compareMetrics.fundDiffPct)}%`}
        />
        <KpiCard
          title="Pendiente de cobro"
          value={fmtMoney(pendingScheduledTotal, defaultCurrency)}
          helper={`Vencido: ${fmtMoney(overdueScheduledTotal, defaultCurrency)}`}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Próximos 30 días"
          value={fmtMoney(next30DaysScheduledTotal, defaultCurrency)}
          helper={`${scheduledNext30Days.length} cobro(s) agendados`}
        />
        <KpiCard
          title="Transferencias pendientes"
          value={String(transferPending.length)}
          helper="Tickets internos aún no confirmados"
        />
        <KpiCard
          title="Causas inactivas"
          value={String(totalInactive60)}
          helper="Sin movimientos hace más de 60 días"
        />
        <KpiCard
          title="Contactos"
          value={String(contacts.length)}
          helper={`${sentences.length} sentencias cargadas`}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Comparación con período anterior
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              {monthLabelFromKey(previousPeriodKey)}
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Facturación bruta
              </span>
              <DeltaBadge value={compareMetrics.grossDiffPct} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Fondo estudio
              </span>
              <DeltaBadge value={compareMetrics.fundDiffPct} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Morosidad
              </span>
              <DeltaBadge value={compareMetrics.overdueDiffPct} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Nuevas causas
              </span>
              <DeltaBadge value={compareMetrics.newCasesDiffPct} />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Tasa de éxito
              </span>
              <DeltaBadge value={compareMetrics.winRateDiffPct} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Proyección de cierre mensual
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Facturación proyectada
              </div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {fmtMoney(projectedMonthRevenue, defaultCurrency)}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Fondo estudio proyectado
              </div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {fmtMoney(projectedMonthStudioFund, defaultCurrency)}
              </div>
            </div>
          </div>

          <div className="mt-3 text-xs text-gray-600 dark:text-gray-300">
            Proyección lineal en base a lo registrado hasta hoy ({now.getDate()} /{" "}
            {daysInMonth(now)}).
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Histórico de facturación
          </div>
          <div className="mt-3 grid gap-3">
            {chartSnapshots.length === 0 ? (
              <div className="text-sm text-gray-700 dark:text-gray-200">Sin datos.</div>
            ) : (
              chartSnapshots.map((snap) => (
                <BarRow
                  key={`gross-${snap.periodKey}`}
                  label={monthLabelFromKey(snap.periodKey)}
                  value={Number(snap.totals?.chargesPaidGross ?? 0)}
                  max={chartMaxGross}
                  helper={fmtMoney(Number(snap.totals?.chargesPaidGross ?? 0), defaultCurrency)}
                />
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Histórico de fondo y morosidad
          </div>

          <div className="mt-4">
            <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Fondo estudio
            </div>
            <div className="mt-2 grid gap-3">
              {chartSnapshots.map((snap) => (
                <BarRow
                  key={`fund-${snap.periodKey}`}
                  label={monthLabelFromKey(snap.periodKey)}
                  value={Number(snap.totals?.chargesPaidStudioFund ?? 0)}
                  max={chartMaxFund}
                  helper={fmtMoney(
                    Number(snap.totals?.chargesPaidStudioFund ?? 0),
                    defaultCurrency
                  )}
                />
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Morosidad
            </div>
            <div className="mt-2 grid gap-3">
              {chartSnapshots.map((snap) => (
                <BarRow
                  key={`overdue-${snap.periodKey}`}
                  label={monthLabelFromKey(snap.periodKey)}
                  value={Number(snap.totals?.overdueAmount ?? 0)}
                  max={chartMaxOverdue}
                  helper={fmtMoney(Number(snap.totals?.overdueAmount ?? 0), defaultCurrency)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Metas del mes
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            {monthLabelFromKey(currentPeriodKey)}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Facturación
              </div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {revenueProgress === null ? "-" : `${round1(revenueProgress)}%`}
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Meta: {fmtMoney(Number(target?.revenueTarget ?? 0), defaultCurrency)}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Fondo estudio
              </div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {studioFundProgress === null ? "-" : `${round1(studioFundProgress)}%`}
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Meta: {fmtMoney(Number(target?.studioFundTarget ?? 0), defaultCurrency)}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Nuevas causas
              </div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {newCasesProgress === null ? "-" : `${round1(newCasesProgress)}%`}
              </div>
              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                Meta: {Number(target?.newCasesTarget ?? 0)}
              </div>
            </div>
          </div>

          {role === "admin" ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Editar metas
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Meta facturación
                  </span>
                  <input
                    type="number"
                    value={Number(targetDraft.revenueTarget ?? 0)}
                    onChange={(e) =>
                      setTargetDraft((prev) => ({
                        ...prev,
                        revenueTarget: Number(e.target.value),
                      }))
                    }
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Meta fondo estudio
                  </span>
                  <input
                    type="number"
                    value={Number(targetDraft.studioFundTarget ?? 0)}
                    onChange={(e) =>
                      setTargetDraft((prev) => ({
                        ...prev,
                        studioFundTarget: Number(e.target.value),
                      }))
                    }
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Meta nuevas causas
                  </span>
                  <input
                    type="number"
                    value={Number(targetDraft.newCasesTarget ?? 0)}
                    onChange={(e) =>
                      setTargetDraft((prev) => ({
                        ...prev,
                        newCasesTarget: Number(e.target.value),
                      }))
                    }
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  />
                </label>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleSaveTarget}
                  disabled={savingTarget}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {savingTarget ? "Guardando..." : "Guardar metas"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Alertas de gestión
          </div>

          <div className="mt-3 grid gap-2">
            {alerts.length === 0 ? (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-900/20 dark:text-green-100">
                No se detectan alertas relevantes en este momento.
              </div>
            ) : (
              alerts.map((alert, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100"
                >
                  {alert}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Resultado de sentencias
            </div>
            <Link
              href="/jurisprudencia"
              className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200"
            >
              Ver jurisprudencia
            </Link>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Total</div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {sentenceStats.total}
              </div>
            </div>
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <div className="text-xs font-extrabold text-green-700 dark:text-green-300">
                Ganadas
              </div>
              <div className="mt-1 text-lg font-black text-green-900 dark:text-green-100">
                {sentenceStats.won}
              </div>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <div className="text-xs font-extrabold text-red-700 dark:text-red-300">
                Perdidas
              </div>
              <div className="mt-1 text-lg font-black text-red-900 dark:text-red-100">
                {sentenceStats.lost}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
              <div className="text-xs font-extrabold text-amber-700 dark:text-amber-300">
                Tasa de éxito
              </div>
              <div className="mt-1 text-lg font-black text-amber-900 dark:text-amber-100">
                {sentenceStats.winRate.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Por jurisdicción
            </div>
            <div className="mt-2 grid gap-2">
              {sentencesByJurisdiction.length === 0 ? (
                <div className="text-sm text-gray-700 dark:text-gray-200">Sin datos.</div>
              ) : (
                sentencesByJurisdiction.slice(0, 8).map(([label, count]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
                  >
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{label}</span>
                    <span className="font-black text-gray-900 dark:text-gray-100">{count}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Estado general de causas
            </div>
            <Link
              href="/cases/manage"
              className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200"
            >
              Ver causas
            </Link>
          </div>

          <div className="mt-4 grid gap-2">
            {casesByStatus.length === 0 ? (
              <div className="text-sm text-gray-700 dark:text-gray-200">Sin datos.</div>
            ) : (
              casesByStatus.map(([label, count]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
                >
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{label}</span>
                  <span className="font-black text-gray-900 dark:text-gray-100">{count}</span>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100">
            Causas con pedido de archivo: <span className="font-black">{totalArchiveRequested}</span>
          </div>

          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100">
            Causas inactivas hace más de 60 días: <span className="font-black">{totalInactive60}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Top de pagadores con saldo pendiente
            </div>
            <Link
              href="/cobranzas"
              className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200"
            >
              Ver cobranzas
            </Link>
          </div>

          <div className="mt-3 grid gap-2">
            {topDebtors.length === 0 ? (
              <div className="text-sm text-gray-700 dark:text-gray-200">
                No hay deuda pendiente.
              </div>
            ) : (
              topDebtors.map((row) => (
                <div
                  key={row.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
                >
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{row.name}</div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {row.count} cobro(s) pendientes
                    </div>
                  </div>
                  <div className="font-black text-gray-900 dark:text-gray-100">
                    {fmtMoney(row.amount, defaultCurrency)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Próximos vencimientos de cobro
          </div>

          <div className="mt-3 grid gap-2">
            {scheduledNext30Days.length === 0 ? (
              <div className="text-sm text-gray-700 dark:text-gray-200">
                No hay vencimientos próximos.
              </div>
            ) : (
              [...scheduledNext30Days]
                .sort((a, b) => {
                  const aa = toDate(a.scheduledDate)?.getTime() ?? 0;
                  const bb = toDate(b.scheduledDate)?.getTime() ?? 0;
                  return aa - bb;
                })
                .slice(0, 10)
                .map((row) => (
                  <Link
                    key={row.id}
                    href={`/cobranzas/registrar?scheduledId=${row.id}`}
                    className="block rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700"
                  >
                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                      {safeText(row.payerRef?.displayName) || "(sin pagador)"}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {fmtDate(row.scheduledDate)} ·{" "}
                      {safeText(row.caseRef?.caratula) ||
                        safeText(row.caseRef?.extraCaseReason) ||
                        "Sin causa"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-gray-900 dark:text-gray-100">
                      Pendiente: {fmtMoney(getRemainingAmount(row), row.currency)}
                    </div>
                  </Link>
                ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            KPI por abogado
          </div>
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Neto del mes, causas activas y pendiente de recibir
          </div>
        </div>

        <div className="mt-3 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
          <div className="hidden grid-cols-[minmax(220px,1.4fr)_120px_160px_180px] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800/40 dark:text-gray-400 md:grid">
            <div>Abogado</div>
            <div>Causas</div>
            <div>Neto mes</div>
            <div>Pendiente recibir</div>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {lawyerKpis.length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-700 dark:text-gray-200">Sin datos.</div>
            ) : (
              lawyerKpis.map((row) => (
                <div
                  key={row.uid}
                  className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(220px,1.4fr)_120px_160px_180px] md:items-center"
                >
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {row.email}
                  </div>
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    {row.casesCount}
                  </div>
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {fmtMoney(row.netPaidMonth, defaultCurrency)}
                  </div>
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {fmtMoney(row.pendingToReceive, defaultCurrency)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
          Ranking histórico por abogado
        </div>

        <div className="mt-3 grid gap-2">
          {historicalLawyerRanking.length === 0 ? (
            <div className="text-sm text-gray-700 dark:text-gray-200">Sin histórico.</div>
          ) : (
            historicalLawyerRanking.map((row, index) => (
              <div
                key={row.uid}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black text-xs font-black text-white dark:bg-gray-100 dark:text-black">
                    {index + 1}
                  </span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">
                    {row.email}
                  </span>
                </div>
                <span className="font-black text-gray-900 dark:text-gray-100">
                  {fmtMoney(row.total, defaultCurrency)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}