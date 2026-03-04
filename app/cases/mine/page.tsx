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

// Traer TODOS los docs por lotes (paginación)
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

  // auth/shell data
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // page data
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [rows, setRows] = useState<CaseRow[]>([]);
  const [specialtyNameById, setSpecialtyNameById] = useState<Record<string, string>>({});

  // filtros
  const [filterStatus, setFilterStatus] = useState<"all" | "draft" | "assigned">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setLoading(true);
      setMsg(null);

      // rol (para admin tab)
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      // pending invites (para badge en tabs)
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
        // 1) Causas creadas por mí (todas, paginadas)
        const qCreatedBase = query(
          collection(db, "cases"),
          where("broughtByUid", "==", u.uid),
          orderBy("createdAt", "desc")
        );

        // 2) Causas donde estoy confirmado (paginación por __name__)
        // (después ordenamos en memoria por createdAt)
        const qConfirmedBase = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", u.uid),
          orderBy("__name__")
        );

        // 3) Invitaciones donde fui invitado (para traer casos que no estén en 1/2)
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

        // traer causas de invitaciones (por docId del parent)
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

        // ordenar por createdAt desc
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
    >
      {/* Header interno */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Mostrando <span className="font-bold">{filtered.length}</span> de{" "}
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

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-sm font-extrabold text-gray-900 dark:text-gray-100">
          Estado{" "}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as any)}
            className="ml-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
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
          className="min-w-[240px] flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
        />

        <button
          onClick={() => {
            setFilterStatus("all");
            setSearch("");
          }}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          Limpiar
        </button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      {msg ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {!loading && !msg ? (
        <div className="grid gap-3">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
              No tenés causas aún (o no coinciden con el filtro).
            </div>
          ) : (
            filtered.map((r) => {
              const required = Number(r.requiredAssigneesCount ?? 2);
              const confirmed = (r.confirmedAssigneesUids ?? []).length;
              const missing = Math.max(0, required - confirmed);

              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[240px]">
                      <Link
                        href={`/cases/${r.id}`}
                        className="font-black text-gray-900 hover:underline dark:text-gray-100"
                      >
                        {r.caratulaTentativa || "(sin carátula)"}
                      </Link>

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
                      {r.status === "assigned" ? <Badge tone="ok">ASIGNADA</Badge> : <Badge>DRAFT</Badge>}
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
    </AppShell>
  );
}