"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

type MySpec = { id: string; name: string };

export default function MySpecialtiesPage() {
  const router = useRouter();

  // shell
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // page
  const [msg, setMsg] = useState<string | null>(null);
  const [list, setList] = useState<MySpec[]>([]);
  const [loading, setLoading] = useState(true);

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

      // pending invites para tabs
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
        // 1) leer ids desde el perfil
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? (snap.data() as any) : {};
        const ids: string[] = Array.isArray(data?.specialties) ? data.specialties : [];

        if (ids.length === 0) {
          setList([]);
          setMsg(null);
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

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Mis especialidades"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Estas son las especialidades que tenés asignadas en tu perfil.
        </div>
      </div>

      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          No tenés especialidades asignadas.
        </div>
      ) : (
        <div className="grid gap-3">
          {list.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-black text-gray-900 dark:text-gray-100">{s.name}</div>
                <div className="text-xs font-semibold text-gray-600 dark:text-gray-400">{s.id}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 text-xs text-gray-600 dark:text-gray-400">
        (Más adelante podemos permitir edición si corresponde.)
      </div>
    </AppShell>
  );
}