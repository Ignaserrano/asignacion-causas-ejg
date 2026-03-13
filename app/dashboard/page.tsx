"use client";

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
import { getChargeUserNetAmount, getScheduledRemainingAmount } from "@/lib/charges";
import { listUpcomingEventsForUser, type CalendarEventRow } from "@/lib/events";
import ScrollToTopButton from "@/components/ScrollToTopButton";

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

type CaseWorkflowStatus = "drafting" | "ready";
type ProceduralStatus =
  | "preliminar"
  | "iniciada"
  | "en_prueba"
  | "a_sentencia"
  | "en_apelacion"
  | "en_ejecucion";

type InitialDraftWorkflow = {
  status?: CaseWorkflowStatus;
  responsibleUid?: string;
  responsibleEmail?: string;
  dueDate?: string;
  startedAt?: { seconds: number };
  startedByUid?: string;
  startedByEmail?: string;
  firstDraftCompletedAt?: { seconds: number };
  firstDraftCompletedByUid?: string;
  firstDraftCompletedByEmail?: string;
  reviewedAt?: { seconds: number };
  reviewedByUid?: string;
  reviewedByEmail?: string;
};

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
  managementStatus?: ProceduralStatus;
  initialDraftWorkflow?: InitialDraftWorkflow;
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

type UserOption = {
  uid: string;
  email: string;
};

function fmtDateTime(sec?: number) {
  if (!sec) return "-";
  return new Date(sec * 1000).toLocaleString("es-AR");
}

