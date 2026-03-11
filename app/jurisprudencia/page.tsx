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
  query,
  startAfter,
  Query,
  QueryDocumentSnapshot,
  DocumentData,
  where,
  orderBy,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

type SentenceResult = "ganado" | "perdido" | "empatado";
type Jurisdiccion = "nacional" | "federal" | "caba" | "provincia_bs_as";

type FirestoreDateLike = {
  seconds?: number;
};

type SentenceRow = {
  id: string;
  caseId?: string;
  createdAt?: FirestoreDateLike;
  createdByUid?: string;
  jurisdiccion?: Jurisdiccion | string;
  fuero?: string;
  court?: string;
  expedienteNumber?: string;
  resumen?: string;
  resultado?: SentenceResult;
  pdfUrl?: string;
  pdfName?: string;
  caratula?: string;
};

type CaseDoc = {
  caratulaTentativa?: string;
};

const PAGE_SIZE = 25;

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function valueOrDash(v?: string | null) {
  const s = String(v ?? "").trim();
  return s ? s : "-";
}

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("es-AR");
}

function yearFromSeconds(seconds?: number) {
  if (!seconds) return "";
  return String(new Date(seconds * 1000).getFullYear());
}

function jurisdiccionLabel(v?: string) {
  switch (v) {
    case "nacional":
      return "Nacional";
    case "federal":
      return "Federal";
    case "caba":
      return "CABA";
    case "provincia_bs_as":
      return "Provincia Bs. As.";
    default:
      return valueOrDash(v);
  }
}

function resultadoLabel(v?: SentenceResult) {
  switch (v) {
    case "ganado":
      return "Ganado";
    case "perdido":
      return "Perdido";
    case "empatado":
      return "Empatado";
    default:
      return "-";
  }
}

