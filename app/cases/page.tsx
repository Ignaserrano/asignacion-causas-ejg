"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  DocumentSnapshot,
  Query,
  collectionGroup,
  writeBatch,
  deleteDoc,
} from "firebase/firestore";

import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

type CaseStatus = "draft" | "assigned" | "archived";

type FirestoreDateLike = {
  seconds?: number;
};

type CaseRow = {
  id: string;
  caratulaTentativa: string;
  specialtyId: string;
  jurisdiccion: string;
  status: CaseStatus;
  createdAtSec: number;
  broughtByUid: string;
  archivedAt?: FirestoreDateLike;
};

const PAGE_SIZE = 25;

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "archived";
}) {
  const cls =
    tone === "ok"
      ? "bg-green-100 border-green-300 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-100"
      : tone === "archived"
      ? "bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100"
      : "bg-gray-100 border-gray-300 text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-black ${cls}`}
    >
      {children}
    </span>
  );
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

async function getAllDocs<T = DocumentData>(qBase: Query<T>) {
  const all: QueryDocumentSnapshot<T>[] = [];
  let cursor: QueryDocumentSnapshot<T> | null = null;

  while (true) {
    const qPage = cursor
      ? query(qBase, startAfter(cursor), limit(500))
      : query(qBase, limit(500));

    const snap = await getDocs(qPage);
    all.push(...snap.docs);

    if (snap.size < 500) break;
    cursor = snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot<T>;
  }

  return all;
}

