"use client";

import { useEffect, useState } from "react";
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
import { getChargeUserNetAmount, getScheduledRemainingAmount } from "@/lib/charges";
import { listUpcomingEventsForUser, type CalendarEventRow } from "@/lib/events";

async function exportExcel() {
  const fn = httpsCallable(functions, "adminExportCasesExcel");
  const res: any = await fn();

  const link = document.createElement("a");
  link.href =
    "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
    res.data.base64;
  link.download = res.data.fileName;
  link.click();
}

type FeedItem = {
  caseId: string;
  caratula: string;
  title: string;
  createdAtSec: number;
  createdByEmail?: string;
};

type FeedGroup = {
  caseId: string;
  caratula: string;
  latestSec: number;
  items: FeedItem[];
};

type InactiveItem = {
  caseId: string;
  caratula: string;
  lastLogAtSec?: number;
};

type ArchiveRequestItem = {
  caseId: string;
  caratula: string;
  requestedAtSec?: number;
  requestedByEmail?: string;
};

type TransferPendingItem = {
  chargeId: string;
  payerName: string;
  caseLabel: string;
  paidAtSec?: number;
  myNetAmount?: number;
  currency?: string;
  ownerUid?: string;
  isOwner: boolean;
};

type OverdueChargeItem = {
  chargeId: string;
  payerName: string;
  caseLabel: string;
  scheduledAtSec?: number;
  remainingAmount?: number;
  currency?: string;
};

type CaseRow = {
  id: string;
  caratulaTentativa?: string;
  status?: "draft" | "assigned" | "archsolicited" | "archived";
  dashboardLastLogAt?: { seconds: number };
  dashboardLastLogTitle?: string;
  dashboardLastLogByEmail?: string;
};

type SentInviteStatus = "pending" | "accepted" | "rejected";
type SentInviteMode = "auto" | "direct";

type SentInviteItem = {
  inviteId: string;
  caseId: string;
  caratula: string;
  invitedEmail?: string;
  status: SentInviteStatus;
  mode: SentInviteMode;
  directJustification?: string;
  invitedAtSec: number;
  respondedAtSec: number;
  sortSec: number;
};

function fmtDateTime(sec?: number) {
  if (!sec) return "-";
  return new Date(sec * 1000).toLocaleString("es-AR");
}

