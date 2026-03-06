"use client";

import { useEffect, useMemo, useState } from "react";
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

type PersonType = "fisica" | "juridica";

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function buildFullName(personType: PersonType, name: string, lastName: string) {
  if (personType === "juridica") {
    return String(name ?? "").trim();
  }
  return `${String(name ?? "").trim()} ${String(lastName ?? "").trim()}`.trim();
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

  const [personType, setPersonType] = useState<PersonType>("fisica");
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
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

        const storedPersonType =
          String(data?.personType ?? "").trim() === "juridica" ? "juridica" : "fisica";

        setPersonType(storedPersonType);
        setName(String(data?.name ?? ""));
        setLastName(String(data?.lastName ?? ""));
        setDocIdValue(
          String(data?.docId ?? data?.dni ?? data?.cuit ?? "")
        );
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

  useEffect(() => {
    if (personType === "juridica") {
      setLastName("");
    }
  }, [personType]);

  const fullName = useMemo(
    () => buildFullName(personType, name, lastName),
    [personType, name, lastName]
  );

  async function save() {
    if (!user) return;
    setMsg(null);

    const n = name.trim();
    const ln = lastName.trim();

    if (!n) {
      setMsg(personType === "juridica" ? "La razón social es obligatoria." : "El nombre es obligatorio.");
      return;
    }

    if (personType === "fisica" && !ln) {
      setMsg("El apellido es obligatorio.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        personType,
        name: n,
        lastName: personType === "fisica" ? ln : "",
        fullName: fullName.trim(),
        nameLower: safeLower(fullName),
        docId: docIdValue.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        updatedAt: serverTimestamp(),
      };

      if (personType === "fisica") {
        payload.dni = docIdValue.trim();
      } else {
        payload.cuit = docIdValue.trim();
        payload.dni = "";
      }

      await updateDoc(doc(db, "contacts", contactId), payload);
      setMsg("Cambios guardados.");
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
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo de persona</span>
              <select
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={personType}
                onChange={(e) => setPersonType(e.target.value as PersonType)}
              >
                <option value="fisica">Persona física</option>
                <option value="juridica">Persona jurídica</option>
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                {personType === "juridica" ? "Nombre / Razón social *" : "Nombre *"}
              </span>
              <input
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            {personType === "fisica" ? (
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Apellido *</span>
                <input
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </label>
            ) : (
              <div />
            )}

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                {personType === "fisica" ? "DNI/CUIT" : "CUIT"}
              </span>
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