export default function CasesAllPage() {
  const router = useRouter();

  // shell
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // page state
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // filtros
  const [filterStatus, setFilterStatus] = useState<"all" | CaseStatus>("all");
  const [filterJur, setFilterJur] = useState<string>("all");
  const [filterSpecialtyId, setFilterSpecialtyId] = useState<string>("all");
  const [filterCreatorEmail, setFilterCreatorEmail] = useState<string>("");
  const [showArchived, setShowArchived] = useState(false);

  // búsqueda por carátula (ahora global)
  const [searchCaratula, setSearchCaratula] = useState<string>("");

  // orden
  const [orderField, setOrderField] = useState<"createdAt" | "caratulaTentativa">("createdAt");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("desc");

  // paginación
  const [page, setPage] = useState(1);
  const [pageRows, setPageRows] = useState<CaseRow[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [prevStack, setPrevStack] = useState<DocumentSnapshot[]>([]);

  // global search mode
  const [globalRows, setGlobalRows] = useState<CaseRow[]>([]);

  // total
  const [total, setTotal] = useState<number>(0);

  // lookups
  const [specialtyNameById, setSpecialtyNameById] = useState<Record<string, string>>({});
  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});

  // quienes aceptaron por causa
  const [acceptedByCaseId, setAcceptedByCaseId] = useState<Record<string, string[]>>({});

  // opciones para combos
  const [specialtiesOptions, setSpecialtiesOptions] = useState<Array<{ id: string; name: string }>>(
    []
  );

  // uid del creador filtrado (resuelto por email exacto)
  const [creatorUidFilter, setCreatorUidFilter] = useState<string | null>(null);

  // modal eliminar
  const [deleteCaseId, setDeleteCaseId] = useState<string | null>(null);
  const [deleteCaseTitle, setDeleteCaseTitle] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  const globalSearchActive = Boolean(safeLower(searchCaratula));

  function mapCaseDoc(d: QueryDocumentSnapshot<DocumentData, DocumentData> | DocumentSnapshot) {
    const data = d.data() as any;
    return {
      id: d.id,
      caratulaTentativa: String(data?.caratulaTentativa ?? ""),
      specialtyId: String(data?.specialtyId ?? ""),
      jurisdiccion: String(data?.jurisdiccion ?? ""),
      status: (data?.status ?? "draft") as CaseStatus,
      createdAtSec: Number(data?.createdAt?.seconds ?? 0),
      broughtByUid: String(data?.broughtByUid ?? ""),
      archivedAt: data?.archivedAt?.seconds ? { seconds: data.archivedAt.seconds } : undefined,
    } as CaseRow;
  }

  function buildCasesQuery(base?: Query, cursor?: DocumentSnapshot | null) {
    let qAny: any = base ?? collection(db, "cases");

    if (!showArchived) {
      qAny = query(qAny, where("status", "!=", "archived"));
    }

    if (filterStatus !== "all") qAny = query(qAny, where("status", "==", filterStatus));
    if (filterJur !== "all") qAny = query(qAny, where("jurisdiccion", "==", filterJur));
    if (filterSpecialtyId !== "all")
      qAny = query(qAny, where("specialtyId", "==", filterSpecialtyId));
    if (creatorUidFilter) qAny = query(qAny, where("broughtByUid", "==", creatorUidFilter));

    qAny = query(qAny, orderBy(orderField, orderDir));

    if (cursor) qAny = query(qAny, startAfter(cursor));
    qAny = query(qAny, limit(PAGE_SIZE));

    return qAny as Query;
  }

  function buildCasesQueryNoLimit(base?: Query) {
    let qAny: any = base ?? collection(db, "cases");

    if (!showArchived) {
      qAny = query(qAny, where("status", "!=", "archived"));
    }

    if (filterStatus !== "all") qAny = query(qAny, where("status", "==", filterStatus));
    if (filterJur !== "all") qAny = query(qAny, where("jurisdiccion", "==", filterJur));
    if (filterSpecialtyId !== "all")
      qAny = query(qAny, where("specialtyId", "==", filterSpecialtyId));
    if (creatorUidFilter) qAny = query(qAny, where("broughtByUid", "==", creatorUidFilter));

    qAny = query(qAny, orderBy(orderField, orderDir));

    return qAny as Query;
  }

  async function resolveCreatorUidByEmailExact(email: string): Promise<string | null> {
    const e = safeLower(email);
    if (!e) return null;
    const qUsers = query(collection(db, "users"), where("email", "==", e), limit(1));
    const snap = await getDocs(qUsers);
    if (snap.empty) return "__none__";
    return snap.docs[0].id;
  }

  async function uidToEmail(uid: string): Promise<string> {
    if (!uid) return "";
    const cached = emailByUid[uid];
    if (cached !== undefined) return cached || "";

    try {
      const uSnap = await getDoc(doc(db, "users", uid));
      const email = uSnap.exists() ? String((uSnap.data() as any)?.email ?? "") : "";
      setEmailByUid((m) => ({ ...m, [uid]: email || "" }));
      return email || "";
    } catch {
      setEmailByUid((m) => ({ ...m, [uid]: "" }));
      return "";
    }
  }

  async function ensureLookupsForRows(rows: CaseRow[]) {
    const uids = Array.from(new Set(rows.map((r) => r.broughtByUid).filter(Boolean)));
    const missingUids = uids.filter((u) => emailByUid[u] === undefined);

    if (missingUids.length) {
      const newMap = { ...emailByUid };
      await Promise.all(
        missingUids.map(async (uid) => {
          try {
            const uSnap = await getDoc(doc(db, "users", uid));
            const email = uSnap.exists() ? String((uSnap.data() as any)?.email ?? "") : "";
            newMap[uid] = email || "";
          } catch {
            newMap[uid] = "";
          }
        })
      );
      setEmailByUid(newMap);
    }

    const spIds = Array.from(new Set(rows.map((r) => r.specialtyId).filter(Boolean)));
    const missingSp = spIds.filter((id) => !specialtyNameById[id]);

    if (missingSp.length) {
      const spMap = { ...specialtyNameById };
      await Promise.all(
        missingSp.map(async (id) => {
          try {
            const spSnap = await getDoc(doc(db, "specialties", id));
            spMap[id] = spSnap.exists()
              ? String((spSnap.data() as any)?.name ?? "(sin nombre)")
              : "(no encontrada)";
          } catch {
            spMap[id] = "(error)";
          }
        })
      );
      setSpecialtyNameById(spMap);
    }
  }

  async function loadAcceptedForCases(caseIds: string[]) {
    if (!caseIds.length) return;

    const entries: Array<[string, string[]]> = await Promise.all(
      caseIds.map(async (caseId): Promise<[string, string[]]> => {
        try {
          const qInv = query(
            collection(db, "cases", caseId, "invites"),
            where("status", "==", "accepted")
          );
          const snap = await getDocs(qInv);

          const emails = await Promise.all(
            snap.docs.map(async (d) => {
              const data = d.data() as any;
              const byEmail = safeLower(data?.invitedEmail);
              if (byEmail) return byEmail;

              const uid = String(data?.invitedUid ?? "");
              const e = safeLower(await uidToEmail(uid));
              return e;
            })
          );

          const cleaned = Array.from(new Set(emails.filter(Boolean))).sort();
          return [caseId, cleaned];
        } catch {
          return [caseId, []];
        }
      })
    );

    setAcceptedByCaseId((prev) => {
      const next: Record<string, string[]> = { ...prev };
      for (const [caseId, list] of entries) next[caseId] = list;
      return next;
    });
  }

  async function loadNormalPage(resetToFirst: boolean) {
    setLoading(true);
    setMsg(null);

    try {
      const qCases = buildCasesQuery(undefined, resetToFirst ? null : lastDoc);
      const snap = await getDocs(qCases);

      const rows: CaseRow[] = snap.docs.map((d) => mapCaseDoc(d));

      setPageRows(rows);
      setGlobalRows([]);
      setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setTotal(0);

      await ensureLookupsForRows(rows);
      await loadAcceptedForCases(rows.map((r) => r.id));
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando causas");
    } finally {
      setLoading(false);
    }
  }

  async function loadGlobalSearchResults() {
    setLoading(true);
    setMsg(null);

    try {
      const qCases = buildCasesQueryNoLimit();
      const docs = await getAllDocs(qCases);
      const allRows = docs.map((d) => mapCaseDoc(d));

      const s = safeLower(searchCaratula);
      const filtered = allRows.filter((r) => safeLower(r.caratulaTentativa).includes(s));

      setGlobalRows(filtered);
      setPageRows([]);
      setPrevStack([]);
      setLastDoc(null);
      setTotal(filtered.length);

      const firstPageRows = filtered.slice(0, PAGE_SIZE);
      await ensureLookupsForRows(firstPageRows);
      await loadAcceptedForCases(firstPageRows.map((r) => r.id));
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando búsqueda global");
    } finally {
      setLoading(false);
    }
  }

  async function deleteCaseFully(caseId: string) {
    if (role !== "admin") throw new Error("No autorizado");

    for (let i = 0; i < 50; i++) {
      const snap = await getDocs(query(collection(db, "cases", caseId, "invites"), limit(450)));
      if (snap.empty) break;

      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }

    await deleteDoc(doc(db, "cases", caseId));
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);

      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      try {
        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const snap = await getDocs(qPending);
        setPendingInvites(snap.size);
      } catch {
        setPendingInvites(0);
      }

      try {
        const spSnap = await getDocs(query(collection(db, "specialties"), orderBy("name", "asc")));
        setSpecialtiesOptions(
          spSnap.docs.map((d) => ({
            id: d.id,
            name: String((d.data() as any)?.name ?? d.id),
          }))
        );
      } catch {
        // ok
      }

      setPage(1);
      setPrevStack([]);
      setLastDoc(null);

      if (safeLower(searchCaratula)) {
        await loadGlobalSearchResults();
      } else {
        await loadNormalPage(true);
      }
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    (async () => {
      const email = safeLower(filterCreatorEmail);
      if (!email) {
        setCreatorUidFilter(null);
      } else {
        try {
          const uid = await resolveCreatorUidByEmailExact(email);
          setCreatorUidFilter(uid);
        } catch {
          setCreatorUidFilter("__none__");
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCreatorEmail]);

  useEffect(() => {
    if (!showArchived && filterStatus === "archived") {
      setFilterStatus("all");
    }
  }, [showArchived, filterStatus]);

  useEffect(() => {
    (async () => {
      setPage(1);
      setPrevStack([]);
      setLastDoc(null);

      if (safeLower(searchCaratula)) {
        await loadGlobalSearchResults();
      } else {
        await loadNormalPage(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filterStatus,
    filterJur,
    filterSpecialtyId,
    creatorUidFilter,
    orderField,
    orderDir,
    showArchived,
  ]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setPage(1);
      setPrevStack([]);
      setLastDoc(null);

      if (safeLower(searchCaratula)) {
        await loadGlobalSearchResults();
      } else {
        await loadNormalPage(true);
      }
    }, 250);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCaratula]);

  const visibleRows = useMemo(() => {
    if (!globalSearchActive) return pageRows;
    const start = (page - 1) * PAGE_SIZE;
    return globalRows.slice(start, start + PAGE_SIZE);
  }, [globalSearchActive, globalRows, page, pageRows]);

  useEffect(() => {
    (async () => {
      if (!visibleRows.length) return;
      await ensureLookupsForRows(visibleRows);
      await loadAcceptedForCases(visibleRows.map((r) => r.id));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows]);

  const showingText = useMemo(() => {
    const shown = visibleRows.length;

    if (globalSearchActive) {
      const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
      const end = total === 0 ? 0 : (page - 1) * PAGE_SIZE + shown;
      return { shown, start, end };
    }

    const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const end = total === 0 ? 0 : (page - 1) * PAGE_SIZE + Math.min(PAGE_SIZE, pageRows.length);
    return { shown, start, end };
  }, [globalSearchActive, page, pageRows.length, total, visibleRows.length]);

  const canNext = useMemo(() => {
    if (globalSearchActive) {
      return page * PAGE_SIZE < total;
    }
    return pageRows.length === PAGE_SIZE;
  }, [globalSearchActive, page, pageRows.length, total]);

  const creatorEmailShown = (uid: string) => {
    if (!uid) return "-";
    const email = emailByUid[uid];
    return email ? email : "Cargando...";
  };

  async function nextPage() {
    if (!canNext) return;

    if (globalSearchActive) {
      setPage((p) => p + 1);
      return;
    }

    if (!lastDoc) return;
    setPrevStack((s) => [...s, lastDoc]);
    setPage((p) => p + 1);
    await loadNormalPage(false);
  }

  async function prevPage() {
    if (page <= 1) return;

    if (globalSearchActive) {
      setPage((p) => Math.max(1, p - 1));
      return;
    }

    const newStack = [...prevStack];
    newStack.pop();
    const prevCursor = newStack.length ? newStack[newStack.length - 1] : null;

    setPrevStack(newStack);
    setPage((p) => Math.max(1, p - 1));
    setLastDoc(prevCursor);

    setLoading(true);
    setMsg(null);

    try {
      const qCases = buildCasesQuery(undefined, prevCursor);
      const snap = await getDocs(qCases);

      const rows: CaseRow[] = snap.docs.map((d) => mapCaseDoc(d));

      setPageRows(rows);
      setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);

      await ensureLookupsForRows(rows);
      await loadAcceptedForCases(rows.map((r) => r.id));
    } catch (e: any) {
      setMsg(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setFilterStatus("all");
    setFilterJur("all");
    setFilterSpecialtyId("all");
    setFilterCreatorEmail("");
    setSearchCaratula("");
    setOrderField("createdAt");
    setOrderDir("desc");
    setShowArchived(false);
  }

  return (
    <AppShell
      title="Todas las causas"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={async () => {
        await signOut(auth);
        router.replace("/login");
      }}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Mostrando <span className="font-bold">{showingText.shown}</span>{" "}
          <span className="text-gray-500 dark:text-gray-400">
            {globalSearchActive ? "(búsqueda global por carátula)" : "(sin búsqueda global)"}
          </span>{" "}
          · Total <span className="font-bold">{total}</span>
          {total > 0 ? (
            <>
              {" "}
              · Rango <span className="font-bold">{showingText.start}</span>–{" "}
              <span className="font-bold">{showingText.end}</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Estado{" "}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                <option value="draft">Pendiente</option>
                <option value="assigned">Asignada</option>
                {showArchived ? <option value="archived">Archivada</option> : null}
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Jurisdicción{" "}
              <select
                value={filterJur}
                onChange={(e) => setFilterJur(e.target.value)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todas</option>
                <option value="nacional">Nacional</option>
                <option value="federal">Federal</option>
                <option value="caba">CABA</option>
                <option value="provincia_bs_as">Provincia Bs. As.</option>
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Materia{" "}
              <select
                value={filterSpecialtyId}
                onChange={(e) => setFilterSpecialtyId(e.target.value)}
                className="ml-2 min-w-[240px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todas</option>
                {specialtiesOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Creador (email exacto){" "}
              <input
                value={filterCreatorEmail}
                onChange={(e) => setFilterCreatorEmail(e.target.value)}
                placeholder="ej: abogado@estudio.com"
                className="ml-2 min-w-[240px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
              />
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Buscar carátula{" "}
              <input
                value={searchCaratula}
                onChange={(e) => setSearchCaratula(e.target.value)}
                placeholder="Buscar por carátula en todas las causas…"
                className="ml-2 min-w-[280px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              Mostrar archivadas
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Ordenar por{" "}
              <select
                value={orderField}
                onChange={(e) => setOrderField(e.target.value as any)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="createdAt">Fecha de creación</option>
                <option value="caratulaTentativa">Carátula</option>
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Dirección{" "}
              <select
                value={orderDir}
                onChange={(e) => setOrderDir(e.target.value as any)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="desc">Descendente</option>
                <option value="asc">Ascendente</option>
              </select>
            </label>

            <button
              onClick={resetFilters}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      {msg ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {!loading && !msg ? (
        <div className="mt-4 grid gap-3">
          {visibleRows.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              No hay causas con esos filtros{searchCaratula ? " y esa carátula." : "."}
            </div>
          ) : (
            visibleRows.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[240px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-black text-gray-900 dark:text-gray-100">
                        {r.caratulaTentativa || "(sin carátula)"}{" "}
                        <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                          (#{r.id})
                        </span>
                      </div>

                      {r.status === "archived" ? (
                        <Badge tone="archived">
                          ARCHIVADA · {formatDateFromSeconds(r.archivedAt?.seconds)}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-200">
                      <span>
                        Materia:{" "}
                        <span className="font-bold">
                          {specialtyNameById[r.specialtyId] ?? r.specialtyId ?? "-"}
                        </span>
                      </span>
                      <span>
                        Jurisdicción: <span className="font-bold">{r.jurisdiccion || "-"}</span>
                      </span>
                      <span>
                        Creada:{" "}
                        <span className="font-bold">{formatDateFromSeconds(r.createdAtSec)}</span>
                      </span>
                      <span>
                        Creador: <span className="font-bold">{creatorEmailShown(r.broughtByUid)}</span>
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-200">
                      <span>Aceptada por:</span>
                      {acceptedByCaseId[r.id] ? (
                        acceptedByCaseId[r.id].length ? (
                          <div className="flex flex-wrap gap-2">
                            {acceptedByCaseId[r.id].map((e) => (
                              <Badge key={e}>{e}</Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-700 dark:text-gray-200">Nadie aún</span>
                        )
                      ) : (
                        <span className="text-sm text-gray-700 dark:text-gray-200">Cargando...</span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === "archived" ? (
                      <Badge tone="archived">ARCHIVADA</Badge>
                    ) : r.status === "assigned" ? (
                      <Badge tone="ok">ASIGNADA</Badge>
                    ) : (
                      <Badge>PENDIENTE</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/cases/${r.id}`}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Ver detalle →
                  </Link>

                  {role === "admin" ? (
                    <button
                      onClick={() => {
                        setDeleteCaseId(r.id);
                        setDeleteCaseTitle(r.caratulaTentativa || "(sin carátula)");
                      }}
                      className="rounded-xl border border-red-300 bg-red-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-red-700 dark:border-red-700 dark:bg-red-700 dark:hover:bg-red-800"
                    >
                      Eliminar causa
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={prevPage}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          ← Anterior
        </button>

        <div className="text-sm text-gray-800 dark:text-gray-100">
          Página <span className="font-black">{page}</span>
        </div>

        <button
          disabled={!canNext}
          onClick={nextPage}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          Siguiente →
        </button>
      </div>

      <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
        Nota: el filtro “Creador” funciona por <span className="font-bold">email exacto</span>. · La
        búsqueda por carátula ahora es <span className="font-bold">global</span>, no solo de la página
        actual.
      </div>

      {deleteCaseId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="text-lg font-black text-gray-900 dark:text-gray-100">
              Confirmar eliminación
            </div>

            <div className="mt-2 text-sm text-gray-700 dark:text-gray-200">
              Vas a eliminar definitivamente la causa:
              <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm font-bold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                {deleteCaseTitle} <span className="font-normal">(#{deleteCaseId})</span>
              </div>
              <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Se eliminará el documento de la causa y sus invites. Si la causa tiene otras
                subcolecciones, esas no se borran automáticamente (Firestore no hace borrado recursivo
                desde el cliente).
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                disabled={deleting}
                onClick={() => {
                  setDeleteCaseId(null);
                  setDeleteCaseTitle("");
                }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>

              <button
                disabled={deleting}
                onClick={async () => {
                  if (!deleteCaseId) return;
                  setDeleting(true);
                  setMsg(null);

                  try {
                    await deleteCaseFully(deleteCaseId);

                    const removedId = deleteCaseId;
                    setDeleteCaseId(null);
                    setDeleteCaseTitle("");

                    setPageRows((prev) => prev.filter((r) => r.id !== removedId));
                    setGlobalRows((prev) => prev.filter((r) => r.id !== removedId));
                    setAcceptedByCaseId((prev) => {
                      const next = { ...prev };
                      delete next[removedId];
                      return next;
                    });

                    if (globalSearchActive) {
                      const nextTotal = Math.max(0, total - 1);
                      setTotal(nextTotal);

                      const maxPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
                      if (page > maxPage) setPage(maxPage);
                    }
                  } catch (e: any) {
                    setMsg(e?.message ?? "Error eliminando causa");
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="rounded-xl border border-red-300 bg-red-600 px-3 py-2 text-sm font-extrabold text-white hover:bg-red-700 disabled:opacity-60 dark:border-red-700 dark:bg-red-700 dark:hover:bg-red-800"
              >
                {deleting ? "Eliminando..." : "Sí, eliminar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}