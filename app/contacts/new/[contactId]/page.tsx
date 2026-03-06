"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  doc,
  getDoc,
  getDocs,
  query,
  where,
  collectionGroup,
  updateDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

export default function ContactEditPage() {
  const params = useParams<{ contactId: string }>();
  const contactId = params.contactId;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState("lawyer");
  const [pendingInvites, setPendingInvites] = useState(0);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [docIdValue, setDocIdValue] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUser(u);

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
    });

    return () => unsub();
  }, [router]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      setMsg(null);

      try {
        const snap = await getDoc(doc(db, "contacts", contactId));
        if (!snap.exists()) {
          setMsg("No existe el contacto.");
          setLoading(false);
          return;
        }
        const data = snap.data() as any;
        setName(String(data?.name ?? ""));
        setDocIdValue(String(data?.docId ?? ""));
        setEmail(String(data?.email ?? ""));
        setPhone(String(data?.phone ?? ""));
        setAddress(String(data?.address ?? ""));
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando contacto");
      } finally {
        setLoading(false);
      }
    })();
  }, [user, contactId]);

  async function save() {
    if (!user) return;
    setMsg(null);

    const n = name.trim();
    if (!n) {
      setMsg("El nombre es obligatorio.");
      return;
    }

    setSaving(true);
    try {
      await updateDoc(doc(db, "contacts", contactId), {
        name: n,
        nameLower: safeLower(n),
        docId: docIdValue.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        updatedAt: serverTimestamp(),
      });
    } catch (e: any) {
      setMsg(e?.message ?? "Error guardando");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar este contacto?")) return;
    try {
      await deleteDoc(doc(db, "contacts", contactId));
      router.replace("/contacts");
    } catch (e: any) {
      setMsg(e?.message ?? "Error eliminando");
    }
  }

  return (
    <AppShell
      title="Editar contacto"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 md:col-span-2">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nombre *</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI/CUIT</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={docIdValue}
                onChange={(e) => setDocIdValue(e.target.value)}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Email</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Teléfono</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>

            <label className="grid gap-1 md:col-span-2">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Domicilio</span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>

            <button
              onClick={save}
              disabled={saving}
              className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50 md:col-span-2"
            >
              Guardar cambios
            </button>

            <button
              onClick={() => router.push("/contacts")}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 md:col-span-2"
            >
              Volver
            </button>

            <button
              onClick={remove}
              className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-extrabold text-red-700 hover:bg-red-50 md:col-span-2"
            >
              Eliminar contacto
            </button>
          </div>
        </div>
      )}
    </AppShell>
  );
}