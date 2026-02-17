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
} from "firebase/firestore";

import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

type CaseStatus = "draft" | "assigned";

type CaseRow = {
  id: string;
  caratulaTentativa: string;
  specialtyId: string;
  jurisdiccion: string;
  status: CaseStatus;
  createdAtSec: number;
  broughtByUid: string;
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
  tone?: "neutral" | "ok";
}) {
  const cls =
    tone === "ok"
      ? "bg-green-100 border-green-300 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-100"
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

  // orden
  const [orderField, setOrderField] = useState<"createdAt" | "caratulaTentativa">("createdAt");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("desc");

  // paginación
  const [page, setPage] = useState(1);
  const [pageRows, setPageRows] = useState<CaseRow[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [prevStack, setPrevStack] = useState<DocumentSnapshot[]>([]);

  // total (con filtros)
  const [total, setTotal] = useState<number>(0);

  // lookups
  const [specialtyNameById, setSpecialtyNameById] = useState<Record<string, string>>({});
  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});

  // opciones para combos
  const [specialtiesOptions, setSpecialtiesOptions] = useState<Array<{ id: string; name: string }>>([]);

  // uid del creador filtrado (resuelto por email exacto)
  const [creatorUidFilter, setCreatorUidFilter] = useState<string | null>(null);

  // ------------ helpers query ------------
  function buildCasesQuery(base?: Query, cursor?: DocumentSnapshot | null) {
    let qAny: any = base ?? collection(db, "cases");

    // filtros server-side (equality)
    if (filterStatus !== "all") qAny = query(qAny, where("status", "==", filterStatus));
    if (filterJur !== "all") qAny = query(qAny, where("jurisdiccion", "==", filterJur));
    if (filterSpecialtyId !== "all")
      qAny = query(qAny, where("specialtyId", "==", filterSpecialtyId));
    if (creatorUidFilter) qAny = query(qAny, where("broughtByUid", "==", creatorUidFilter));

    // orden
    qAny = query(qAny, orderBy(orderField, orderDir));

    // paginación
    if (cursor) qAny = query(qAny, startAfter(cursor));
    qAny = query(qAny, limit(PAGE_SIZE));

    return qAny as Query;
  }

  async function resolveCreatorUidByEmailExact(email: string): Promise<string | null> {
    const e = safeLower(email);
    if (!e) return null;
    const qUsers = query(collection(db, "users"), where("email", "==", e), limit(1));
    const snap = await getDocs(qUsers);
    if (snap.empty) return "__none__"; // forzamos 0 resultados
    return snap.docs[0].id;
  }

  async function refreshTotalCount() {
    // Sin aggregation count() por compatibilidad; scan por páginas.
    let qAny: any = collection(db, "cases");

    if (filterStatus !== "all") qAny = query(qAny, where("status", "==", filterStatus));
    if (filterJur !== "all") qAny = query(qAny, where("jurisdiccion", "==", filterJur));
    if (filterSpecialtyId !== "all")
      qAny = query(qAny, where("specialtyId", "==", filterSpecialtyId));
    if (creatorUidFilter) qAny = query(qAny, where("broughtByUid", "==", creatorUidFilter));

    qAny = query(qAny, orderBy("createdAt", "desc"));

    let count = 0;
    let cursor: QueryDocumentSnapshot<DocumentData, DocumentData> | null = null;

    for (let i = 0; i < 500; i++) {
      let qPage: any = qAny;
      if (cursor) qPage = query(qPage, startAfter(cursor));
      qPage = query(qPage, limit(500));
      const snap = await getDocs(qPage);
      count += snap.size;
      if (snap.size < 500) break;
      cursor = snap.docs[snap.docs.length - 1] as unknown as QueryDocumentSnapshot<
        DocumentData,
        DocumentData
      >;
    }

    setTotal(count);
  }

  async function loadPage(resetToFirst: boolean) {
    setLoading(true);
    setMsg(null);

    try {
      const qCases = buildCasesQuery(undefined, resetToFirst ? null : lastDoc);
      const snap = await getDocs(qCases);

      const rows: CaseRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          caratulaTentativa: String(data?.caratulaTentativa ?? ""),
          specialtyId: String(data?.specialtyId ?? ""),
          jurisdiccion: String(data?.jurisdiccion ?? ""),
          status: (data?.status ?? "draft") as CaseStatus,
          createdAtSec: Number(data?.createdAt?.seconds ?? 0),
          broughtByUid: String(data?.broughtByUid ?? ""),
        };
      });

      setPageRows(rows);
      setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);

      // Pre-cargar emails (solo para mostrar email, nunca UID en UI)
      const uids = Array.from(new Set(rows.map((r) => r.broughtByUid).filter(Boolean)));
      const missingUids = uids.filter((u) => !emailByUid[u]);
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

      // Pre-cargar especialidades
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
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando causas");
    } finally {
      setLoading(false);
    }
  }

  // ------------ init auth + load specialties options + first load ------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);

      // rol
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      // pending invites
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

      // opciones de especialidades (para filtro)
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

      // primera carga
      setPage(1);
      setPrevStack([]);
      setLastDoc(null);
      await loadPage(true);
      await refreshTotalCount();
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ------------ when creator email changes: resolve uid ------------
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

  // ------------ when filters/order change: reset pagination & reload ------------
  useEffect(() => {
    (async () => {
      setPage(1);
      setPrevStack([]);
      setLastDoc(null);
      await loadPage(true);
      await refreshTotalCount();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus, filterJur, filterSpecialtyId, creatorUidFilter, orderField, orderDir]);

  const showingText = useMemo(() => {
    const shown = pageRows.length;
    const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const end = total === 0 ? 0 : (page - 1) * PAGE_SIZE + shown;
    return { shown, start, end };
  }, [pageRows.length, page, total]);

  const canNext = useMemo(() => pageRows.length === PAGE_SIZE, [pageRows.length]);

  // ✅ nunca UID: si no hay email todavía, mostramos "Cargando..."
  const creatorEmailShown = (uid: string) => {
    if (!uid) return "-";
    const email = emailByUid[uid];
    return email ? email : "Cargando...";
  };

  async function nextPage() {
    if (!canNext || !lastDoc) return;
    setPrevStack((s) => [...s, lastDoc]);
    setPage((p) => p + 1);
    await loadPage(false);
  }

  async function prevPage() {
    if (page <= 1) return;

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

      const rows: CaseRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          caratulaTentativa: String(data?.caratulaTentativa ?? ""),
          specialtyId: String(data?.specialtyId ?? ""),
          jurisdiccion: String(data?.jurisdiccion ?? ""),
          status: (data?.status ?? "draft") as CaseStatus,
          createdAtSec: Number(data?.createdAt?.seconds ?? 0),
          broughtByUid: String(data?.broughtByUid ?? ""),
        };
      });

      setPageRows(rows);
      setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
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
    setOrderField("createdAt");
    setOrderDir("desc");
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
      {/* Header interno */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Mostrando <span className="font-bold">{showingText.shown}</span> · Total{" "}
          <span className="font-bold">{total}</span>
          {total > 0 ? (
            <>
              {" "}
              · Rango <span className="font-bold">{showingText.start}</span>–{" "}
              <span className="font-bold">{showingText.end}</span>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/cases/mine"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Mis causas →
          </Link>
          <Link
            href="/invites"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Mis invitaciones →
          </Link>
        </div>
      </div>

      {/* Filtros / orden */}
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

      {/* Listado */}
      {!loading && !msg ? (
        <div className="mt-4 grid gap-3">
          {pageRows.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              No hay causas con esos filtros.
            </div>
          ) : (
            pageRows.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[240px]">
                    <div className="font-black text-gray-900 dark:text-gray-100">
                      {r.caratulaTentativa || "(sin carátula)"}{" "}
                      <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                        (#{r.id})
                      </span>
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
                        Creada: <span className="font-bold">{formatDateFromSeconds(r.createdAtSec)}</span>
                      </span>
                      <span>
                        Creador: <span className="font-bold">{creatorEmailShown(r.broughtByUid)}</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === "assigned" ? <Badge tone="ok">ASIGNADA</Badge> : <Badge>PENDIENTE</Badge>}
                  </div>
                </div>

                <div className="mt-4">
                  <Link
                    href={`/cases/${r.id}`}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  >
                    Ver detalle →
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* Paginación */}
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
        Nota: el filtro “Creador” funciona por <span className="font-bold">email exacto</span> (por ahora).
      </div>
    </AppShell>
  );
}