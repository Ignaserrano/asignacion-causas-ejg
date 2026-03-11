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

type MainCaseStatus = "draft" | "assigned" | "archsolicited" | "archived";
type ProceduralStatus =
  | "preliminar"
  | "iniciada"
  | "en_prueba"
  | "a_sentencia"
  | "en_apelacion"
  | "en_ejecucion";

type FirestoreDateLike = {
  seconds?: number;
};

type CaseRow = {
  id: string;
  caratulaTentativa: string;
  specialtyId: string;
  jurisdiccion: string;
  status: MainCaseStatus;
  requiredAssigneesCount?: number;
  confirmedAssigneesUids?: string[];
  createdAt?: FirestoreDateLike;
  broughtByUid?: string;
  archivedAt?: FirestoreDateLike;

  // opcional si lo tenés
  participantsUids?: string[];

  // bitácora
  lastLogAt?: FirestoreDateLike;

  // management meta
  expedienteNumber?: string;
  court?: string;
  proceduralStatus?: ProceduralStatus;
};

type SpecialtyDoc = { name?: string };

const PAGE_SIZE = 25;

const PROCEDURAL_STATUS_LABEL: Record<ProceduralStatus, string> = {
  preliminar: "Preliminar",
  iniciada: "Iniciada",
  en_prueba: "En prueba",
  a_sentencia: "A sentencia",
  en_apelacion: "En apelación",
  en_ejecucion: "En ejecución",
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function valueOrDash(v?: string | null) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

function formatProceduralStatus(status?: string) {
  if (!status) return "-";
  return PROCEDURAL_STATUS_LABEL[status as ProceduralStatus] ?? status;
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "archived" | "warning";
}) {
  const cls =
    tone === "ok"
      ? "bg-green-100 border-green-300 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-100"
      : tone === "archived"
      ? "bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100"
      : tone === "warning"
      ? "bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-100"
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

async function getLastLogAt(caseId: string): Promise<FirestoreDateLike | undefined> {
  try {
    const qLastLog = query(
      collection(db, "cases", caseId, "logs"),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    const snap = await getDocs(qLastLog);
    if (snap.empty) return undefined;

    const data = snap.docs[0].data() as any;
    const createdAt = data?.createdAt;

    if (createdAt?.seconds) {
      return { seconds: createdAt.seconds };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function getManagementMeta(caseId: string): Promise<{
  expedienteNumber?: string;
  court?: string;
  proceduralStatus?: ProceduralStatus;
}> {
  try {
    const snap = await getDoc(doc(db, "cases", caseId, "management", "meta"));
    if (!snap.exists()) {
      return {};
    }

    const data = snap.data() as any;

    return {
      expedienteNumber: String(data?.expedienteNumber ?? "").trim() || undefined,
      court: String(data?.court ?? "").trim() || undefined,
      proceduralStatus: (String(data?.status ?? "").trim() || undefined) as ProceduralStatus | undefined,
    };
  } catch {
    return {};
  }
}

export default function ManageCasesPage() {
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

  // opciones (combo Materia)
  const [specialtiesOptions, setSpecialtiesOptions] = useState<Array<{ id: string; name: string }>>(
    []
  );

  // opciones abogados (emails)
  const [lawyerOptions, setLawyerOptions] = useState<Array<{ uid: string; email: string }>>([]);

  // filtros
  const [filterStatus, setFilterStatus] = useState<"all" | MainCaseStatus>("all");
  const [filterJur, setFilterJur] = useState<string>("all");
  const [filterSpecialtyId, setFilterSpecialtyId] = useState<string>("all");
  const [filterProceduralStatus, setFilterProceduralStatus] = useState<"all" | ProceduralStatus>("all");
  const [showArchived, setShowArchived] = useState(false);

  // compartido con (email)
  const [filterSharedWithEmail, setFilterSharedWithEmail] = useState<string>("all");
  const [sharedWithUidFilter, setSharedWithUidFilter] = useState<string | null>(null);

  // búsqueda carátula
  const [searchCaratula, setSearchCaratula] = useState("");

  // orden
  const [orderField, setOrderField] = useState<"lastLogAt" | "caratulaTentativa">("lastLogAt");
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
        // Gestión: causas donde PARTICIPO (confirmado)
        const qConfirmedBase = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", u.uid),
          orderBy("__name__")
        );

        const confirmedDocs = await getAllDocs(qConfirmedBase);

        const rawList = confirmedDocs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as CaseRow[];

        const enrichedList = await Promise.all(
          rawList.map(async (item) => {
            const [lastLogAt, meta] = await Promise.all([
              getLastLogAt(item.id),
              getManagementMeta(item.id),
            ]);

            return {
              ...item,
              lastLogAt,
              expedienteNumber: meta.expedienteNumber,
              court: meta.court,
              proceduralStatus: meta.proceduralStatus,
            };
          })
        );

        // orden inicial: última entrada de bitácora desc
        enrichedList.sort((a, b) => {
          const as = Number(a.lastLogAt?.seconds ?? 0);
          const bs = Number(b.lastLogAt?.seconds ?? 0);
          return bs - as;
        });

        setRows(enrichedList);
        setPage(1);
      } catch (e: any) {
        console.error("ERROR cargando causas para gestionar:", e);
        setMsg(e?.message ?? "Error cargando causas para gestionar");
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
    filterProceduralStatus,
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

  const filteredSorted = useMemo(() => {
    const s = safeLower(searchCaratula);

    const base = rows.filter((r) => {
      if (!showArchived && r.status === "archived") return false;

      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (filterJur !== "all" && String(r.jurisdiccion ?? "") !== filterJur) return false;
      if (filterSpecialtyId !== "all" && String(r.specialtyId ?? "") !== filterSpecialtyId) {
        return false;
      }
      if (
        filterProceduralStatus !== "all" &&
        String(r.proceduralStatus ?? "") !== filterProceduralStatus
      ) {
        return false;
      }

      // compartido con
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
      if (orderField === "lastLogAt") {
        const as = Number(a.lastLogAt?.seconds ?? 0);
        const bs = Number(b.lastLogAt?.seconds ?? 0);
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
    filterProceduralStatus,
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
    setFilterProceduralStatus("all");
    setFilterSharedWithEmail("all");
    setSearchCaratula("");
    setOrderField("lastLogAt");
    setOrderDir("desc");
    setShowArchived(false);
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Gestión de causas"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Gestión de causas" },
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
                <option value="archsolicited">Archivo solicitado</option>
                {showArchived ? <option value="archived">Archivada</option> : null}
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Estado procesal{" "}
              <select
                value={filterProceduralStatus}
                onChange={(e) => setFilterProceduralStatus(e.target.value as any)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                <option value="preliminar">Preliminar</option>
                <option value="iniciada">Iniciada</option>
                <option value="en_prueba">En prueba</option>
                <option value="a_sentencia">A sentencia</option>
                <option value="en_apelacion">En apelación</option>
                <option value="en_ejecucion">En ejecución</option>
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
                <option value="lastLogAt">Última entrada en bitácora</option>
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
              return (
                <Link
                  key={r.id}
                  href={`/cases/manage/${r.id}`}
                  className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[240px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-black text-gray-900 dark:text-gray-100">
                          {r.caratulaTentativa || "(sin carátula)"}
                        </div>

                        {r.status === "archived" ? (
                          <Badge tone="archived">
                            Archivada · {formatDateFromSeconds(r.archivedAt?.seconds)}
                          </Badge>
                        ) : null}

                        {r.status === "archsolicited" ? (
                          <Badge tone="warning">Archivo solicitado</Badge>
                        ) : null}
                      </div>

                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        Materia:{" "}
                        <span className="font-bold">
                          {specialtyNameById[r.specialtyId] ?? r.specialtyId}
                        </span>{" "}
                        · Jurisdicción: <span className="font-bold">{valueOrDash(r.jurisdiccion)}</span> ·
                        Estado procesal:{" "}
                        <span className="font-bold">{formatProceduralStatus(r.proceduralStatus)}</span> ·
                        Última bitácora:{" "}
                        <span className="font-bold">{formatDateFromSeconds(r.lastLogAt?.seconds)}</span>
                      </div>

                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        Nº expte.: <span className="font-bold">{valueOrDash(r.expedienteNumber)}</span> ·
                        Dependencia: <span className="font-bold">{valueOrDash(r.court)}</span>
                      </div>
                    </div>

                    <div className="shrink-0 text-sm font-extrabold text-gray-500 dark:text-gray-400">
                      Abrir →
                    </div>
                  </div>
                </Link>
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
    </AppShell>
  );
}