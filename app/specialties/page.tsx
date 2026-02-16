"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type MySpec = { id: string; name: string };

export default function MySpecialtiesPage() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [list, setList] = useState<MySpec[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setLoading(true);
      setMsg(null);

      try {
        // 1) leer ids desde el perfil
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? (snap.data() as any) : {};
        const ids: string[] = Array.isArray(data?.specialties) ? data.specialties : [];

        if (ids.length === 0) {
          setList([]);
          setMsg("Tus especialidades: (vacío)");
          return;
        }

        // 2) resolver nombres en /specialties/{id}
        const resolved: MySpec[] = await Promise.all(
          ids.map(async (id) => {
            const sSnap = await getDoc(doc(db, "specialties", String(id)));
            if (!sSnap.exists()) return { id: String(id), name: `(desconocida: ${id})` };
            const sData = sSnap.data() as any;
            return { id: sSnap.id, name: String(sData?.name ?? sSnap.id) };
          })
        );

        // opcional: ordenar alfabéticamente por nombre
        resolved.sort((a, b) => a.name.localeCompare(b.name));

        setList(resolved);
        setMsg(null);
      } catch (e: any) {
        setMsg(e?.message ?? "Error leyendo tus especialidades");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 900 }}>Mis especialidades</h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a href="/dashboard" style={{ textDecoration: "none", fontWeight: 700 }}>
            ← Volver al inicio
          </a>
          <a href="/cases/mine" style={{ textDecoration: "none" }}>
            Mis causas →
          </a>
        </div>
      </div>

      {msg && <div style={{ marginTop: 16, opacity: 0.9 }}>⚠️ {msg}</div>}

      {loading ? (
        <div style={{ marginTop: 16, opacity: 0.85 }}>Cargando...</div>
      ) : list.length === 0 ? (
        <div style={{ marginTop: 16, opacity: 0.85 }}>No tenés especialidades asignadas.</div>
      ) : (
        <div style={{ marginTop: 16, border: "1px solid #ddd" }}>
          {list.map((s) => (
            <div
              key={s.id}
              style={{
                padding: 12,
                borderTop: "1px solid #eee",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ fontWeight: 900 }}>{s.name}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{s.id}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, fontSize: 13, opacity: 0.75 }}>
        (Más adelante podemos permitir edición si corresponde.)
      </div>
    </main>
  );
}