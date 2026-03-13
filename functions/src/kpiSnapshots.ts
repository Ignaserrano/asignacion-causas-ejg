import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

type MainCaseStatus = "draft" | "assigned" | "archsolicited" | "archived";

type CaseRow = {
  id: string;
  caratulaTentativa?: string;
  status?: MainCaseStatus;
  confirmedAssigneesUids?: string[];
  broughtByUid?: string;
  dashboardLastLogAt?: admin.firestore.Timestamp | Date | null;
  createdAt?: admin.firestore.Timestamp | Date | null;
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
  currency?: string;
  totalAmount?: number;
  collectedAmount?: number;
  remainingAmount?: number;
  paidAt?: admin.firestore.Timestamp | Date | null;
  scheduledDate?: admin.firestore.Timestamp | Date | null;
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
  createdAt?: admin.firestore.Timestamp | Date | null;
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

type SnapshotLawyerKpi = {
  uid: string;
  email: string;
  casesCount: number;
  netPaidMonth: number;
  pendingToReceive: number;
};

function safeText(v: unknown) {
  return String(v ?? "").trim();
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as any).toDate === "function"
  ) {
    const d = (value as any).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }

  const d = new Date(value as any);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parsePeriodKey(periodKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!year || month < 1 || month > 12) return null;
  return new Date(year, month - 1, 1);
}

function sameMonth(value: unknown, base: Date) {
  const d = toDate(value);
  if (!d) return false;
  return d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth();
}

function isPast(value: unknown) {
  const d = toDate(value);
  if (!d) return false;
  return d.getTime() < Date.now();
}

function inNextDays(value: unknown, days: number) {
  const d = toDate(value);
  if (!d) return false;
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return d >= now && d <= end;
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

function getPreviousMonthReference(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, diff: number) {
  return new Date(date.getFullYear(), date.getMonth() + diff, 1);
}

async function readAll<T = admin.firestore.DocumentData>(collectionName: string) {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }));
}

async function assertAdminUid(uid: string) {
  const callerSnap = await db.collection("users").doc(uid).get();
  const callerRole = callerSnap.exists ? safeText(callerSnap.data()?.role) : "";
  if (callerRole !== "admin") {
    throw new HttpsError(
      "permission-denied",
      "Solo un administrador puede ejecutar esta acción."
    );
  }
}

