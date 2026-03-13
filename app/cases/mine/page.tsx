"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  doc,
  getDoc,
  collectionGroup,
  startAfter,
  Query,
  QueryDocumentSnapshot,
  DocumentData,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import ScrollToTopButton from "@/components/ScrollToTopButton";

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
  requiredAssigneesCount?: number;
  confirmedAssigneesUids?: string[];
  createdAt?: FirestoreDateLike;
  broughtByUid?: string;
  archivedAt?: FirestoreDateLike;
  participantsUids?: string[];
  assignmentMode?: "auto" | "direct";
};

type SpecialtyDoc = { name?: string };

const PAGE_SIZE = 25;

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

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

// Traer TODOS los docs por lotes
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

export default function MyCasesPage() {
  const router = useRouter();

  // auth/shell
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // data
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<CaseRow[]>([]);
  const [specialtyNameById, setSpecialtyNameById] = useState<Record<string, string>>({});
  const [inviteCountByCaseId, setInviteCountByCaseId] = useState<Record<string, number>>({});

  // opciones (combo Materia)
  const [specialtiesOptions, setSpecialtiesOptions] = useState<Array<{ id: string; name: string }>>(
    []
  );

  // opciones abogados (emails)
  const [lawyerOptions, setLawyerOptions] = useState<Array<{ uid: string; email: string }>>([]);

  // filtros
  const [filterStatus, setFilterStatus] = useState<"all" | CaseStatus>("all");
  const [filterJur, setFilterJur] = useState<string>("all");
  const [filterSpecialtyId, setFilterSpecialtyId] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);

  // compartido con (email)
  const [filterSharedWithEmail, setFilterSharedWithEmail] = useState<string>("all");
  const [sharedWithUidFilter, setSharedWithUidFilter] = useState<string | null>(null);

  // búsqueda carátula
  const [searchCaratula, setSearchCaratula] = useState("");

  // orden
  const [orderField, setOrderField] = useState<"createdAt" | "caratulaTentativa">("createdAt");
  const [orderDir, setOrderDir] = useState<"asc" | "desc">("desc");

  // paginación
  const [page, setPage] = useState(1);

  // ---------- carga principal ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setLoading(true);
      setMsg(null);

      // rol
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      // pending invites (badge tabs)
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

      // opciones de especialidades
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

      // opciones de abogados (emails)
      try {
        const usersSnap = await getDocs(query(collection(db, "users"), orderBy("email", "asc")));
        const list = usersSnap.docs
          .map((d) => {
            const data = d.data() as any;
            const email = safeLower(data?.email);
            return { uid: d.id, email };
          })
          .filter((x) => Boolean(x.email));

        setLawyerOptions(list);
      } catch {
        setLawyerOptions([]);
      }

      try {
        // 1) Causas creadas por mí
        const qCreatedBase = query(
          collection(db, "cases"),
          where("broughtByUid", "==", u.uid),
          orderBy("createdAt", "desc")
        );

        // 2) Causas donde estoy confirmado
        const qConfirmedBase = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", u.uid),
          orderBy("__name__")
        );

        // 3) Invitaciones donde fui invitado
        const qInvitesBase = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          orderBy("__name__")
        );

        const [createdDocs, confirmedDocs, invitesDocs] = await Promise.all([
          getAllDocs(qCreatedBase),
          getAllDocs(qConfirmedBase),
          getAllDocs(qInvitesBase),
        ]);

        const byId = new Map<string, CaseRow>();

        const addCaseDoc = (id: string, data: any) => {
          byId.set(id, { id, ...(data as any) });
        };

        createdDocs.forEach((d) => addCaseDoc(d.id, d.data()));
        confirmedDocs.forEach((d) => addCaseDoc(d.id, d.data()));

        const invitedCaseIds = Array.from(
          new Set(invitesDocs.map((d) => d.ref.parent.parent?.id ?? "").filter(Boolean))
        );

        await Promise.all(
          invitedCaseIds.map(async (caseId) => {
            if (byId.has(caseId)) return;
            try {
              const caseSnap = await getDoc(doc(db, "cases", caseId));
              if (caseSnap.exists()) addCaseDoc(caseId, caseSnap.data());
            } catch {}
          })
        );

        const list = Array.from(byId.values()).sort((a, b) => {
          const as = a.createdAt?.seconds ?? 0;
          const bs = b.createdAt?.seconds ?? 0;
          return bs - as;
        });

        setRows(list);
        setPage(1);
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando mis causas");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  // nombres de especialidades
  useEffect(() => {
    const ids = Array.from(new Set(rows.map((r) => r.specialtyId).filter(Boolean)));
    const missing = ids.filter((id) => !specialtyNameById[id]);
    if (missing.length === 0) return;

    (async () => {
      const newMap = { ...specialtyNameById };

      await Promise.all(
        missing.map(async (id) => {
          try {
            const spSnap = await getDoc(doc(db, "specialties", id));
            const sp = spSnap.exists() ? (spSnap.data() as SpecialtyDoc) : null;
            newMap[id] = sp?.name ?? "(especialidad no encontrada)";
          } catch {
            newMap[id] = "(error)";
          }
        })
      );

      setSpecialtyNameById(newMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // cargar cantidad real de invites por causa
  useEffect(() => {
    if (rows.length === 0) {
      setInviteCountByCaseId({});
      return;
    }

    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => {
          try {
            const snap = await getDocs(collection(db, "cases", r.id, "invites"));
            return [r.id, snap.size] as const;
          } catch {
            return [r.id, 0] as const;
          }
        })
      );

      const next: Record<string, number> = {};
      entries.forEach(([caseId, count]) => {
        next[caseId] = count;
      });

      setInviteCountByCaseId(next);
    })();
  }, [rows]);

  // resolver “compartido con” email -> uid
  useEffect(() => {
    if (filterSharedWithEmail === "all") {
      setSharedWithUidFilter(null);
      return;
    }
    const found = lawyerOptions.find((x) => x.email === safeLower(filterSharedWithEmail));
    setSharedWithUidFilter(found?.uid ?? "__none__");
  }, [filterSharedWithEmail, lawyerOptions]);

  // si desactiva mostrar archivadas, saco el filtro archivadas
  useEffect(() => {
    if (!showArchived && filterStatus === "archived") {
      setFilterStatus("all");
    }
  }, [showArchived, filterStatus]);

  // reset a página 1 si cambian filtros
  useEffect(() => {
    setPage(1);
  }, [
    filterStatus,
    filterJur,
    filterSpecialtyId,
    sharedWithUidFilter,
    orderField,
    orderDir,
    searchCaratula,
    showArchived,
  ]);

  // helper participantes por causa
  const caseParticipants = (r: CaseRow) => {
    const p = Array.isArray(r.participantsUids) ? r.participantsUids : [];
    if (p.length) return uniq(p);

    return uniq([String(r.broughtByUid ?? ""), ...((r.confirmedAssigneesUids ?? []) as string[])]);
  };

  const getCaseTargetCount = (r: CaseRow) => {
    const confirmed = uniq(r.confirmedAssigneesUids ?? []).length;
    const inviteCount = Number(inviteCountByCaseId[r.id] ?? 0);
    const required = Number(r.requiredAssigneesCount ?? 0);

    if (r.assignmentMode === "direct") {
      return Math.max(inviteCount, required, confirmed, 1);
    }

    return Math.max(required || 2, confirmed, 1);
  };

  const filteredSorted = useMemo(() => {
    const s = safeLower(searchCaratula);

    const base = rows.filter((r) => {
      if (!showArchived && r.status === "archived") return false;

      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterJur !== "all" && String(r.jurisdiccion ?? "") !== filterJur) return false;
      if (filterSpecialtyId !== "all" && String(r.specialtyId ?? "") !== filterSpecialtyId)
        return false;

      if (sharedWithUidFilter) {
        if (sharedWithUidFilter === "__none__") return false;
        const parts = caseParticipants(r);
        if (!parts.includes(sharedWithUidFilter)) return false;
      }

      if (s) {
        const c = safeLower(r.caratulaTentativa);
        if (!c.includes(s)) return false;
      }

      return true;
    });

    const sorted = [...base].sort((a, b) => {
      if (orderField === "createdAt") {
        const as = Number(a.createdAt?.seconds ?? 0);
        const bs = Number(b.createdAt?.seconds ?? 0);
        return orderDir === "asc" ? as - bs : bs - as;
      } else {
        const ac = safeLower(a.caratulaTentativa);
        const bc = safeLower(b.caratulaTentativa);
        if (ac < bc) return orderDir === "asc" ? -1 : 1;
        if (ac > bc) return orderDir === "asc" ? 1 : -1;
        return 0;
      }
    });

    return sorted;
  }, [
    rows,
    filterStatus,
    filterJur,
    filterSpecialtyId,
    sharedWithUidFilter,
    orderField,
    orderDir,
    searchCaratula,
    showArchived,
  ]);

  const totalFiltered = filteredSorted.length;

  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSorted.slice(start, start + PAGE_SIZE);
  }, [filteredSorted, page]);

  const canPrev = page > 1;
  const canNext = page * PAGE_SIZE < totalFiltered;

  const showingText = useMemo(() => {
    const shown = pageRows.length;
    const start = totalFiltered === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const end = totalFiltered === 0 ? 0 : (page - 1) * PAGE_SIZE + shown;
    return { shown, start, end };
  }, [pageRows.length, page, totalFiltered]);

  function resetFilters() {
    setFilterStatus("all");
    setFilterJur("all");
    setFilterSpecialtyId("all");
    setFilterSharedWithEmail("all");
    setSearchCaratula("");
    setOrderField("createdAt");
    setOrderDir("desc");
    setShowArchived(false);
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Mis causas"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Mis causas" },
      ]}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Mostrando <span className="font-bold">{showingText.shown}</span>
          {totalFiltered > 0 ? (
            <>
              {" "}
              · Rango <span className="font-bold">{showingText.start}</span>–{" "}
              <span className="font-bold">{showingText.end}</span>
            </>
          ) : null}{" "}
          · Total (con filtros) <span className="font-bold">{totalFiltered}</span> · Total sin filtros{" "}
          <span className="font-bold">{rows.length}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/cases"
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Ver todas →
          </Link>
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
              Compartido con{" "}
              <select
                value={filterSharedWithEmail}
                onChange={(e) => setFilterSharedWithEmail(e.target.value)}
                className="ml-2 min-w-[260px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                {lawyerOptions.map((l) => (
                  <option key={l.uid} value={l.email}>
                    {l.email}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Buscar carátula{" "}
              <input
                value={searchCaratula}
                onChange={(e) => setSearchCaratula(e.target.value)}
                placeholder="Buscar por carátula…"
                className="ml-2 min-w-[240px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
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
          {pageRows.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              No tenés causas con esos filtros.
            </div>
          ) : (
            pageRows.map((r) => {
              const required = getCaseTargetCount(r);
              const confirmed = uniq(r.confirmedAssigneesUids ?? []).length;
              const missing = Math.max(0, required - confirmed);

              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[240px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/cases/${r.id}`}
                          className="font-black text-gray-900 hover:underline dark:text-gray-100"
                        >
                          {r.caratulaTentativa || "(sin carátula)"}
                        </Link>

                        {r.status === "archived" ? (
                          <Badge tone="archived">
                            ARCHIVADA · {formatDateFromSeconds(r.archivedAt?.seconds)}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        Materia:{" "}
                        <span className="font-bold">
                          {specialtyNameById[r.specialtyId] ?? r.specialtyId}
                        </span>{" "}
                        · Jurisdicción: <span className="font-bold">{r.jurisdiccion}</span> · Creada:{" "}
                        <span className="font-bold">
                          {formatDateFromSeconds(r.createdAt?.seconds)}
                        </span>
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

                      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                        {missing > 0
                          ? `faltan ${missing} (${confirmed}/${required})`
                          : `completo (${confirmed}/${required})`}
                      </span>
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
              );
            })
          )}
        </div>
      ) : null}

      {!loading && !msg ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            ← Anterior
          </button>

          <div className="text-sm text-gray-800 dark:text-gray-100">
            Página <span className="font-black">{page}</span>
          </div>

          <button
            disabled={!canNext}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Siguiente →
          </button>
        </div>
      ) : null}

      {lawyerOptions.length === 0 ? (
        <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
          Nota: no pude cargar la lista de abogados (users). Revisá reglas de Firestore para permitir leer
          emails de usuarios del estudio.
        </div>
      ) : null}
      <ScrollToTopButton />
    </AppShell>
  );
}