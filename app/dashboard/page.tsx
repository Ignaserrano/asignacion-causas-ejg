"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import {
  IconCases,
  IconInvites,
  IconNewCase,
  IconSpecialties,
} from "@/components/DashboardIcons";

async function exportExcel() {
  const fn = httpsCallable(functions, "adminExportCasesExcel");
  const res: any = await fn();

  const link = document.createElement("a");
  link.href =
    "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
    res.data.base64;
  link.download = res.data.fileName;
  link.click();
}

function CardLink({
  href,
  title,
  subtitle,
  tag,
  icon,
}: {
  href: string;
  title: string;
  subtitle?: string;
  tag?: string;
  icon?: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md
                 dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="text-base font-black text-gray-900 dark:text-gray-100">{title}</div>

            {tag ? (
              <span
                className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-black text-gray-900
                           dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {tag}
              </span>
            ) : null}
          </div>

          {subtitle ? (
            <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">{subtitle}</div>
          ) : null}
        </div>

        {/* Icono a la derecha del texto */}
        {icon ? (
          <div
            className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-2 text-gray-700 transition
                       group-hover:bg-gray-100 group-hover:text-gray-900
                       dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200 dark:group-hover:bg-gray-700 dark:group-hover:text-white"
            aria-hidden="true"
          >
            {icon}
          </div>
        ) : null}
      </div>
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
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="text-sm font-black text-gray-900 dark:text-gray-100">Trabajo</div>
      <div className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <CardLink
          href="/cases/mine"
          title="Mis causas"
          subtitle="Causas donde participo o que creé"
          icon={<IconCases className="h-5 w-5" />}
        />
        <CardLink
          href="/invites"
          title="Mis invitaciones"
          subtitle={pendingInvites > 0 ? `Tenés ${pendingInvites} pendientes` : "No tenés pendientes"}
          tag={pendingInvites > 0 ? "PENDIENTES" : undefined}
          icon={<IconInvites className="h-5 w-5" />}
        />
        <CardLink
          href="/cases/new"
          title="Agregar nueva causa"
          subtitle="Cargar una causa y enviar invitaciones"
          icon={<IconNewCase className="h-5 w-5" />}
        />
        <CardLink
          href="/specialties"
          title="Mis especialidades"
          subtitle="Ver tus especialidades"
          icon={<IconSpecialties className="h-5 w-5" />}
        />
      </div>

      {isAdmin ? (
        <>
          <div className="mt-8 text-sm font-black text-gray-900 dark:text-gray-100">Administración</div>
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

            {role === "admin" && (
              <button
                onClick={exportExcel}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm font-extrabold shadow-sm hover:bg-gray-50
                           dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              >
                Exportar Excel de causas
              </button>
            )}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}