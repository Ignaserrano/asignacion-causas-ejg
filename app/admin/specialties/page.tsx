"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/users";
import AppShell from "@/components/AppShell";

type Specialty = {
  id: string;
  name: string;
  active: boolean;
  createdAtSec?: number;
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-black">
      {children}
    </span>
  );
}

export default function AdminSpecialtiesPage() {
  const router = useRouter();

  // shell
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // auth/role gate
  const [roleChecked, setRoleChecked] = useState(false);

  // form
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  // list
  const [items, setItems] = useState<Specialty[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // --- 1) proteger ruta: solo admin + datos para AppShell
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);

      // role (por AppShell)
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      // pending invites (por AppShell tabs)
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

      // gate admin (tu lógica actual)
      const profile = await getUserProfile(u.uid);
      if (!profile || profile.role !== "admin") {
        router.replace("/dashboard");
        return;
      }

      setRoleChecked(true);
    });

    return () => unsub();
  }, [router]);

  // --- 2) suscripción a specialties
  useEffect(() => {
    if (!roleChecked) return;

    const qSp = query(collection(db, "specialties"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(qSp, (snap) => {
      const list: Specialty[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: String(data?.name ?? ""),
          active: data?.active !== false,
          createdAtSec: Number(data?.createdAt?.seconds ?? 0),
        };
      });
      setItems(list);
    });

    return () => unsub();
  }, [roleChecked]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setMsg("Escribí un nombre.");
      return;
    }

    setSaving(true);
    try {
      await addDoc(collection(db, "specialties"), {
        name: trimmed,
        active: true,
        createdAt: serverTimestamp(),
      });
      setName("");
    } catch (e: any) {
      setMsg("Error guardando: " + (e?.message ?? "desconocido"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(it: Specialty) {
    setMsg(null);
    try {
      await updateDoc(doc(db, "specialties", it.id), { active: !it.active });
    } catch (e: any) {
      setMsg(e?.message ?? "Error actualizando estado");
    }
  }

  const counts = useMemo(() => {
    const active = items.filter((x) => x.active).length;
    const inactive = items.length - active;
    return { active, inactive };
  }, [items]);

  // gate visual
  if (!user || !roleChecked) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">Cargando...</div>
      </main>
    );
  }

  return (
    <AppShell
      title="Administrar especialidades"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-black/70">
          <span className="font-black">Especialidades</span> disponibles para asignación.
        </div>


      </div>

      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm">⚠️ {msg}</div>
      ) : null}

      {/* Agregar */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-black">Agregar especialidad</div>

        <form onSubmit={handleAdd} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-2">
            <span className="text-sm font-extrabold">Nombre</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Derecho de Familia"
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
            />
          </label>

          <button
            disabled={saving}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold shadow-sm hover:bg-gray-50 disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Agregar"}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap gap-2">
          <Chip>Total: {items.length}</Chip>
          <Chip>Activas: {counts.active}</Chip>
          <Chip>Inactivas: {counts.inactive}</Chip>
        </div>
      </div>

      {/* Listado */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-4">
          <div className="text-sm font-black">Listado</div>
        </div>

        {items.length === 0 ? (
          <div className="p-4 text-sm text-black/70">No hay especialidades cargadas.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((it) => (
              <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-[240px]">
                  <div className="font-black">{it.name}</div>
                  <div className="mt-1 text-xs text-black/60">{it.id}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {it.active ? <Chip>🟢 activa</Chip> : <Chip>⚪ inactiva</Chip>}

                  <button
                    onClick={() => toggleActive(it)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50"
                  >
                    {it.active ? "Desactivar" : "Activar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}