async function buildAndSaveSnapshot(params: {
  periodKey: string;
  targetMonth: Date;
  source: "scheduled_function" | "manual_callable" | "manual_rebuild";
  requestedByUid?: string | null;
  force?: boolean;
}) {
  const { periodKey, targetMonth, source, requestedByUid = null, force = false } = params;

  const ref = db.collection("kpi_snapshots").doc(periodKey);
  const existing = await ref.get();

  if (existing.exists && !force) {
    return {
      ok: true,
      periodKey,
      skipped: true,
      reason: "already_exists",
    };
  }

  const [casesRaw, chargesRaw, sentencesRaw, contactsRaw, usersRaw] = await Promise.all([
    readAll<CaseRow>("cases"),
    readAll<ChargeRow>("charges"),
    readAll<SentenceRow>("sentences"),
    readAll<ContactRow>("contacts"),
    readAll<UserDoc>("users"),
  ]);

  const cases = casesRaw as CaseRow[];
  const charges = chargesRaw as ChargeRow[];
  const contacts = contactsRaw as ContactRow[];
  const users = usersRaw as Array<UserDoc & { id: string }>;
  const sentences = (sentencesRaw as SentenceRow[]).filter((s) => sameMonth(s.createdAt, targetMonth));

  const paidCharges = charges.filter(
    (c) => c.status === "paid" && sameMonth(c.paidAt, targetMonth)
  );

  const scheduledCharges = charges.filter((c) => c.status === "scheduled");
  const overdueScheduled = scheduledCharges.filter(
    (c) => isPast(c.scheduledDate) && getRemainingAmount(c) > 0
  );
  const next30DaysScheduled = scheduledCharges.filter((c) => inNextDays(c.scheduledDate, 30));
  const transferPending = charges.filter(
    (c) => c.status === "paid" && c.transferTicket?.status === "pending"
  );

  const nowMs = Date.now();
  const maxAgeMs = 60 * 24 * 60 * 60 * 1000;

  const totalActiveCases = cases.filter((c) => c.status !== "archived").length;
  const totalArchivedCases = cases.filter((c) => c.status === "archived").length;
  const totalArchiveRequested = cases.filter((c) => c.status === "archsolicited").length;

  const totalInactive60 = cases.filter((c) => {
    if (c.status === "archived") return false;
    const last = toDate(c.dashboardLastLogAt);
    if (!last) return true;
    return nowMs - last.getTime() > maxAgeMs;
  }).length;

  const grossPaidMonth = paidCharges.reduce((sum, c) => sum + getGrossPaid(c), 0);
  const distributableMonth = paidCharges.reduce((sum, c) => sum + getDistributable(c), 0);
  const studioFundMonth = paidCharges.reduce((sum, c) => sum + getStudioFund(c), 0);

  const pendingScheduledTotal = scheduledCharges.reduce(
    (sum, c) => sum + getRemainingAmount(c),
    0
  );

  const overdueScheduledTotal = overdueScheduled.reduce(
    (sum, c) => sum + getRemainingAmount(c),
    0
  );

  const next30DaysScheduledTotal = next30DaysScheduled.reduce(
    (sum, c) => sum + getRemainingAmount(c),
    0
  );

  const won = sentences.filter((s) => s.resultado === "ganado").length;
  const lost = sentences.filter((s) => s.resultado === "perdido").length;
  const draw = sentences.filter((s) => s.resultado === "empatado").length;
  const winRate = sentences.length > 0 ? (won / sentences.length) * 100 : 0;

  const newCasesMonth = cases.filter((c) => sameMonth(c.createdAt, targetMonth)).length;

  const usersMap: Record<string, string> = {};
  users.forEach((u: any) => {
    usersMap[u.id] = safeText(u.email) || u.id;
  });

  const lawyerKpis: SnapshotLawyerKpi[] = Object.keys(usersMap)
    .map((uid) => {
      const email = usersMap[uid];
      const casesCount = cases.filter((c) => (c.confirmedAssigneesUids ?? []).includes(uid)).length;
      const netPaidMonth = paidCharges.reduce((sum, row) => sum + getUserNet(row, uid), 0);
      const pendingToReceive = transferPending.reduce(
        (sum, row) => sum + getUserNet(row, uid),
        0
      );

      return {
        uid,
        email,
        casesCount,
        netPaidMonth,
        pendingToReceive,
      };
    })
    .filter((r) => r.casesCount > 0 || r.netPaidMonth > 0 || r.pendingToReceive > 0)
    .sort((a, b) => b.netPaidMonth - a.netPaidMonth || b.casesCount - a.casesCount);

  await ref.set(
    {
      periodKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      source,
      requestedByUid,
      totals: {
        activeCases: totalActiveCases,
        archivedCases: totalArchivedCases,
        archiveRequestedCases: totalArchiveRequested,
        inactiveCases60: totalInactive60,
        chargesPaidGross: grossPaidMonth,
        chargesPaidDistributable: distributableMonth,
        chargesPaidStudioFund: studioFundMonth,
        pendingScheduledAmount: pendingScheduledTotal,
        overdueAmount: overdueScheduledTotal,
        next30DaysAmount: next30DaysScheduledTotal,
        transferPendingCount: transferPending.length,
        contactsCount: contacts.length,
        sentencesCount: sentences.length,
        wonSentences: won,
        lostSentences: lost,
        drawSentences: draw,
        winRate,
        newCasesMonth,
      },
      lawyerKpis,
    },
    { merge: false }
  );

  return {
    ok: true,
    periodKey,
    skipped: false,
  };
}

