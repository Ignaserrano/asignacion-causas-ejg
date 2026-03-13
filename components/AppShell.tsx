"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
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

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconMoney({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16v10H4z" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11h8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function IconBook({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 4.5A2.5 2.5 0 0 1 8.5 2H19v18H8.5A2.5 2.5 0 0 0 6 22V4.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M6 4.5A2.5 2.5 0 0 0 3.5 7V19A2.5 2.5 0 0 1 6 16.5H19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3l7 3v5c0 4.5-2.8 8.6-7 10-4.2-1.4-7-5.5-7-10V6l7-3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="10" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M20 21v-1a4 4 0 0 0-3-3.87M15 5.13A3 3 0 0 1 15 10.9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMenu({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconClose({ className }: { className?: string }) {
  return (
    <svg className={className ?? "h-5 w-5"} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SideNavLink({
  href,
  label,
  icon,
  badge,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const cls = active
    ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
    : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800";

  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm font-extrabold transition ${cls}`}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {icon ? <span className="shrink-0">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
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
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const isAdmin = role === "admin";
  const invitesCount = pendingInvites ?? 0;

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const navTabs: Tab[] = useMemo(
    () => [
      { href: "/dashboard", label: "Inicio", icon: <IconHome className="h-4 w-4" /> },
      { href: "/cases/new", label: "Nueva causa", icon: <IconPlusDoc className="h-4 w-4" /> },
      { href: "/cases/mine", label: "Mis causas", icon: <IconBriefcase className="h-4 w-4" /> },
      { href: "/cases/manage", label: "Gestión de causas", icon: <IconManage className="h-4 w-4" /> },
      { href: "/jurisprudencia", label: "Jurisprudencia", icon: <IconBook className="h-4 w-4" /> },
      { href: "/contacts", label: "Agenda de contactos", icon: <IconContacts className="h-4 w-4" /> },
      {
        href: "/invites",
        label: "Invitaciones",
        icon: <IconInvites className="h-4 w-4" />,
        badge: invitesCount > 0 ? <Badge tone="warn">{invitesCount}</Badge> : undefined,
      },
      { href: "/specialties", label: "Especialidades", icon: <IconSpecialties className="h-4 w-4" /> },
      { href: "/calendar", label: "Agenda", icon: <IconCalendar className="h-4 w-4" /> },
      { href: "/cobranzas", label: "Cobros", icon: <IconMoney className="h-4 w-4" /> },
    ],
    [invitesCount]
  );

  const adminTabs: Tab[] = useMemo(
    () =>
      isAdmin
        ? [
            {
              href: "/admin/lawyers",
              label: "Administrar abogados",
              icon: <IconUsers className="h-4 w-4" />,
            },
            {
              href: "/admin/specialties",
              label: "Administrar especialidades",
              icon: <IconShield className="h-4 w-4" />,
            },
            {
              href: "/kpi",
              label: "KPI",
              icon: <IconUsers className="h-4 w-4" />,
            },
          ]
        : [],
    [isAdmin]
  );

  function isActive(href: string) {
    if (!pathname) return false;
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="min-h-dvh bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <PushNotificationsClient />

      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/90 backdrop-blur dark:border-gray-800 dark:bg-gray-900/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menú"
              aria-expanded={menuOpen}
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white p-2 text-gray-800 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              <IconMenu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="truncate text-base font-black text-gray-900 dark:text-gray-100">
                  {title}
                </div>
                {isAdmin ? <Badge tone="admin">ADMIN</Badge> : null}
              </div>

              <div className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-300">
                {subtitle ? (
                  subtitle
                ) : userEmail ? (
                  <>
                    Logueado como <span className="font-bold">{userEmail}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <InstallButton />

            {onLogout ? (
              <button
                onClick={onLogout}
                className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-extrabold shadow-sm transition hover:bg-gray-50 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Cerrar sesión
              </button>
            ) : null}
          </div>
        </div>
      </header>

      {menuOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 md:bg-black/20"
        />
      ) : null}

      <aside
        className={`fixed left-0 top-0 z-50 h-dvh w-1/2 max-w-[320px] min-w-[260px] transform border-r border-gray-200 bg-white shadow-2xl transition-transform duration-300 dark:border-gray-800 dark:bg-gray-900 md:w-[300px] ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!menuOpen}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                Navegación
              </div>
              {userEmail ? (
                <div className="truncate text-xs text-gray-600 dark:text-gray-300">{userEmail}</div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              aria-label="Cerrar menú"
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white p-2 text-gray-800 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              <IconClose className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <div className="grid gap-2">
              {navTabs.map((t) => (
                <SideNavLink
                  key={t.href}
                  href={t.href}
                  label={t.label}
                  icon={t.icon}
                  badge={t.badge}
                  active={isActive(t.href)}
                  onClick={() => setMenuOpen(false)}
                />
              ))}
            </div>

            {isAdmin ? (
              <div className="mt-5">
                <div className="mb-2 px-1 text-xs font-black uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Administración
                </div>

                <div className="grid gap-2">
                  {adminTabs.map((t) => (
                    <SideNavLink
                      key={t.href}
                      href={t.href}
                      label={t.label}
                      icon={t.icon}
                      badge={t.badge}
                      active={isActive(t.href)}
                      onClick={() => setMenuOpen(false)}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-gray-200 px-3 py-3 dark:border-gray-800">
            <div className="flex flex-col gap-2 md:hidden">
              <InstallButton />

              {onLogout ? (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-extrabold shadow-sm transition hover:bg-gray-50 hover:shadow dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Cerrar sesión
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <div className="mx-auto max-w-6xl px-4 py-6">
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