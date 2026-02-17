"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
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
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

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

type SpecialtyDoc = { name?: string; active?: boolean };
type UserDoc = { email?: string };

const PAGE_SIZE = 25;

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

function pill(text: string, bg = "#f8f9fa") {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontSize: 12,
        fontWeight: 900,
        background: bg,
      }}
    >
      {text}
    </span>
  );
}

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export default function CasesAllPage() {
  const router = useRouter();

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
    if (filterSpecialtyId !== "all") qAny = query(qAny, where("specialtyId", "==", filterSpecialtyId));
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
    // Sin aggregation count() por compatibilidad; hacemos un scan por páginas.
    // (Funciona bien para volúmenes chicos/medios. Si crece mucho, lo pasamos a Cloud Function + count.)
    let qAny: any = collection(db, "cases");

    if (filterStatus !== "all") qAny = query(qAny, where("status", "==", filterStatus));
    if (filterJur !== "all") qAny = query(qAny, where("jurisdiccion", "==", filterJur));
    if (filterSpecialtyId !== "all") qAny = query(qAny, where("specialtyId", "==", filterSpecialtyId));
    if (creatorUidFilter) qAny = query(qAny, where("broughtByUid", "==", creatorUidFilter));

    // Para contar, no importa orden, pero Firestore lo requiere si luego paginás; igual lo dejamos consistente
    qAny = query(qAny, orderBy("createdAt", "desc"));

    let count = 0;
   let cursor: QueryDocumentSnapshot<DocumentData, DocumentData> | null = null;

    // page scan 500 max por seguridad (evitar loops infinitos)
    for (let i = 0; i < 500; i++) {
      let qPage: any = qAny;
      if (cursor) qPage = query(qPage, startAfter(cursor));
      qPage = query(qPage, limit(500)); // chunk grande para contar más rápido
      const snap = await getDocs(qPage);
      count += snap.size;
      if (snap.size < 500) break;
cursor = snap.docs[snap.docs.length - 1] as unknown as QueryDocumentSnapshot<DocumentData, DocumentData>;
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

      // Pre-cargar emails del creador de esta página
      const uids = Array.from(new Set(rows.map((r) => r.broughtByUid).filter(Boolean)));
      const missingUids = uids.filter((u) => !emailByUid[u]);

      if (missingUids.length) {
        const newMap = { ...emailByUid };
        await Promise.all(
          missingUids.map(async (uid) => {
            try {
              const uSnap = await getDoc(doc(db, "users", uid));
              const email = uSnap.exists() ? String((uSnap.data() as any)?.email ?? "") : "";
              newMap[uid] = email || uid;
            } catch {
              newMap[uid] = uid;
            }
          })
        );
        setEmailByUid(newMap);
      }

      // Pre-cargar especialidades de esta página
      const spIds = Array.from(new Set(rows.map((r) => r.specialtyId).filter(Boolean)));
      const missingSp = spIds.filter((id) => !specialtyNameById[id]);

      if (missingSp.length) {
        const spMap = { ...specialtyNameById };
        await Promise.all(
          missingSp.map(async (id) => {
            try {
              const spSnap = await getDoc(doc(db, "specialties", id));
              spMap[id] = spSnap.exists() ? String((spSnap.data() as any)?.name ?? "(sin nombre)") : "(no encontrada)";
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

  // ------------ init auth + load specialties options ------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      // opciones de especialidades (para filtro)
      try {
        const spSnap = await getDocs(query(collection(db, "specialties"), orderBy("name", "asc")));
        setSpecialtiesOptions(
          spSnap.docs.map((d) => ({ id: d.id, name: String((d.data() as any)?.name ?? d.id) }))
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

  // ------------ when filters/order change: reset pagination ------------
  useEffect(() => {
    (async () => {
      // Si el filtro por creador es email, resolvemos uid exacto
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
    // Re-cargar cuando cambian filtros/orden (incluye creatorUidFilter)
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

  const canNext = useMemo(() => {
    // si mostramos menos de PAGE_SIZE, no hay próxima
    return pageRows.length === PAGE_SIZE;
  }, [pageRows.length]);

  const creatorEmailShown = (uid: string) => emailByUid[uid] ?? uid;

  async function nextPage() {
    if (!canNext || !lastDoc) return;
    setPrevStack((s) => [...s, lastDoc]);
    setPage((p) => p + 1);
    await loadPage(false);
  }

  async function prevPage() {
    if (page <= 1) return;
    // Para volver: rehacemos la query desde el principio hasta el cursor anterior (stack)
    const newStack = [...prevStack];
    newStack.pop(); // quitamos la actual
    const prevCursor = newStack.length ? newStack[newStack.length - 1] : null;

    setPrevStack(newStack);
    setPage((p) => Math.max(1, p - 1));
    setLastDoc(prevCursor);

    // recargar desde el cursor anterior real
    setLoading(true);
    setMsg(null);
    try {
      // para “prev” reconstruimos desde cursor anterior:
      // si prevCursor es null => page 1
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
    <main style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      {/* Nav / flujo */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Todas las causas</h1>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/dashboard" style={{ textDecoration: "none", fontWeight: 800 }}>
            Inicio →
          </a>
          <a href="/cases/new" style={{ textDecoration: "none", fontWeight: 800 }}>
            + Nueva causa
          </a>
          <a href="/cases/mine" style={{ textDecoration: "none", fontWeight: 800 }}>
            Mis causas →
          </a>
          <a href="/invites" style={{ textDecoration: "none", fontWeight: 800 }}>
            Mis invitaciones →
          </a>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.85, fontSize: 13 }}>
        Mostrando <b>{showingText.shown}</b> en esta página · Total: <b>{total}</b>{" "}
        {total > 0 ? (
          <span>
            · Rango: <b>{showingText.start}</b>–<b>{showingText.end}</b>
          </span>
        ) : null}
      </div>

      {/* filtros / orden */}
      <div
        style={{
          marginTop: 12,
          border: "1px solid #ddd",
          padding: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>
            Estado:{" "}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              style={{ padding: 6, border: "1px solid #ddd" }}
            >
              <option value="all">Todos</option>
              <option value="draft">Pendiente</option>
              <option value="assigned">Asignada</option>
            </select>
          </label>

          <label style={{ fontSize: 13 }}>
            Jurisdicción:{" "}
            <select
              value={filterJur}
              onChange={(e) => setFilterJur(e.target.value)}
              style={{ padding: 6, border: "1px solid #ddd" }}
            >
              <option value="all">Todas</option>
              <option value="nacional">Nacional</option>
              <option value="federal">Federal</option>
              <option value="caba">CABA</option>
              <option value="provincia_bs_as">Provincia Bs. As.</option>
            </select>
          </label>

          <label style={{ fontSize: 13 }}>
            Materia:{" "}
            <select
              value={filterSpecialtyId}
              onChange={(e) => setFilterSpecialtyId(e.target.value)}
              style={{ padding: 6, border: "1px solid #ddd", minWidth: 240 }}
            >
              <option value="all">Todas</option>
              {specialtiesOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 13 }}>
            Creador (email exacto):{" "}
            <input
              value={filterCreatorEmail}
              onChange={(e) => setFilterCreatorEmail(e.target.value)}
              placeholder="ej: abogado@estudio.com"
              style={{ padding: 7, border: "1px solid #ddd", minWidth: 240 }}
            />
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>
            Ordenar por:{" "}
            <select
              value={orderField}
              onChange={(e) => setOrderField(e.target.value as any)}
              style={{ padding: 6, border: "1px solid #ddd" }}
            >
              <option value="createdAt">Fecha de creación</option>
              <option value="caratulaTentativa">Carátula</option>
            </select>
          </label>

          <label style={{ fontSize: 13 }}>
            Dirección:{" "}
            <select
              value={orderDir}
              onChange={(e) => setOrderDir(e.target.value as any)}
              style={{ padding: 6, border: "1px solid #ddd" }}
            >
              <option value="desc">Descendente</option>
              <option value="asc">Ascendente</option>
            </select>
          </label>

          <button
            onClick={resetFilters}
            style={{ padding: "7px 10px", border: "1px solid #ddd", background: "white", cursor: "pointer", fontWeight: 800 }}
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {loading && <div style={{ marginTop: 16 }}>Cargando...</div>}
      {msg && <div style={{ marginTop: 16 }}>⚠️ {msg}</div>}

      {/* tabla/listado */}
      {!loading && !msg && (
        <div style={{ marginTop: 16, border: "1px solid #ddd" }}>
          {pageRows.length === 0 ? (
            <div style={{ padding: 12, opacity: 0.85 }}>No hay causas con esos filtros.</div>
          ) : (
            pageRows.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: 12,
                  borderTop: "1px solid #eee",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>
                    {r.caratulaTentativa || "(sin carátula)"}{" "}
                    <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 12 }}>
                      (#{r.id})
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    {r.status === "assigned" ? pill("ASIGNADA", "#d4edda") : pill("PENDIENTE", "#f8f9fa")}
                  </div>
                </div>

                <div style={{ fontSize: 13, opacity: 0.9, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>
                    Materia: <b>{specialtyNameById[r.specialtyId] ?? r.specialtyId ?? "-"}</b>
                  </span>
                  <span>
                    Jurisdicción: <b>{r.jurisdiccion || "-"}</b>
                  </span>
                  <span>
                    Creada: <b>{formatDateFromSeconds(r.createdAtSec)}</b>
                  </span>
                  <span>
                    Creador: <b>{creatorEmailShown(r.broughtByUid)}</b>
                  </span>
                </div>

                <div>
                  <a
                    href={`/cases/${r.id}`}
                    style={{
                      display: "inline-block",
                      padding: "6px 10px",
                      border: "1px solid #ddd",
                      textDecoration: "none",
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    Ver detalle →
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* paginación */}
      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          disabled={page <= 1}
          onClick={prevPage}
          style={{
            padding: "7px 10px",
            border: "1px solid #ddd",
            background: "white",
            cursor: page <= 1 ? "not-allowed" : "pointer",
            fontWeight: 800,
          }}
        >
          ← Anterior
        </button>

        <div style={{ fontSize: 13 }}>
          Página <b>{page}</b>
        </div>

        <button
          disabled={!canNext}
          onClick={nextPage}
          style={{
            padding: "7px 10px",
            border: "1px solid #ddd",
            background: "white",
            cursor: !canNext ? "not-allowed" : "pointer",
            fontWeight: 800,
          }}
        >
          Siguiente →
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
        Nota: el filtro “Creador” funciona por <b>email exacto</b> (por ahora).
      </div>
    </main>
  );
}