export const saveMonthlyKpiSnapshot = onSchedule(
  {
    schedule: "10 0 1 * *",
    timeZone: "America/Argentina/Buenos_Aires",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 540,
  },
  async () => {
    try {
      const targetMonth = getPreviousMonthReference(new Date());
      const periodKey = monthKeyFromDate(targetMonth);

      logger.info("Iniciando snapshot mensual KPI", { periodKey });

      const result = await buildAndSaveSnapshot({
        periodKey,
        targetMonth,
        source: "scheduled_function",
        force: false,
      });

      logger.info("Resultado snapshot mensual KPI", result);
    } catch (error: any) {
      logger.error("Error en saveMonthlyKpiSnapshot", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? "",
      });
      throw error;
    }
  }
);

export const generateKpiSnapshotManual = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    try {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debés estar autenticado.");
      }

      const uid = request.auth.uid;
      const data = request.data ?? {};
      const periodKey = safeText(data.periodKey);
      const force = Boolean(data.force);

      if (!periodKey) {
        throw new HttpsError("invalid-argument", "Falta periodKey. Usá formato YYYY-MM.");
      }

      const targetMonth = parsePeriodKey(periodKey);
      if (!targetMonth) {
        throw new HttpsError("invalid-argument", "periodKey inválido. Usá formato YYYY-MM.");
      }

      await assertAdminUid(uid);

      logger.info("Generación manual de snapshot KPI solicitada", {
        uid,
        periodKey,
        force,
      });

      const result = await buildAndSaveSnapshot({
        periodKey,
        targetMonth,
        source: "manual_callable",
        requestedByUid: uid,
        force,
      });

      return result;
    } catch (error: any) {
      logger.error("Error en generateKpiSnapshotManual", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? "",
      });

      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", error?.message ?? "Error interno generando snapshot manual.");
    }
  }
);

export const rebuildKpiHistoryManual = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (request) => {
    try {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Debés estar autenticado.");
      }

      const uid = request.auth.uid;
      await assertAdminUid(uid);

      const data = request.data ?? {};
      const force = Boolean(data.force);
      const firstPeriodKey = safeText(data.firstPeriodKey);

      if (!firstPeriodKey) {
        throw new HttpsError("invalid-argument", "Falta firstPeriodKey. Usá formato YYYY-MM.");
      }

      const firstMonth = parsePeriodKey(firstPeriodKey);
      if (!firstMonth) {
        throw new HttpsError("invalid-argument", "firstPeriodKey inválido. Usá formato YYYY-MM.");
      }

      const lastMonth = getPreviousMonthReference(new Date());

      if (firstMonth.getTime() > lastMonth.getTime()) {
        throw new HttpsError(
          "invalid-argument",
          "El primer período no puede ser posterior al último mes cerrado."
        );
      }

      const results: Array<{
        periodKey: string;
        skipped?: boolean;
        reason?: string;
      }> = [];

      let cursor = getMonthStart(firstMonth);
      const end = getMonthStart(lastMonth);

      while (cursor.getTime() <= end.getTime()) {
        const periodKey = monthKeyFromDate(cursor);

        const result = await buildAndSaveSnapshot({
          periodKey,
          targetMonth: cursor,
          source: "manual_rebuild",
          requestedByUid: uid,
          force,
        });

        results.push({
          periodKey,
          skipped: Boolean(result.skipped),
          reason: result.reason,
        });

        cursor = addMonths(cursor, 1);
      }

      return {
        ok: true,
        count: results.length,
        results,
      };
    } catch (error: any) {
      logger.error("Error en rebuildKpiHistoryManual", {
        message: error?.message ?? String(error),
        stack: error?.stack ?? "",
      });

      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", error?.message ?? "Error interno reconstruyendo histórico.");
    }
  }
);