function fmtTsDateTime(value?: any) {
  if (!value) return "-";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-AR", { hour12: false });
}

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString("es-AR")} ${currency ?? ""}`.trim();
}

function toSecondsMaybe(ts: any): number {
  const s = ts?.seconds;
  return typeof s === "number" ? s : 0;
}

function safeText(v: any) {
  return String(v ?? "").trim();
}

function safeLower(v: any) {
  return safeText(v).toLowerCase();
}

function sourceLabel(row: CalendarEventRow) {
  if (row.source === "manual") return "Manual";
  if (row.source === "case_log") return "Bitácora";
  if (row.source === "charge") return "Cobros";
  return "Automático";
}

function getVisibleToUids(row: CalendarEventRow) {
  return Array.isArray((row as any).visibleToUids)
    ? ((row as any).visibleToUids as string[])
    : [];
}

function isRescheduledEvent(row: CalendarEventRow) {
  return Boolean((row as any).rescheduled);
}

function visibilityLabel(
  row: CalendarEventRow,
  users: UserOption[],
  currentUser?: User | null
) {
  if (row.visibility === "case_shared") return "Abogados de la causa";
  if (row.visibility === "global") return "Todos";
  if (row.visibility === "private") return "Solo para mí";

  const visibleToUids = getVisibleToUids(row);
  const emails = users
    .filter((u) => visibleToUids.includes(u.uid))
    .map((u) => u.email)
    .filter(Boolean);

  const withoutCurrentUser = emails.filter(
    (email) => email !== safeText(currentUser?.email)
  );
  const unique = Array.from(
    new Set(withoutCurrentUser.length > 0 ? withoutCurrentUser : emails)
  );

  return unique.length > 0 ? unique.join(", ") : "Usuarios seleccionados";
}

function fmtDateOnly(value?: string) {
  if (!value) return "-";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-AR");
}

function getCaseManagementStatus(c: CaseRow): ProceduralStatus {
  return (c.managementStatus ?? "preliminar") as ProceduralStatus;
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="text-base font-black text-gray-900 dark:text-gray-100">
            {title}
          </div>
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

  const [myCases, setMyCases] = useState<CaseRow[]>([]);
  const [quickSearch, setQuickSearch] = useState("");
  const [quickSearchFocused, setQuickSearchFocused] = useState(false);
  const [quickSearchSelectedIndex, setQuickSearchSelectedIndex] = useState(0);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRow | null>(null);

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
      if (!user) {
        setUsers([]);
        return;
      }

      try {
        const qUsers = query(collection(db, "users"), orderBy("email", "asc"));
        const usersSnap = await getDocs(qUsers);

        const rows = usersSnap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              email: safeText(data?.email),
            };
          })
          .filter((x) => Boolean(x.email));

        setUsers(rows);
      } catch {
        setUsers([]);
      }
    })();
  }, [user]);

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
        const loadedCases = casesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as CaseRow[];

        setMyCases(loadedCases);

        const myCaseIds = new Set(loadedCases.map((c) => c.id));
        const caseMap = new Map(
          loadedCases.map((c) => [c.id, String(c.caratulaTentativa ?? c.id)])
        );

        const now = Date.now();
        const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

        const inactiveTmp: InactiveItem[] = [];
        for (const c of loadedCases) {
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

        const grouped = Array.from(groupedMap.values()).sort(
          (a, b) => b.latestSec - a.latestSec
        );
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
        setMsg(
          (prev) => prev ?? (e?.message ?? "Error cargando estado de invitaciones enviadas")
        );
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

  useEffect(() => {
    setQuickSearchSelectedIndex(0);
  }, [quickSearch]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  const isAdmin = role === "admin";

  const quickSearchResults = useMemo(() => {
    const term = safeLower(quickSearch);
    if (!term) return [];

    return [...myCases]
      .filter((c) => {
        const caratula = safeLower(c.caratulaTentativa);
        return Boolean(caratula) && caratula.includes(term);
      })
      .sort((a, b) =>
        safeText(a.caratulaTentativa).localeCompare(
          safeText(b.caratulaTentativa),
          "es"
        )
      )
      .slice(0, 8);
  }, [myCases, quickSearch]);

  const draftingCases = useMemo(() => {
    return myCases
      .filter((c) => {
        const wf = c.initialDraftWorkflow;
        const managementStatus = getCaseManagementStatus(c);

        return (
          c.status !== "archived" &&
          c.status !== "archsolicited" &&
          managementStatus === "preliminar" &&
          wf?.status === "drafting"
        );
      })
      .sort((a, b) => {
        const aa = a.initialDraftWorkflow?.dueDate ?? "9999-12-31";
        const bb = b.initialDraftWorkflow?.dueDate ?? "9999-12-31";
        return aa.localeCompare(bb);
      });
  }, [myCases]);

  const readyToFileCases = useMemo(() => {
    return myCases
      .filter((c) => {
        const wf = c.initialDraftWorkflow;
        const managementStatus = getCaseManagementStatus(c);

        return (
          c.status !== "archived" &&
          c.status !== "archsolicited" &&
          managementStatus !== "iniciada" &&
          wf?.status === "ready"
        );
      })
      .sort((a, b) => {
        const aa = a.initialDraftWorkflow?.reviewedAt?.seconds ?? 0;
        const bb = b.initialDraftWorkflow?.reviewedAt?.seconds ?? 0;
        return bb - aa;
      });
  }, [myCases]);

  function openCaseFromQuickSearch(caseId: string) {
    setQuickSearch("");
    setQuickSearchFocused(false);
    setQuickSearchSelectedIndex(0);
    router.push(`/cases/manage/${caseId}`);
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

      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
          Buscador rápido de causas
        </div>

        <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Buscá por carátula dentro de las causas en las que intervenís y entrá directo
          a gestión.
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

      {draftingCases.length > 0 || readyToFileCases.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {draftingCases.length > 0 ? (
            <div className="rounded-xl border border-red-200 bg-white p-4 shadow-sm dark:border-red-900 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-red-700 dark:text-red-300">
                  Causas con presentación inicial en redacción
                </div>
                <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  {draftingCases.length} visible(s)
                </div>
              </div>

              <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Se muestran tus causas preliminares con presentación inicial actualmente
                en redacción.
              </div>

              <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {draftingCases.map((item) => (
                  <a
                    key={item.id}
                    href={`/cases/manage/${item.id}`}
                    className="block py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                      {item.caratulaTentativa || item.id}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      Responsable:{" "}
                      {safeText(item.initialDraftWorkflow?.responsibleEmail) || "-"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-red-700 dark:text-red-300">
                      Fecha límite: {fmtDateOnly(item.initialDraftWorkflow?.dueDate)}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {readyToFileCases.length > 0 ? (
            <div className="rounded-xl border border-green-200 bg-white p-4 shadow-sm dark:border-green-900 dark:bg-gray-900">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-black text-green-700 dark:text-green-300">
                  Causas con presentación inicial redactada - listas para presentar
                </div>
                <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  {readyToFileCases.length} visible(s)
                </div>
              </div>

              <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
                Desaparecen automáticamente de este panel cuando la causa pasa a estado
                iniciada.
              </div>

              <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
                {readyToFileCases.map((item) => (
                  <a
                    key={item.id}
                    href={`/cases/manage/${item.id}`}
                    className="block py-3 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                      {item.caratulaTentativa || item.id}
                    </div>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      Redacción:{" "}
                      {safeText(item.initialDraftWorkflow?.responsibleEmail) || "-"}
                    </div>
                    <div className="mt-1 text-xs font-bold text-green-700 dark:text-green-300">
                      Revisada:{" "}
                      {item.initialDraftWorkflow?.reviewedAt?.seconds
                        ? fmtDateTime(item.initialDraftWorkflow?.reviewedAt?.seconds)
                        : "-"}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {pendingInvites > 0 ? (
        <a
          href="/invites"
          className="mb-4 mt-4 block rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm transition hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:hover:bg-orange-900/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-orange-900 dark:text-orange-100">
                Invitaciones pendientes de respuesta
              </div>
              <div className="mt-1 text-xs text-orange-800 dark:text-orange-200">
                Tenés {pendingInvites} invitación{pendingInvites === 1 ? "" : "es"} recibida
                {pendingInvites === 1 ? "" : "s"} pendiente
                {pendingInvites === 1 ? "" : "s"}.
              </div>
            </div>

            <div className="shrink-0 rounded-full border border-orange-300 bg-white px-3 py-1 text-sm font-black text-orange-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-100">
              {pendingInvites}
            </div>
          </div>
        </a>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                Sin movimientos.
              </div>
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
                      <div
                        key={`${group.caseId}-${idx}`}
                        className="text-xs text-gray-600 dark:text-gray-300"
                      >
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
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                Sin alertas 🎉
              </div>
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
                    <span className="font-black">Justificación:</span>{" "}
                    {item.directJustification}
                  </div>
                ) : null}
              </a>
            ))
          )}
        </div>
      </div>

      {pendingTransfers.length > 0 ? (
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
            {pendingTransfers.map((item) => (
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
                  {item.isOwner ? "Debés realizar transferencias" : "Pendiente de recibir"} ·
                  {" "}Mi neto: {fmtMoney(item.myNetAmount, item.currency)}
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : null}

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
                  {item.payerName} · Vencía:{" "}
                  {item.scheduledAtSec ? fmtDateTime(item.scheduledAtSec) : "-"}
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
            upcomingEvents.map((item) => {
              const rescheduled = isRescheduledEvent(item);
              const dotColor = rescheduled ? "#9ca3af" : item.color || "#3b82f6";

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedEvent(item)}
                  className="block w-full py-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="mt-1 h-4 w-4 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: dotColor }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                          {item.title}
                        </div>

                        {rescheduled ? (
                          <span className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                            Reprogramado
                          </span>
                        ) : null}
                      </div>

                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        {fmtTsDateTime(item.startAt)}
                        {item.caseRef?.caratula ? ` · ${item.caseRef.caratula}` : ""}
                      </div>

                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                        {visibilityLabel(item, users, user)} · {sourceLabel(item)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
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

      <Modal
        open={!!selectedEvent}
        title={selectedEvent?.title || "Detalle del evento"}
        onClose={() => setSelectedEvent(null)}
      >
        {selectedEvent ? (
          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Inicio
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtTsDateTime(selectedEvent.startAt)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Fin
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {selectedEvent.endAt ? fmtTsDateTime(selectedEvent.endAt) : "-"}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Visible para
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {visibilityLabel(selectedEvent, users, user)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Origen
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {sourceLabel(selectedEvent)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800 md:col-span-2">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Todo el día
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {selectedEvent.allDay ? "Sí" : "No"}
                </div>
              </div>
            </div>

            {isRescheduledEvent(selectedEvent) ? (
              <div className="rounded-xl border border-gray-300 bg-gray-100 p-3 text-sm font-bold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                Este evento fue reprogramado.
              </div>
            ) : null}

            {safeText(selectedEvent.caseRef?.caratula) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Causa
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {selectedEvent.caseRef?.caratula}
                </div>
              </div>
            ) : null}

            {safeText(selectedEvent.description) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Descripción
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                  {selectedEvent.description}
                </div>
              </div>
            ) : null}

            {safeText((selectedEvent as any).location) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Ubicación
                </div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {(selectedEvent as any).location}
                </div>
              </div>
            ) : null}

            {safeText((selectedEvent as any).meetingUrl) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Enlace
                </div>
                <div className="mt-1">
                  <a
                    href={(selectedEvent as any).meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm font-extrabold underline text-gray-700 dark:text-gray-200"
                  >
                    {(selectedEvent as any).meetingUrl}
                  </a>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Creado por
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {safeText((selectedEvent as any).createdByEmail) ||
                  safeText(selectedEvent.ownerEmail) ||
                  safeText(selectedEvent.ownerUid) ||
                  "-"}
              </div>
            </div>

            {selectedEvent.caseRef?.caseId ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const caseId = String(selectedEvent.caseRef?.caseId ?? "");
                    setSelectedEvent(null);
                    if (caseId) router.push(`/cases/manage/${caseId}`);
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Abrir causa vinculada
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ScrollToTopButton />
    </AppShell>
  );
}