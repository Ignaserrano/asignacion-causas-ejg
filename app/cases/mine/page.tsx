"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
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
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

type CaseRow = {
  id: string;
  caratulaTentativa: string;
  specialtyId: string;
  jurisdiccion: string;
  status: "draft" | "assigned";
  requiredAssigneesCount?: number;
  confirmedAssigneesUids?: string[];
  createdAt?: { seconds: number };
  broughtByUid?: string;
};

type SpecialtyDoc = { name?: string };

function formatDateFromSeconds(seconds?: number) {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

function badge(text: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {text}
    </span>
  );
}

export default function MyCasesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<CaseRow[]>([]);
  const [specialtyNameById, setSpecialtyNameById] = useState<Record<string, string>>({});

  // filtros (igual que en /cases)
  const [filterStatus, setFilterStatus] = useState<"all" | "draft" | "assigned">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setLoading(true);
      setMsg(null);

      try {
        // 1) Causas creadas por mí
        const qCreated = query(
          collection(db, "cases"),
          where("broughtByUid", "==", u.uid),
          orderBy("createdAt", "desc"),
          limit(50)
        );

        // 2) Causas donde estoy confirmado
        // (no permite orderBy distinto a veces; pedimos sin orderBy para evitar líos de índices)
        const qConfirmed = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", u.uid),
          limit(50)
        );

        // 3) CaseIds donde fui invitado (collectionGroup invites)
        const qInvites = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid)
        );

        const [createdSnap, confirmedSnap, invitesSnap] = await Promise.all([
          getDocs(qCreated),
          getDocs(qConfirmed),
          getDocs(qInvites),
        ]);

        const byId = new Map<string, CaseRow>();

        // helper para meter cases en map
        const addCaseDoc = (id: string, data: any) => {
          byId.set(id, { id, ...(data as any) });
        };

        createdSnap.docs.forEach((d) => addCaseDoc(d.id, d.data()));
        confirmedSnap.docs.forEach((d) => addCaseDoc(d.id, d.data()));

        // traer las causas de los invites (por docId del parent)
        const invitedCaseIds = Array.from(
          new Set(
            invitesSnap.docs
              .map((d) => d.ref.parent.parent?.id ?? "")
              .filter(Boolean)
          )
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

        // ordenar por createdAt desc (si no existe, al final)
        const list = Array.from(byId.values()).sort((a, b) => {
          const as = a.createdAt?.seconds ?? 0;
          const bs = b.createdAt?.seconds ?? 0;
          return bs - as;
        });

        setRows(list);
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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (!s) return true;
      return String(r.caratulaTentativa ?? "").toLowerCase().includes(s);
    });
  }, [rows, filterStatus, search]);

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>Mis causas</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          
                    <a href="/dashboard" style={{ textDecoration: "none", fontWeight: 800 }}>
            Inicio →
          </a>
          
          <a href="/cases" style={{ textDecoration: "none" }}>
            Ver todas →
          </a>
          <a
            href="/cases/new"
            style={{
              display: "inline-block",
              padding: "8px 12px",
              border: "1px solid #ddd",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            + Nueva causa
          </a>
          <a href="/invites" style={{ textDecoration: "none" }}>
            Mis invitaciones →
          </a>
        </div>
      </div>

      <div style={{ marginTop: 10, opacity: 0.8 }}>
        Mostrando {filtered.length} de {rows.length}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 13 }}>
          Estado:{" "}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            style={{ padding: 6, border: "1px solid #ddd" }}
          >
            <option value="all">Todos</option>
            <option value="draft">Draft</option>
            <option value="assigned">Asignada</option>
          </select>
        </label>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por carátula…"
          style={{ padding: 7, border: "1px solid #ddd", minWidth: 260 }}
        />

        <button
          onClick={() => {
            setFilterStatus("all");
            setSearch("");
          }}
          style={{ padding: "7px 10px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
        >
          Limpiar
        </button>
      </div>

      {loading && <div style={{ marginTop: 16 }}>Cargando...</div>}
      {msg && <div style={{ marginTop: 16 }}>⚠️ {msg}</div>}

      {!loading && !msg && (
        <div style={{ marginTop: 16, border: "1px solid #ddd" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 12 }}>No tenés causas aún (o no coinciden con el filtro).</div>
          ) : (
            filtered.map((r) => {
              const required = Number(r.requiredAssigneesCount ?? 2);
              const confirmed = (r.confirmedAssigneesUids ?? []).length;
              const missing = Math.max(0, required - confirmed);

              return (
                <div
                  key={r.id}
                  style={{
                    padding: 12,
                    borderTop: "1px solid #eee",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900 }}>
                      <a href={`/cases/${r.id}`} style={{ textDecoration: "none" }}>
                        {r.caratulaTentativa || "(sin carátula)"}
                      </a>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {r.status === "assigned" ? badge("ASIGNADA") : badge("DRAFT")}
                      {missing > 0 ? (
                        <span style={{ fontSize: 12, opacity: 0.9 }}>
                          faltan {missing} ({confirmed}/{required})
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, opacity: 0.9 }}>
                          completo ({confirmed}/{required})
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    Materia: <b>{specialtyNameById[r.specialtyId] ?? r.specialtyId}</b> · Jurisdicción:{" "}
                    <b>{r.jurisdiccion}</b> · Creada: <b>{formatDateFromSeconds(r.createdAt?.seconds)}</b>
                  </div>

                  <div>
                    <a
                      href={`/cases/${r.id}`}
                      style={{
                        display: "inline-block",
                        marginTop: 2,
                        padding: "6px 10px",
                        border: "1px solid #ddd",
                        textDecoration: "none",
                        fontSize: 13,
                      }}
                    >
                      Ver detalle →
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </main>
  );
}