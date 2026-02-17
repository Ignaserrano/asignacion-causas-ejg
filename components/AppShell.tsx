"use client";

import Link from "next/link";
import PushNotificationsClient from "@/components/PushNotificationsClient";
import InstallButton from "@/components/InstallButton";

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "admin";
}) {
  const cls =
    tone === "warn"
      ? "bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-100"
      : tone === "admin"
      ? "bg-amber-100 border-amber-300 text-amber-900 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-100"
      : "bg-gray-100 border-gray-300 text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-black ${cls}`}
    >
      {children}
    </span>
  );
}

type Tab = {
  href: string;
  label: string;
  badge?: React.ReactNode;
};

export default function AppShell({
  title,
  subtitle,
  userEmail,
  role,
  pendingInvites,
  onLogout,
  children,
}: {
  title: string;
  subtitle?: string;
  userEmail?: string | null;
  role?: string;
  pendingInvites?: number;
  onLogout?: () => void;
  children: React.ReactNode;
}) {
  const isAdmin = role === "admin";
  const invitesCount = pendingInvites ?? 0;

  const tabs: Tab[] = [
    { href: "/dashboard", label: "Inicio" },
    { href: "/cases/mine", label: "Mis causas" },
    {
      href: "/invites",
      label: "Invitaciones",
      badge: invitesCount > 0 ? <Badge tone="warn">{invitesCount}</Badge> : undefined,
    },
    { href: "/cases/new", label: "Nueva causa" },
    { href: "/specialties", label: "Especialidades" },
  ];

  const adminTabs: Tab[] = isAdmin
    ? [
        { href: "/admin/lawyers", label: "Admin abogados" },
        { href: "/admin/specialties", label: "Admin especialidades" },
      ]
    : [];

  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <PushNotificationsClient />

      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
        

        
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          
          <div className="min-w-[180px]">
            <div className="text-base font-black text-gray-900 dark:text-gray-100">
              {title}
            </div>

            <div className="mt-0.5 text-xs text-gray-600 dark:text-gray-300">
              {subtitle ? (
                subtitle
              ) : userEmail ? (
                <>
                  Logueado como <span className="font-bold">{userEmail}</span>
                </>
              ) : null}

              {isAdmin ? (
                <span className="ml-2 align-middle">
                  <Badge tone="admin">ADMIN</Badge>
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
  <InstallButton />

  {onLogout ? (
    <button
      onClick={onLogout}
      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-extrabold shadow-sm transition hover:shadow hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
    >
      Cerrar sesión
    </button>
  ) : null}
</div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Tabs */}
        <nav className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              <span className="inline-flex items-center gap-2">
                {t.label}
                {t.badge ? t.badge : null}
              </span>
            </Link>
          ))}

          {adminTabs.length > 0 ? (
            <>
              <span className="mx-1 my-1 w-px shrink-0 bg-gray-200 dark:bg-gray-800" />
              {adminTabs.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-white"
                >
                  <span className="inline-flex items-center gap-2">
                    {t.label}
                    <Badge tone="admin">ADMIN</Badge>
                  </span>
                </Link>
              ))}
            </>
          ) : null}
        </nav>

        {/* Content */}
        <main className="min-w-0">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            {children}
          </div>

          <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
            Tip: guardá <span className="font-bold">/dashboard</span> como favorito.
          </div>
        </main>
      </div>
    </div>
  );
}