"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import {
  IconCases,
  IconInvites,
  IconNewCase,
  IconSpecialties,
} from "@/components/DashboardIcons";

function IconManage({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 21h6m-8-3h10a2 2 0 0 0 2-2V8.5a2 2 0 0 0-.59-1.41l-2.5-2.5A2 2 0 0 0 14.5 4H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M8 11h8M8 14h6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconContacts({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? "h-5 w-5"}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M16 3H8a2 2 0 0 0-2 2v16l2.5-1.6c.32-.2.72-.2 1.04 0L12 21l2.46-1.6c.32-.2.72-.2 1.04 0L18 21V5a2 2 0 0 0-2-2Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 8a2 2 0 1 0 0 4a2 2 0 0 0 0-4Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M8.8 16c.7-1.3 1.9-2 3.2-2s2.5.7 3.2 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
            <div className="text-base font-black text-gray-900 dark:text-gray-100">
              {title}
            </div>

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
            <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
              {subtitle}
            </div>
          ) : null}
        </div>

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

type FeedItem = {
  caseId: string;
  caratula: string;
  title: string;
  createdAtSec: number;
  createdByEmail?: string;
};

type InactiveItem = {
  caseId: string;
  caratula: string;
  lastLogAtSec?: number;
};

type ArchiveRequestItem = {
  caseId: string;
  caratula: string;
  requestedAtSec?: number;
  requestedByEmail?: string;
};

type CaseRow = {
  id: string;
  caratulaTentativa?: string;
  dashboardLastLogAt?: { seconds: number };
  dashboardLastLogTitle?: string;
  dashboardLastLogByEmail?: string;
};

function fmtDateTime(sec?: number) {
  if (!sec) return "-";
  return new Date(sec * 1000).toLocaleString();
}

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [inactive, setInactive] = useState<InactiveItem[]>([]);
  const [loadingWidgets, setLoadingWidgets] = useState(false);

  const [archiveRequests, setArchiveRequests] = useState<ArchiveRequestItem[]>([]);
  const [loadingArchiveRequests, setLoadingArchiveRequests] = useState(false);

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

  useEffect(() => {
    (async () => {
      if (!user) return;

      setLoadingWidgets(true);
      try {
        const casesQ = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", user.uid),
          orderBy("createdAt", "desc"),
          limit(200)
        );

        const casesSnap = await getDocs(casesQ);
        const myCases = casesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as CaseRow[];

        const now = Date.now();
        const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;

        const feedTmp: FeedItem[] = [];
        const inactiveTmp: InactiveItem[] = [];

        for (const c of myCases) {
          const lastLogAtSec = c.dashboardLastLogAt?.seconds;

          if (!lastLogAtSec || now - lastLogAtSec * 1000 > sixtyDaysMs) {
            inactiveTmp.push({
              caseId: c.id,
              caratula: String(c.caratulaTentativa ?? ""),
              lastLogAtSec,
            });
          }

          if (lastLogAtSec) {
            feedTmp.push({
              caseId: c.id,
              caratula: String(c.caratulaTentativa ?? ""),
              title: String(c.dashboardLastLogTitle ?? "(sin título)"),
              createdAtSec: lastLogAtSec,
              createdByEmail: String(c.dashboardLastLogByEmail ?? ""),
            });
          }
        }

        feedTmp.sort((a, b) => b.createdAtSec - a.createdAtSec);
        inactiveTmp.sort((a, b) => (a.lastLogAtSec ?? 0) - (b.lastLogAtSec ?? 0));

        setFeed(feedTmp.slice(0, 20));
        setInactive(inactiveTmp.slice(0, 30));
      } catch (e: any) {
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando movimientos/inactividad"));
      } finally {
        setLoadingWidgets(false);
      }
    })();
  }, [user]);

  useEffect(() => {
    (async () => {
      if (!user || role !== "admin") {
        setArchiveRequests([]);
        return;
      }

      setLoadingArchiveRequests(true);

      try {
        const qArchiveRequested = query(
          collection(db, "cases"),
          where("status", "==", "archsolicited"),
          orderBy("archiveRequestedAt", "desc"),
          limit(100)
        );

        const snap = await getDocs(qArchiveRequested);

        const items = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            caseId: d.id,
            caratula: String(data?.caratulaTentativa ?? d.id),
            requestedAtSec: Number(data?.archiveRequestedAt?.seconds ?? 0) || undefined,
            requestedByEmail: String(data?.archiveRequestedByEmail ?? "").trim() || undefined,
          } as ArchiveRequestItem;
        });

        setArchiveRequests(items);
      } catch (e: any) {
        setArchiveRequests([]);
        setMsg((prev) => prev ?? (e?.message ?? "Error cargando solicitudes de archivo"));
      } finally {
        setLoadingArchiveRequests(false);
      }
    })();
  }, [user, role]);

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
          href="/cases/manage"
          title="Gestión de causas"
          subtitle="Bitácora, partes, estado y más"
          icon={<IconManage className="h-5 w-5" />}
        />

        <CardLink
          href="/contacts"
          title="Agenda de contactos"
          subtitle="Personas, empresas, CUIT/DNI, email y teléfono"
          icon={<IconContacts className="h-5 w-5" />}
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

      <div className="mt-8 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Últimos movimientos (20)
            </div>
            {loadingWidgets ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
            ) : null}
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {feed.length === 0 ? (
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Sin movimientos.</div>
            ) : (
              feed.map((f, idx) => (
                <a
                  key={idx}
                  href={`/cases/manage/${f.caseId}`}
                  className="block py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">{f.title}</div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    {f.caratula ? `${f.caratula} · ` : ""}
                    {fmtDateTime(f.createdAtSec)}
                    {f.createdByEmail ? ` · ${f.createdByEmail}` : ""}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Alerta de inactividad (+60 días)
            </div>
            {loadingWidgets ? (
              <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
            ) : null}
          </div>

          <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {inactive.length === 0 ? (
              <div className="py-2 text-sm text-gray-700 dark:text-gray-200">Sin alertas 🎉</div>
            ) : (
              inactive.map((c, idx) => (
                <a
                  key={idx}
                  href={`/cases/manage/${c.caseId}`}
                  className="block py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {c.caratula || c.caseId}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    Último movimiento:{" "}
                    {c.lastLogAtSec
                      ? new Date(c.lastLogAtSec * 1000).toLocaleDateString()
                      : "nunca"}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>
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

            <button
              onClick={exportExcel}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm font-extrabold shadow-sm hover:bg-gray-50
                         dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
            >
              Exportar Excel de causas
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Solicitudes de archivo
              </div>
              {loadingArchiveRequests ? (
                <div className="text-xs text-gray-600 dark:text-gray-300">Cargando…</div>
              ) : (
                <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
                  {archiveRequests.length} pendiente(s)
                </div>
              )}
            </div>

            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
              {!loadingArchiveRequests && archiveRequests.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                  No hay causas con solicitud de archivo.
                </div>
              ) : (
                archiveRequests.map((item, idx) => (
                  <a
                    key={idx}
                    href={`/cases/manage/${item.caseId}`}
                    className="block py-2 transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {item.caratula || item.caseId}
                      </div>
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                        ARCHIVO SOLICITADO
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                      {item.requestedAtSec
                        ? `Solicitado: ${fmtDateTime(item.requestedAtSec)}`
                        : "Solicitud registrada"}
                      {item.requestedByEmail ? ` · ${item.requestedByEmail}` : ""}
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}