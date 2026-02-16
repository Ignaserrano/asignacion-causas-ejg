"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, User } from "firebase/auth";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/users";

type Specialty = {
  id: string;
  name: string;
  active: boolean;
};

export default function AdminSpecialtiesPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [roleChecked, setRoleChecked] = useState(false);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<Specialty[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // 1) Proteger la ruta: solo admin
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);

      const profile = await getUserProfile(u.uid);
      if (!profile || profile.role !== "admin") {
        router.replace("/dashboard");
        return;
      }
      setRoleChecked(true);
    });

    return () => unsub();
  }, [router]);

  // 2) Suscripción a specialties
  useEffect(() => {
    if (!roleChecked) return;

    const q = query(collection(db, "specialties"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const list: Specialty[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name ?? "",
          active: data.active ?? true,
        };
      });
      setItems(list);
    });

    return () => unsub();
  }, [roleChecked]);

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

  if (!user || !roleChecked) {
    return <main style={{ padding: 16 }}>Cargando...</main>;
  }

  return (
    <main style={{ maxWidth: 820, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>
        Admin · Especialidades
      </h1>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 900 }}>Administrar especialidades</h1>
        <a href="/dashboard" style={{ textDecoration: "none", fontWeight: 700 }}>
          ← Volver al dashboard
        </a>
      </div>

      <form onSubmit={handleAdd} style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej: Derecho de Familia"
          style={{ flex: 1, padding: 10 }}
        />
        <button disabled={saving} style={{ padding: 10, cursor: "pointer" }}>
          {saving ? "Guardando..." : "Agregar"}
        </button>
      </form>

      {msg && (
        <p style={{ marginTop: 10 }}>
          ⚠️ <b>{msg}</b>
        </p>
      )}

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 20 }}>
        Listado
      </h2>

      <ul style={{ marginTop: 8, lineHeight: 1.9 }}>
        {items.map((it) => (
          <li key={it.id}>
            {it.active ? "🟢" : "⚪"} {it.name}
          </li>
        ))}
        {items.length === 0 && <li>No hay especialidades cargadas.</li>}
      </ul>
    </main>
  );
}