function fmtTsDateTime(value?: any) {
  if (!value) return "-";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-AR");
}

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString("es-AR")} ${currency ?? ""}`.trim();
}

function toSecondsMaybe(ts: any): number {
  const s = ts?.seconds;
  return typeof s === "number" ? s : 0;
}

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [feedGroups, setFeedGroups] = useState<FeedGroup[]>([]);
  const [inactive, setInactive] = useState<InactiveItem[]>([]);
  const [loadingWidgets, setLoadingWidgets] = useState(false);

  const [archiveRequests, setArchiveRequests] = useState<ArchiveRequestItem[]>([]);
  const [loadingArchiveRequests, setLoadingArchiveRequests] = useState(false);

  const [pendingTransfers, setPendingTransfers] = useState<TransferPendingItem[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);

  const [overdueCharges, setOverdueCharges] = useState<OverdueChargeItem[]>([]);
  const [loadingOverdueCharges, setLoadingOverdueCharges] = useState(false);

  const [sentInvites, setSentInvites] = useState<SentInviteItem[]>([]);
  const [loadingSentInvites, setLoadingSentInvites] = useState(false);

  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEventRow[]>([]);
  const [loadingUpcomingEvents, setLoadingUpcomingEvents] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setLoading(true);
      setMsg(null);

      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));

        const qInv = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const invSnap = await getDocs(qInv);
        setPendingInvites(invSnap.size);
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando dashboard");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    (async () => {
      if (!user) return;

      setLoadingWidgets(true);
      try {
        const casesQ = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", user.uid),
          orderBy("createdAt", "desc"),
          limit(200)
        );

        const casesSnap = await getDocs(casesQ);
        const myCases = casesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as CaseRow[];

        const myCaseIds = new Set(myCases.map((c) => c.id));
        const caseMap = new Map(
          myCases.map((c) => [c.id, String(c.caratulaTentativa ?? c.id)])
        );

        const now = Date.now();
        const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

        const inactiveTmp: InactiveItem[] = [];
        for (const c of myCases) {
          if (c.status === "archived") continue;

          const lastLogAtSec = c.dashboardLastLogAt?.seconds;
          if (!lastLogAtSec || now - lastLogAtSec * 1000 > sixtyDaysMs) {
            inactiveTmp.push({
              caseId: c.id,
              caratula: String(c.caratulaTentativa ?? ""),
              lastLogAtSec,
            });
          }
        }

        inactiveTmp.sort((a, b) => (a.lastLogAtSec ?? 0) - (b.lastLogAtSec ?? 0));
        setInactive(inactiveTmp.slice(0, 30));

        const logsQ = query(
          collectionGroup(db, "logs"),
          orderBy("createdAt", "desc"),
          limit(150)
        );
        const logsSnap = await getDocs(logsQ);

        const recentLogs: FeedItem[] = [];
        for (const d of logsSnap.docs) {
          const parentDoc = d.ref.parent.parent;
          const caseId = parentDoc?.id ?? "";
          if (!caseId || !myCaseIds.has(caseId)) continue;

          const data = d.data() as any;
          const createdAtSec = Number(data?.createdAt?.seconds ?? 0);
          if (!createdAtSec) continue;

          recentLogs.push({
            caseId,
            caratula: caseMap.get(caseId) ?? caseId,
            title: String(data?.title ?? "(sin título)"),
            createdAtSec,
            createdByEmail: String(data?.createdByEmail ?? ""),
          });

          if (recentLogs.length >= 20) break;
        }

        const groupedMap = new Map<string, FeedGroup>();
        for (const item of recentLogs) {
          const found = groupedMap.get(item.caseId);
          if (!found) {
            groupedMap.set(item.caseId, {
              caseId: item.caseId,
              caratula: item.caratula,
              latestSec: item.createdAtSec,
              items: [item],
            });
          } else {
            found.items.push(item);
            if (item.createdAtSec > found.latestSec) found.latestSec = item.createdAtSec;
          }
        }

        const grouped = Array.from(groupedMap.values()).sort((a, b) => b.latestSec - a.latestSec);
        setFeedGroups(grouped);
      } catch (e: any) {
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando movimientos/inactividad"));
      } finally {
        setLoadingWidgets(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user || role !== "admin") {
        setArchiveRequests([]);
        return;
      }

      setLoadingArchiveRequests(true);

      try {
        const qArchiveRequested = query(
          collection(db, "cases"),
          where("status", "==", "archsolicited"),
          orderBy("archiveRequestedAt", "desc"),
          limit(100)
        );

        const snap = await getDocs(qArchiveRequested);

        const items = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            caseId: d.id,
            caratula: String(data?.caratulaTentativa ?? d.id),
            requestedAtSec: Number(data?.archiveRequestedAt?.seconds ?? 0) || undefined,
            requestedByEmail: String(data?.archiveRequestedByEmail ?? "").trim() || undefined,
          } as ArchiveRequestItem;
        });

        setArchiveRequests(items);
      } catch (e: any) {
        setArchiveRequests([]);
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando solicitudes de archivo"));
      } finally {
        setLoadingArchiveRequests(false);
      }
    })();
  }, [user, role]);

  useEffect(() => {
    (async () => {
      if (!user) {
        setPendingTransfers([]);
        return;
      }

      setLoadingTransfers(true);

      try {
        const qTransfers = query(
          collection(db, "charges"),
          where("visibleToUids", "array-contains", user.uid),
          where("status", "==", "paid"),
          where("transferTicket.status", "==", "pending"),
          limit(50)
        );

        const snap = await getDocs(qTransfers);
        const items = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const myNetAmount = getChargeUserNetAmount(data, user.uid);
            const ownerUid = String(data?.ownerUid ?? "");
            const isOwner = ownerUid === user.uid;

            return {
              chargeId: d.id,
              payerName: String(data?.payerRef?.displayName ?? "").trim() || "(sin pagador)",
              caseLabel: data?.caseRef?.isExtraCase
                ? String(data?.caseRef?.extraCaseReason ?? "").trim() || "Cobro extra-caso"
                : String(data?.caseRef?.caratula ?? "").trim() || "(sin carátula)",
              paidAtSec: Number(data?.paidAt?.seconds ?? 0) || undefined,
              myNetAmount,
              currency: String(data?.currency ?? "").trim() || undefined,
              ownerUid,
              isOwner,
            } as TransferPendingItem;
          })
          .filter((x) => x.isOwner || Number(x.myNetAmount ?? 0) > 0);

        items.sort((a, b) => (b.paidAtSec ?? 0) - (a.paidAtSec ?? 0));
        setPendingTransfers(items);
      } catch (e: any) {
        setPendingTransfers([]);
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando transferencias pendientes"));
      } finally {
        setLoadingTransfers(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user) {
        setOverdueCharges([]);
        return;
      }

      setLoadingOverdueCharges(true);

      try {
        const qScheduled = query(
          collection(db, "charges"),
          where("visibleToUids", "array-contains", user.uid),
          where("status", "==", "scheduled"),
          orderBy("scheduledDate", "asc"),
          limit(200)
        );

        const snap = await getDocs(qScheduled);
        const nowMs = Date.now();

        const items = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const scheduledDate = data?.scheduledDate?.toDate
              ? data.scheduledDate.toDate()
              : data?.scheduledDate
              ? new Date(data.scheduledDate)
              : null;

            const remainingAmount = getScheduledRemainingAmount(data);

            return {
              chargeId: d.id,
              payerName: String(data?.payerRef?.displayName ?? "").trim() || "(sin pagador)",
              caseLabel: data?.caseRef?.isExtraCase
                ? String(data?.caseRef?.extraCaseReason ?? "").trim() || "Cobro extra-caso"
                : String(data?.caseRef?.caratula ?? "").trim() || "(sin carátula)",
              scheduledAtSec:
                scheduledDate && !Number.isNaN(scheduledDate.getTime())
                  ? Math.floor(scheduledDate.getTime() / 1000)
                  : undefined,
              remainingAmount,
              currency: String(data?.currency ?? "").trim() || undefined,
            } as OverdueChargeItem;
          })
          .filter((x) => {
            if (!x.scheduledAtSec) return false;
            return x.scheduledAtSec * 1000 < nowMs && Number(x.remainingAmount ?? 0) > 0;
          });

        items.sort((a, b) => (a.scheduledAtSec ?? 0) - (b.scheduledAtSec ?? 0));
        setOverdueCharges(items);
      } catch (e: any) {
        setOverdueCharges([]);
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando alerta de morosidad"));
      } finally {
        setLoadingOverdueCharges(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user) {
        setSentInvites([]);
        return;
      }

      setLoadingSentInvites(true);

      try {
        const qMyCases = query(
          collection(db, "cases"),
          where("broughtByUid", "==", user.uid),
          limit(100)
        );
        const casesSnap = await getDocs(qMyCases);

        const nowMs = Date.now();
        const acceptedVisibleMs = 5 * 24 * 60 * 60 * 1000;
        const rejectedVisibleMs = 3 * 24 * 60 * 60 * 1000;

        const caseRows = casesSnap.docs.map((caseDoc) => {
          const caseId = caseDoc.id;
          const caseData = caseDoc.data() as any;
          return {
            caseId,
            caratula: String(caseData?.caratulaTentativa ?? caseId),
          };
        });

        const inviteSnaps = await Promise.all(
          caseRows.map((c) => getDocs(collection(db, "cases", c.caseId, "invites")))
        );

        const items: SentInviteItem[] = [];

        inviteSnaps.forEach((invitesSnap, index) => {
          const { caseId, caratula } = caseRows[index];

          invitesSnap.docs.forEach((d) => {
            const data = d.data() as any;

            const invitedAtSec = toSecondsMaybe(data?.invitedAt);
            const respondedAtSec = toSecondsMaybe(data?.respondedAt);
            const status = String(data?.status ?? "pending") as SentInviteStatus;
            const mode = String(data?.mode ?? "auto") as SentInviteMode;

            if (status !== "pending" && status !== "accepted" && status !== "rejected") return;

            if (status === "accepted" && respondedAtSec) {
              const ageMs = nowMs - respondedAtSec * 1000;
              if (ageMs > acceptedVisibleMs) return;
            }

            if (status === "rejected" && respondedAtSec) {
              const ageMs = nowMs - respondedAtSec * 1000;
              if (ageMs > rejectedVisibleMs) return;
            }

            items.push({
              inviteId: d.id,
              caseId,
              caratula,
              invitedEmail: String(data?.invitedEmail ?? "").trim() || "",
              status,
              mode,
              directJustification: String(data?.directJustification ?? "").trim() || "",
              invitedAtSec,
              respondedAtSec,
              sortSec: respondedAtSec || invitedAtSec || 0,
            });
          });
        });

        items.sort((a, b) => b.sortSec - a.sortSec);
        setSentInvites(items.slice(0, 20));
      } catch (e: any) {
        setSentInvites([]);
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando estado de invitaciones enviadas"));
      } finally {
        setLoadingSentInvites(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user) {
        setUpcomingEvents([]);
        return;
      }

      setLoadingUpcomingEvents(true);

      try {
        const rows = await listUpcomingEventsForUser({
          uid: user.uid,
          maxResults: 50,
        });

        const now = Date.now();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

        const filtered = rows.filter((item) => {
          const d = item.startAt?.toDate ? item.startAt.toDate() : new Date(item.startAt);
          if (Number.isNaN(d.getTime())) return false;
          return d.getTime() >= now && d.getTime() <= now + threeDaysMs;
        });

        setUpcomingEvents(filtered);
      } catch (e: any) {
        setUpcomingEvents([]);
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando próximos eventos"));
      } finally {
        setLoadingUpcomingEvents(false);
      }
    })();
  }, [user]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  const isAdmin = role === "admin";

  return (
    <AppShell
      title="Inicio"
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

      {loading ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Últimos movimientos (20)
            </div>
            {loadingWidgets ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
            ) : null}
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {feedGroups.length === 0 ? (
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Sin movimientos.</div>
            ) : (
              feedGroups.map((group) => (
                <a
                  key={group.caseId}
                  href={`/cases/manage/${group.caseId}`}
                  className="block py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {group.caratula || group.caseId}
                  </div>

                  <div className="mt-1 grid gap-1">
                    {group.items.slice(0, 3).map((item, idx) => (
                      <div key={`${group.caseId}-${idx}`} className="text-xs text-gray-600 dark:text-gray-300">
                        {item.title} · {fmtDateTime(item.createdAtSec)}
                        {item.createdByEmail ? ` · ${item.createdByEmail}` : ""}
                      </div>
                    ))}

                    {group.items.length > 3 ? (
                      <div className="text-xs font-bold text-gray-500 dark:text-gray-400">
                        +{group.items.length - 3} movimiento(s) más
                      </div>
                    ) : null}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Alerta de inactividad (+60 días)
            </div>
            {loadingWidgets ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
            ) : null}
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {inactive.length === 0 ? (
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Sin alertas 🎉</div>
            ) : (
              inactive.map((c, idx) => (
                <a
                  key={idx}
                  href={`/cases/manage/${c.caseId}`}
                  className="block py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {c.caratula || c.caseId}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Último movimiento:{" "}
                    {c.lastLogAtSec
                      ? new Date(c.lastLogAtSec * 1000).toLocaleDateString("es-AR")
                      : "nunca"}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Estado de invitaciones enviadas
          </div>
          {loadingSentInvites ? (
            <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
          ) : (
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              {sentInvites.length} visible(s)
            </div>
          )}
        </div>

        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Se muestran las últimas invitaciones enviadas en causas creadas por vos.
        </div>

        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {!loadingSentInvites && sentInvites.length === 0 ? (
            <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
              No hay invitaciones enviadas para mostrar.
            </div>
          ) : (
            sentInvites.map((item) => (
              <a
                key={`${item.caseId}-${item.inviteId}`}
                href={`/cases/${item.caseId}`}
                className="block py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {item.caratula || item.caseId}
                  </div>

                  {item.mode === "direct" ? (
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-black text-orange-800 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-200">
                      DIRECTA
                    </span>
                  ) : (
                    <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                      AUTOMÁTICA
                    </span>
                  )}

                  {item.status === "pending" ? (
                    <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-black text-orange-800 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-200">
                      PENDIENTE
                    </span>
                  ) : item.status === "accepted" ? (
                    <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-black text-green-800 dark:border-green-700 dark:bg-green-900/30 dark:text-green-200">
                      ACEPTADA
                    </span>
                  ) : (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-black text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
                      RECHAZADA
                    </span>
                  )}
                </div>

                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  {item.invitedEmail ? item.invitedEmail : "(sin email)"} · Invitada:{" "}
                  {fmtDateTime(item.invitedAtSec)}
                  {item.status !== "pending" && item.respondedAtSec
                    ? ` · Respondida: ${fmtDateTime(item.respondedAtSec)}`
                    : ""}
                </div>

                {item.mode === "direct" && item.directJustification ? (
                  <div className="mt-2 text-xs text-gray-700 dark:text-gray-300">
                    <span className="font-black">Justificación:</span> {item.directJustification}
                  </div>
                ) : null}
              </a>
            ))
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Transferencias pendientes
          </div>
          {loadingTransfers ? (
            <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
          ) : (
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              {pendingTransfers.length} pendiente(s)
            </div>
          )}
        </div>

        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {!loadingTransfers && pendingTransfers.length === 0 ? (
            <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
              No tenés transferencias pendientes.
            </div>
          ) : (
            pendingTransfers.map((item) => (
              <a
                key={item.chargeId}
                href={`/cobranzas/registrar?ticket=${item.chargeId}`}
                className="block py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
              >
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  {item.caseLabel}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {item.payerName} · {item.paidAtSec ? fmtDateTime(item.paidAtSec) : "-"}
                </div>
                <div className="mt-1 text-xs font-bold text-gray-700 dark:text-gray-200">
                  {item.isOwner ? "Debés realizar transferencias" : "Pendiente de recibir"} · Mi neto:{" "}
                  {fmtMoney(item.myNetAmount, item.currency)}
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-900 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Alerta morosidad
          </div>
          {loadingOverdueCharges ? (
            <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
          ) : (
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              {overdueCharges.length} vencido(s)
            </div>
          )}
        </div>

        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Cobros agendados vencidos cuyo pago todavía no fue registrado.
        </div>

        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {!loadingOverdueCharges && overdueCharges.length === 0 ? (
            <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
              No hay alertas de morosidad.
            </div>
          ) : (
            overdueCharges.map((item) => (
              <a
                key={item.chargeId}
                href={`/cobranzas/registrar?scheduledId=${item.chargeId}`}
                className="block py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
              >
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  {item.caseLabel}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-300">
                  {item.payerName} · Vencía: {item.scheduledAtSec ? fmtDateTime(item.scheduledAtSec) : "-"}
                </div>
                <div className="mt-1 text-xs font-bold text-red-700 dark:text-red-300">
                  Saldo pendiente: {fmtMoney(item.remainingAmount, item.currency)}
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Próximos eventos
          </div>
          {loadingUpcomingEvents ? (
            <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
          ) : (
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              próximos 3 días · {upcomingEvents.length} visible(s)
            </div>
          )}
        </div>

        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
          {!loadingUpcomingEvents && upcomingEvents.length === 0 ? (
            <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
              No tenés eventos próximos para los próximos 3 días.
            </div>
          ) : (
            upcomingEvents.map((item) => (
              <a
                key={item.id}
                href="/calendar"
                className="block py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="mt-1 h-4 w-4 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: item.color || "#3b82f6" }}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                      {item.title}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-300">
                      {fmtTsDateTime(item.startAt)}
                      {item.caseRef?.caratula ? ` · ${item.caseRef.caratula}` : ""}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {item.source === "manual" ? "Manual" : "Automático"} ·{" "}
                      {item.visibility === "global"
                        ? "Global"
                        : item.visibility === "private"
                        ? "Privado"
                        : item.visibility === "selected_users"
                        ? "Usuarios seleccionados"
                        : "Compartido con causa"}
                    </div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      </div>

      {isAdmin ? (
        <>
          <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                  Administración
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                  Accedé a las secciones administrativas desde la barra lateral.
                </div>
              </div>

              <button
                onClick={exportExcel}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold shadow-sm hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                Exportar Excel de causas
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Solicitudes de archivo
              </div>
              {loadingArchiveRequests ? (
                <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
              ) : (
                <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  {archiveRequests.length} pendiente(s)
                </div>
              )}
            </div>

            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
              {!loadingArchiveRequests && archiveRequests.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                  No hay causas con solicitud de archivo.
                </div>
              ) : (
                archiveRequests.map((item, idx) => (
                  <a
                    key={idx}
                    href={`/cases/manage/${item.caseId}`}
                    className="block py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {item.caratula || item.caseId}
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                        ARCHIVO SOLICITADO
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {item.requestedAtSec
                        ? `Solicitado: ${fmtDateTime(item.requestedAtSec)}`
                        : "Solicitud registrada"}
                      {item.requestedByEmail ? ` · ${item.requestedByEmail}` : ""}
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}