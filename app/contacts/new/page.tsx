"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { onAuthStateChanged, signOut, User } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import ContactForm, { CreatedContact } from "@/components/contacts/ContactForm";

export default function ContactNewPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState("lawyer");
  const [pendingInvites, setPendingInvites] = useState(0);

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

  function handleSaved(contact: CreatedContact) {
    router.replace(`/contacts/${contact.id}`);
  }

  if (!user) {
    return (
      <AppShell
        title="Nuevo contacto"
        userEmail={user?.email ?? null}
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
      title="Nuevo contacto"
      userEmail={user.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      <ContactForm
        userUid={user.uid}
        onSaved={handleSaved}
        onCancel={() => router.push("/contacts")}
        submitLabel="Guardar contacto"
        cancelLabel="Volver"
      />
    </AppShell>
  );
}