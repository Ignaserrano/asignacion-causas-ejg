"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

function CardLink({
  href,
  title,
  subtitle,
  tag,
}: {
  href: string;
  title: string;
  subtitle?: string;
  tag?: string;
}) {
  return (
    <a
      href={href}
      className="group rounded-xl border border-gray-300 bg-white p-4 shadow-sm transition hover:shadow-md"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-base font-black">{title}</div>
        {tag ? (
          <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-black">
            {tag}
          </span>
        ) : null}
      </div>
      {subtitle ? <div className="mt-1 text-sm text-black/70">{subtitle}</div> : null}
      <div className="mt-3 text-sm font-extrabold text-black/70 group-hover:text-black">Abrir →</div>
    </a>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
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

      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));

        const qInv = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const invSnap = await getDocs(qInv);
        setPendingInvites(invSnap.size);
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando dashboard");
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

  const isAdmin = role === "admin";

  return (
    <AppShell
      title="Inicio"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-300 bg-white p-3 text-sm">
          ⚠️ {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="mb-4 rounded-xl border border-gray-300 bg-white p-3 text-sm">
          Cargando...
        </div>
      ) : null}

      <div className="text-sm font-black">Trabajo</div>
      <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <CardLink href="/cases/mine" title="Mis causas" subtitle="Causas donde participo o que creé" />
        <CardLink
          href="/invites"
          title="Mis invitaciones"
          subtitle={pendingInvites > 0 ? `Tenés ${pendingInvites} pendientes` : "No tenés pendientes"}
          tag={pendingInvites > 0 ? "PENDIENTES" : undefined}
        />
        <CardLink href="/cases/new" title="Agregar nueva causa" subtitle="Cargar una causa y enviar invitaciones" />
        <CardLink href="/specialties" title="Mis especialidades" subtitle="Ver tus especialidades" />
      </div>

      {isAdmin ? (
        <>
          <div className="mt-8 text-sm font-black">Administración</div>
          <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
            <CardLink
              href="/admin/lawyers"
              title="Administrar abogados"
              subtitle="Crear/editar abogados, estado y especialidades"
              tag="ADMIN"
            />
            <CardLink
              href="/admin/specialties"
              title="Administrar especialidades"
              subtitle="Crear/editar/activar especialidades"
              tag="ADMIN"
            />
          </div>
        </>
      ) : null}
    </AppShell>
  );
}