function resumenPreview(text?: string, max = 220) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "ok" | "bad" | "mid";
}) {
  const cls =
    tone === "ok"
      ? "bg-green-100 border-green-300 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-100"
      : tone === "bad"
      ? "bg-red-100 border-red-300 text-red-900 dark:bg-red-900/30 dark:border-red-700 dark:text-red-100"
      : tone === "mid"
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
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="text-base font-black text-gray-900 dark:text-gray-100">{title}</div>
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

async function getCaseCaratula(caseId?: string): Promise<string | undefined> {
  const id = String(caseId ?? "").trim();
  if (!id) return undefined;

  try {
    const snap = await getDoc(doc(db, "cases", id));
    if (!snap.exists()) return undefined;
    const data = snap.data() as CaseDoc;
    return String(data?.caratulaTentativa ?? "").trim() || undefined;
  } catch {
    return undefined;
  }
}

export default function JurisprudenciaPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<SentenceRow[]>([]);

  const [filterResultado, setFilterResultado] = useState<"all" | SentenceResult>("all");
  const [filterJurisdiccion, setFilterJurisdiccion] = useState<"all" | Jurisdiccion>("all");
  const [filterFuero, setFilterFuero] = useState("all");
  const [filterCourt, setFilterCourt] = useState("all");
  const [filterYear, setFilterYear] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [orderField, setOrderField] = useState<"fecha" | "caratula" | "court">("fecha");
  const [orderDir, setOrderDir] = useState<"desc" | "asc">("desc");

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [statsModalOpen, setStatsModalOpen] = useState(false);
  const [page, setPage] = useState(1);

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
        const qBase = query(collection(db, "sentences"), orderBy("__name__"));
        const docs = await getAllDocs(qBase);

        const baseRows = docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as SentenceRow[];

        const enriched = await Promise.all(
          baseRows.map(async (row) => {
            const caratula = await getCaseCaratula(row.caseId);
            return {
              ...row,
              caratula,
            };
          })
        );

        enriched.sort((a, b) => {
          const as = Number(a.createdAt?.seconds ?? 0);
          const bs = Number(b.createdAt?.seconds ?? 0);
          return bs - as;
        });

        setRows(enriched);
        setPage(1);
      } catch (e: any) {
        console.error("ERROR cargando jurisprudencia:", e);
        setMsg(e?.message ?? "Error cargando jurisprudencia");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  const fueroOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => String(r.fuero ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const courtOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => String(r.court ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "es"));
  }, [rows]);

  const yearOptions = useMemo(() => {
    return Array.from(
      new Set(rows.map((r) => yearFromSeconds(r.createdAt?.seconds)).filter(Boolean))
    ).sort((a, b) => Number(b) - Number(a));
  }, [rows]);

  useEffect(() => {
    setPage(1);
  }, [
    filterResultado,
    filterJurisdiccion,
    filterFuero,
    filterCourt,
    filterYear,
    searchText,
    orderField,
    orderDir,
  ]);

  const filteredSorted = useMemo(() => {
    const q = safeLower(searchText);

    const filtered = rows.filter((r) => {
      if (filterResultado !== "all" && r.resultado !== filterResultado) return false;
      if (filterJurisdiccion !== "all" && r.jurisdiccion !== filterJurisdiccion) return false;
      if (filterFuero !== "all" && String(r.fuero ?? "").trim() !== filterFuero) return false;
      if (filterCourt !== "all" && String(r.court ?? "").trim() !== filterCourt) return false;
      if (filterYear !== "all" && yearFromSeconds(r.createdAt?.seconds) !== filterYear) return false;

      if (q) {
        const haystack = [
          r.caratula,
          r.resumen,
          r.court,
          r.expedienteNumber,
          r.fuero,
          r.jurisdiccion,
          r.pdfName,
          r.resultado,
        ]
          .map((v) => safeLower(v))
          .join(" ");

        if (!haystack.includes(q)) return false;
      }

      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (orderField === "fecha") {
        const as = Number(a.createdAt?.seconds ?? 0);
        const bs = Number(b.createdAt?.seconds ?? 0);
        return orderDir === "asc" ? as - bs : bs - as;
      }

      if (orderField === "caratula") {
        const av = safeLower(a.caratula);
        const bv = safeLower(b.caratula);
        if (av < bv) return orderDir === "asc" ? -1 : 1;
        if (av > bv) return orderDir === "asc" ? 1 : -1;
        return 0;
      }

      const av = safeLower(a.court);
      const bv = safeLower(b.court);
      if (av < bv) return orderDir === "asc" ? -1 : 1;
      if (av > bv) return orderDir === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [
    rows,
    filterResultado,
    filterJurisdiccion,
    filterFuero,
    filterCourt,
    filterYear,
    searchText,
    orderField,
    orderDir,
  ]);

  const stats = useMemo(() => {
    const total = filteredSorted.length;
    const ganadas = filteredSorted.filter((r) => r.resultado === "ganado").length;
    const perdidas = filteredSorted.filter((r) => r.resultado === "perdido").length;
    const empatadas = filteredSorted.filter((r) => r.resultado === "empatado").length;

    const porFuero = Array.from(
      filteredSorted.reduce((acc, row) => {
        const key = String(row.fuero ?? "").trim() || "(sin fuero)";
        acc.set(key, (acc.get(key) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())
    ).sort((a, b) => b[1] - a[1]);

    const porJurisdiccion = Array.from(
      filteredSorted.reduce((acc, row) => {
        const key = jurisdiccionLabel(row.jurisdiccion);
        acc.set(key, (acc.get(key) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())
    ).sort((a, b) => b[1] - a[1]);

    const porAnio = Array.from(
      filteredSorted.reduce((acc, row) => {
        const key = yearFromSeconds(row.createdAt?.seconds) || "(sin fecha)";
        acc.set(key, (acc.get(key) ?? 0) + 1);
        return acc;
      }, new Map<string, number>())
    ).sort((a, b) => {
      const aNum = Number(a[0]);
      const bNum = Number(b[0]);
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return bNum - aNum;
      return String(a[0]).localeCompare(String(b[0]), "es");
    });

    return { total, ganadas, perdidas, empatadas, porFuero, porJurisdiccion, porAnio };
  }, [filteredSorted]);

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
    setFilterResultado("all");
    setFilterJurisdiccion("all");
    setFilterFuero("all");
    setFilterCourt("all");
    setFilterYear("all");
    setSearchText("");
    setOrderField("fecha");
    setOrderDir("desc");
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Jurisprudencia del estudio"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Jurisprudencia" },
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

        <button
          type="button"
          onClick={() => setStatsModalOpen(true)}
          className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90"
        >
          Ver estadísticas
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Resultado{" "}
              <select
                value={filterResultado}
                onChange={(e) => setFilterResultado(e.target.value as any)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                <option value="ganado">Ganado</option>
                <option value="perdido">Perdido</option>
                <option value="empatado">Empatado</option>
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Jurisdicción{" "}
              <select
                value={filterJurisdiccion}
                onChange={(e) => setFilterJurisdiccion(e.target.value as any)}
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
              Fuero{" "}
              <select
                value={filterFuero}
                onChange={(e) => setFilterFuero(e.target.value)}
                className="ml-2 min-w-[220px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                {fueroOptions.map((fuero) => (
                  <option key={fuero} value={fuero}>
                    {fuero}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Juzgado / dependencia{" "}
              <select
                value={filterCourt}
                onChange={(e) => setFilterCourt(e.target.value)}
                className="ml-2 min-w-[240px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                {courtOptions.map((court) => (
                  <option key={court} value={court}>
                    {court}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Año{" "}
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="all">Todos</option>
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Buscar{" "}
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Carátula, resumen, juzgado, expediente…"
                className="ml-2 min-w-[320px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
              />
            </label>

            <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
              Ordenar por{" "}
              <select
                value={orderField}
                onChange={(e) => setOrderField(e.target.value as any)}
                className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="fecha">Fecha</option>
                <option value="caratula">Carátula</option>
                <option value="court">Juzgado / dependencia</option>
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
              No hay sentencias con esos filtros.
            </div>
          ) : (
            pageRows.map((r) => {
              const tone =
                r.resultado === "ganado"
                  ? "ok"
                  : r.resultado === "perdido"
                  ? "bad"
                  : r.resultado === "empatado"
                  ? "mid"
                  : "neutral";

              const isExpanded = !!expandedIds[r.id];
              const resumenCompleto = String(r.resumen ?? "").trim();
              const resumenCorto = resumenPreview(resumenCompleto, 220);
              const showExpandButton =
                resumenCompleto.length > 220 && resumenCompleto !== resumenCorto;

              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[260px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-black text-gray-900 dark:text-gray-100">
                          {r.caratula || "(sin carátula)"}
                        </div>

                        <Badge tone={tone as any}>{resultadoLabel(r.resultado)}</Badge>
                      </div>

                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        Fecha: <span className="font-bold">{formatDateFromSeconds(r.createdAt?.seconds)}</span> ·
                        Jurisdicción: <span className="font-bold">{jurisdiccionLabel(r.jurisdiccion)}</span> ·
                        Fuero: <span className="font-bold">{valueOrDash(r.fuero)}</span>
                      </div>

                      <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                        Juzgado/Dependencia: <span className="font-bold">{valueOrDash(r.court)}</span> ·
                        Nº expte.: <span className="font-bold">{valueOrDash(r.expedienteNumber)}</span>
                      </div>

                      {resumenCompleto ? (
                        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
                          <div className="whitespace-pre-wrap">
                            {isExpanded ? resumenCompleto : resumenCorto}
                          </div>

                          {showExpandButton ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(r.id)}
                              className="mt-2 text-xs font-extrabold underline"
                            >
                              {isExpanded ? "Ver menos" : "Ver más"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2">
                      {r.pdfUrl ? (
                        <a
                          href={r.pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl bg-black px-3 py-2 text-center text-sm font-extrabold text-white hover:opacity-90"
                        >
                          Ver PDF
                        </a>
                      ) : null}

                      {r.caseId ? (
                        <Link
                          href={`/cases/manage/${r.caseId}`}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-center text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                        >
                          Ir a causa
                        </Link>
                      ) : null}
                    </div>
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

      <Modal
        open={statsModalOpen}
        title="Estadísticas de jurisprudencia"
        onClose={() => setStatsModalOpen(false)}
      >
        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Total</div>
              <div className="mt-1 text-lg font-black text-gray-900 dark:text-gray-100">
                {stats.total}
              </div>
            </div>

            <div className="rounded-xl border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <div className="text-xs font-extrabold text-green-700 dark:text-green-300">Ganadas</div>
              <div className="mt-1 text-lg font-black text-green-900 dark:text-green-100">
                {stats.ganadas}
              </div>
            </div>

            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <div className="text-xs font-extrabold text-red-700 dark:text-red-300">Perdidas</div>
              <div className="mt-1 text-lg font-black text-red-900 dark:text-red-100">
                {stats.perdidas}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
              <div className="text-xs font-extrabold text-amber-700 dark:text-amber-300">Empatadas</div>
              <div className="mt-1 text-lg font-black text-amber-900 dark:text-amber-100">
                {stats.empatadas}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Por fuero
              </div>

              <div className="mt-3 grid gap-2">
                {stats.porFuero.length === 0 ? (
                  <div className="text-sm text-gray-600 dark:text-gray-300">Sin datos.</div>
                ) : (
                  stats.porFuero.map(([label, count]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
                    >
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{label}</span>
                      <span className="font-black text-gray-900 dark:text-gray-100">{count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Por jurisdicción
              </div>

              <div className="mt-3 grid gap-2">
                {stats.porJurisdiccion.length === 0 ? (
                  <div className="text-sm text-gray-600 dark:text-gray-300">Sin datos.</div>
                ) : (
                  stats.porJurisdiccion.map(([label, count]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
                    >
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{label}</span>
                      <span className="font-black text-gray-900 dark:text-gray-100">{count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Por año
              </div>

              <div className="mt-3 grid gap-2">
                {stats.porAnio.length === 0 ? (
                  <div className="text-sm text-gray-600 dark:text-gray-300">Sin datos.</div>
                ) : (
                  stats.porAnio.map(([label, count]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-800 dark:bg-gray-800"
                    >
                      <span className="font-semibold text-gray-800 dark:text-gray-100">{label}</span>
                      <span className="font-black text-gray-900 dark:text-gray-100">{count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}