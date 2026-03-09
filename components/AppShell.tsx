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
  icon?: React.ReactNode;
  iconOnly?: boolean;
};

type BreadcrumbItem = {
  label: string;
  href?: string;
};

function IconHome({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V20a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 20v-9.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 21V14h5v7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPlusDoc({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 21h6m-8-3h10a2 2 0 0 0 2-2V8.5a2 2 0 0 0-.59-1.41l-2.5-2.5A2 2 0 0 0 14.5 4H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 11v6m-3-3h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBriefcase({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 7V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M4 8h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconManage({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 21h6m-8-3h10a2 2 0 0 0 2-2V8.5a2 2 0 0 0-.59-1.41l-2.5-2.5A2 2 0 0 0 14.5 4H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M8 11h8M8 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconContacts({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16 3H8a2 2 0 0 0-2 2v16l2.5-1.6c.32-.2.72-.2 1.04 0L12 21l2.46-1.6c.32-.2.72-.2 1.04 0L18 21V5a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 8a2 2 0 1 0 0 4a2 2 0 0 0 0-4Z" stroke="currentColor" strokeWidth="2" />
      <path
        d="M8.8 16c.7-1.3 1.9-2 3.2-2s2.5.7 3.2 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconInvites({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m5 8 7 5 7-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function IconSpecialties({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4h12v16H6V4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TabLink({ t }: { t: Tab }) {
  const common =
    "shrink-0 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-gray-900 " +
    "dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800 dark:hover:text-white";

  if (t.icon && t.iconOnly) {
    return (
      <Link
        key={t.href}
        href={t.href}
        title={t.label}
        aria-label={t.label}
        className={`${common} px-3 py-2`}
      >
        <span className="inline-flex items-center gap-2">
          {t.icon}
          {t.badge ? t.badge : null}
        </span>
      </Link>
    );
  }

  return (
    <Link key={t.href} href={t.href} className={`${common} px-3 py-2 text-sm font-extrabold`}>
      <span className="inline-flex items-center gap-2">
        {t.label}
        {t.badge ? t.badge : null}
      </span>
    </Link>
  );
}

function Breadcrumbs({ items }: { items?: BreadcrumbItem[] }) {
  if (!items || items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div className="flex flex-wrap items-center gap-2 text-gray-600 dark:text-gray-300">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;

          return (
            <div key={`${item.label}-${idx}`} className="inline-flex items-center gap-2">
              {idx > 0 ? <span className="text-gray-400 dark:text-gray-500">›</span> : null}

              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="font-semibold hover:text-gray-900 hover:underline dark:hover:text-gray-100"
                >
                  {item.label}
                </Link>
              ) : (
                <span className={isLast ? "font-black text-gray-900 dark:text-gray-100" : "font-semibold"}>
                  {item.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

export default function AppShell({
  title,
  subtitle,
  userEmail,
  role,
  pendingInvites,
  onLogout,
  breadcrumbs,
  children,
}: {
  title: string;
  subtitle?: string;
  userEmail?: string | null;
  role?: string;
  pendingInvites?: number;
  onLogout?: () => void;
  breadcrumbs?: BreadcrumbItem[];
  children: React.ReactNode;
}) {
  const isAdmin = role === "admin";
  const invitesCount = pendingInvites ?? 0;

  const iconTabs: Tab[] = [
    { href: "/cases/new", label: "Nueva causa", icon: <IconPlusDoc />, iconOnly: true },
    { href: "/cases/mine", label: "Mis causas", icon: <IconBriefcase />, iconOnly: true },
    { href: "/cases/manage", label: "Gestión de causas", icon: <IconManage />, iconOnly: true },
    { href: "/contacts", label: "Agenda de contactos", icon: <IconContacts />, iconOnly: true },
    {
      href: "/invites",
      label: "Invitaciones",
      icon: <IconInvites />,
      iconOnly: true,
      badge: invitesCount > 0 ? <Badge tone="warn">{invitesCount}</Badge> : undefined,
    },
    { href: "/specialties", label: "Especialidades", icon: <IconSpecialties />, iconOnly: true },
    {
      href: "/cobranzas",
      label: "Cobros",
      icon: (
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
          <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2" />
          <path d="M8 11h8" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      iconOnly: true,
    },
  ];

  const textTabs: Tab[] = [{ href: "/dashboard", label: "Inicio", icon: <IconHome /> }];

  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <PushNotificationsClient />

      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-[180px]">
            <div className="text-base font-black text-gray-900 dark:text-gray-100">{title}</div>

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
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-extrabold shadow-sm transition hover:bg-gray-50 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
              >
                Cerrar sesión
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <nav className="mb-4 flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          {textTabs.map((t) => (
            <TabLink
              key={t.href}
              t={{
                ...t,
                iconOnly: false,
              }}
            />
          ))}

          <span className="mx-1 my-1 w-px shrink-0 bg-gray-200 dark:bg-gray-800" />

          {iconTabs.map((t) => (
            <TabLink key={t.href} t={t} />
          ))}
        </nav>

        <main className="min-w-0">
          <Breadcrumbs items={breadcrumbs} />

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}