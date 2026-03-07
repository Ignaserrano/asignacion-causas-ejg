"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { onAuthStateChanged, signOut, User } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import ContactForm, {
  ContactFormInitialValues,
  ContactType,
  CreatedContact,
  CivilStatus,
  PersonType,
} from "@/components/contacts/ContactForm";

function normalizeText(value: any) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeContactType(value: any): ContactType {
  const v = normalizeText(value);
  if (
    v === "cliente" ||
    v === "abogado_contraria" ||
    v === "demandado" ||
    v === "conciliador" ||
    v === "perito" ||
    v === "otro"
  ) {
    return v;
  }
  return "cliente";
}

function normalizeCivilStatus(value: any): CivilStatus {
  const v = normalizeText(value);
  if (
    v === "soltero" ||
    v === "casado" ||
    v === "divorciado" ||
    v === "viudo" ||
    v === "separado_hecho" ||
    v === "concubinato"
  ) {
    return v;
  }
  return "soltero";
}

function inferPersonType(data: any): PersonType {
  const raw = normalizeText(data?.personType);

  if (
    raw === "juridica" ||
    raw === "persona juridica" ||
    raw === "persona_juridica" ||
    raw === "empresa" ||
    raw === "sociedad"
  ) {
    return "juridica";
  }

  if (raw === "fisica" || raw === "persona fisica") {
    return "fisica";
  }

  const hasLastName = String(data?.lastName ?? "").trim() !== "";
  const hasBirthDate = String(data?.birthDate ?? "").trim() !== "";
  const hasDni = String(data?.dni ?? "").trim() !== "";
  const hasNationality = String(data?.nationality ?? "").trim() !== "";

  if (hasLastName || hasBirthDate || hasDni || hasNationality) {
    return "fisica";
  }

  return "juridica";
}

export default function ContactEditPage() {
  const router = useRouter();
  const params = useParams();
  const rawContactId = params?.contactId;
  const contactId = Array.isArray(rawContactId) ? rawContactId[0] : rawContactId;

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState("lawyer");
  const [pendingInvites, setPendingInvites] = useState(0);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<ContactFormInitialValues | null>(null);
  const [deleting, setDeleting] = useState(false);

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

      if (!contactId || typeof contactId !== "string") {
        setMsg("ID de contacto inválido.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setMsg(null);

      try {
        const snap = await getDoc(doc(db, "contacts", contactId));

        if (!snap.exists()) {
          setMsg("No existe el contacto.");
          setInitialValues(null);
          setLoading(false);
          return;
        }

        const data = snap.data() as any;
        const personType = inferPersonType(data);

        setInitialValues({
          type: normalizeContactType(data?.type),
          personType,
          name: String(data?.name ?? ""),
          lastName: personType === "juridica" ? "" : String(data?.lastName ?? ""),
          nationality: personType === "juridica" ? "" : String(data?.nationality ?? ""),
          address: String(data?.address ?? ""),
          dni: personType === "juridica" ? "" : String(data?.dni ?? ""),
          cuit: String(data?.cuit ?? ""),
          birthDate: personType === "juridica" ? "" : String(data?.birthDate ?? ""),
          civilStatus:
            personType === "juridica" ? "soltero" : normalizeCivilStatus(data?.civilStatus),
          marriageCount: personType === "juridica" ? "" : String(data?.marriageCount ?? ""),
          spouseName: personType === "juridica" ? "" : String(data?.spouseName ?? ""),
          phone: String(data?.phone ?? ""),
          email: String(data?.email ?? ""),
          referredBy: String(data?.referredBy ?? ""),
          notes: String(data?.notes ?? ""),
          tuition: String(data?.tuition ?? ""),
          conciliationArea: String(data?.conciliationArea ?? ""),
          specialtyArea: String(data?.specialtyArea ?? ""),
        });
      } catch (e: any) {
        console.error("Error cargando contacto:", e);
        setMsg(e?.message ?? "Error cargando contacto.");
        setInitialValues(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [user, contactId]);

  function handleSaved(_contact: CreatedContact) {
    router.replace("/contacts");
  }

  async function handleDelete() {
    if (!contactId || typeof contactId !== "string") {
      setMsg("ID de contacto inválido.");
      return;
    }

    const ok = confirm("¿Eliminar este contacto? Esta acción no se puede deshacer.");
    if (!ok) return;

    setDeleting(true);
    setMsg(null);

    try {
      await deleteDoc(doc(db, "contacts", contactId));
      router.replace("/contacts");
    } catch (e: any) {
      console.error("Error eliminando contacto:", e);
      setMsg(e?.message ?? "Error eliminando contacto.");
    } finally {
      setDeleting(false);
    }
  }

  if (!user) {
    return (
      <AppShell
        title="Editar contacto"
        userEmail={null}
        role={role}
        pendingInvites={pendingInvites}
        onLogout={doLogout}
      >
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Editar contacto"
      userEmail={user.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loading || !initialValues ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : (
        <div className="grid gap-3">
          <ContactForm
            key={`${contactId}-${initialValues.type}-${initialValues.personType}`}
            userUid={user.uid}
            mode="edit"
            contactId={contactId}
            initialValues={initialValues}
            onSaved={handleSaved}
            onCancel={() => router.push("/contacts")}
            submitLabel="Guardar cambios"
            cancelLabel="Volver"
          />

          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-extrabold text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Eliminando..." : "Eliminar contacto"}
          </button>
        </div>
      )}
    </AppShell>
  );
}