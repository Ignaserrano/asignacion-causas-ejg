"use client";

import Link from "next/link";

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "admin";
}) {
  const cls =
    tone === "warn"
      ? "bg-orange-100 border-orange-300"
      : tone === "admin"
      ? "bg-amber-100 border-amber-300"
      : "bg-gray-100 border-gray-300";

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

import PushNotificationsClient from "@/components/PushNotificationsClient";

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
  
       
  <div className="min-h-dvh bg-white">
    <PushNotificationsClient />
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-[180px]">
            <div className="text-base font-black">{title}</div>
            <div className="mt-0.5 text-xs text-black/60">
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

            {onLogout ? (
            <button
              onClick={onLogout}
              className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-extrabold shadow-sm transition hover:shadow"
            >
              Cerrar sesión
            </button>
          ) : null}
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* Tabs */}
        <nav className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          {tabs.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm font-extrabold text-black/80 hover:bg-gray-50 hover:text-black"
            >
              <span className="inline-flex items-center gap-2">
                {t.label}
                {t.badge ? t.badge : null}
              </span>
            </Link>
          ))}

          {adminTabs.length > 0 ? (
            <>
              <span className="mx-1 my-1 w-px shrink-0 bg-gray-200" />
              {adminTabs.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className="shrink-0 rounded-xl border border-gray-200 px-3 py-2 text-sm font-extrabold text-black/80 hover:bg-gray-50 hover:text-black"
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
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            {children}
          </div>

          <div className="mt-3 text-xs text-black/60">
            Tip: guardá <span className="font-bold">/dashboard</span> como favorito.
          </div>
        </main>

        
      </div>
      
    </div>

    
  );
}