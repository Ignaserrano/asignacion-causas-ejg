"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collectionGroup,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import ScrollToTopButton from "@/components/ScrollToTopButton";

type InviteStatus = "pending" | "accepted" | "rejected";
type InviteMode = "auto" | "direct" | "manual_fallback";

type InviteRow = {
  id: string;
  caseId: string;
  caratula: string;
  jurisdiccion: string;
  specialtyName: string;
  status: InviteStatus;
  mode: InviteMode;
  directJustification?: string;
  invitedEmail?: string;
  invitedUid?: string;
  createdByUid?: string;
  invitedAtSec: number;
  respondedAtSec: number;
};

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "ok" | "bad";
}) {
  const cls =
    tone === "warn"
      ? "bg-orange-100 border-orange-300 text-orange-900 dark:bg-orange-900/30 dark:border-orange-700 dark:text-orange-100"
      : tone === "ok"
      ? "bg-green-100 border-green-300 text-green-900 dark:bg-green-900/30 dark:border-green-700 dark:text-green-100"
      : tone === "bad"
      ? "bg-red-100 border-red-300 text-red-900 dark:bg-red-900/30 dark:border-red-700 dark:text-red-100"
      : "bg-gray-100 border-gray-300 text-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-black ${cls}`}
    >
      {children}
    </span>
  );
}

function toSecondsMaybe(ts: any): number {
  const s = ts?.seconds;
  return typeof s === "number" ? s : 0;
}

function formatDateFromSeconds(seconds: number): string {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString("es-AR", { hour12: false });
}

export default function InvitesPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [items, setItems] = useState<InviteRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});
  const [respondedPage, setRespondedPage] = useState(1);

  const RESPONDED_PAGE_SIZE = 5;

  const pending = useMemo(() => items.filter((i) => i.status === "pending"), [items]);
  const responded = useMemo(() => items.filter((i) => i.status !== "pending"), [items]);

  const pendingSorted = useMemo(() => {
    return [...pending].sort((a, b) => (b.invitedAtSec ?? 0) - (a.invitedAtSec ?? 0));
  }, [pending]);

  const respondedSorted = useMemo(() => {
    return [...responded].sort((a, b) => {
      const ta = a.respondedAtSec || a.invitedAtSec || 0;
      const tb = b.respondedAtSec || b.invitedAtSec || 0;
      return tb - ta;
    });
  }, [responded]);

  const respondedTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(respondedSorted.length / RESPONDED_PAGE_SIZE));
  }, [respondedSorted.length]);

  const respondedVisible = useMemo(() => {
    const start = (respondedPage - 1) * RESPONDED_PAGE_SIZE;
    const end = start + RESPONDED_PAGE_SIZE;
    return respondedSorted.slice(start, end);
  }, [respondedSorted, respondedPage]);

  useEffect(() => {
    if (respondedPage > respondedTotalPages) {
      setRespondedPage(respondedTotalPages);
    }
  }, [respondedPage, respondedTotalPages]);

  useEffect(() => {
    let unsubInvites: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setMsg(null);

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

      const qInv = query(collectionGroup(db, "invites"), where("invitedUid", "==", u.uid));

      if (unsubInvites) unsubInvites();

      unsubInvites = onSnapshot(
        qInv,
        (snap) => {
          (async () => {
            const list: InviteRow[] = await Promise.all(
              snap.docs.map(async (d) => {
                const data = d.data() as any;
                const caseId = d.ref.parent.parent?.id ?? "";

                let caratula = caseId;
                let jurisdiccion = "";
                let specialtyName = "";

                const invitedAtSec = toSecondsMaybe(data?.invitedAt);
                const respondedAtSec = toSecondsMaybe(data?.respondedAt);

                try {
                  const caseSnap = await getDoc(doc(db, "cases", caseId));
                  if (caseSnap.exists()) {
                    const c = caseSnap.data() as any;
                    caratula = c?.caratulaTentativa ?? caseId;
                    jurisdiccion = c?.jurisdiccion ?? "";

                    const spId = String(c?.specialtyId ?? "");
                    if (spId) {
                      const spSnap = await getDoc(doc(db, "specialties", spId));
                      specialtyName = spSnap.exists()
                        ? String((spSnap.data() as any)?.name ?? "")
                        : "";
                    }
                  }
                } catch {}

                return {
                  id: d.id,
                  caseId,
                  caratula,
                  jurisdiccion,
                  specialtyName,
                  status: (data.status ?? "pending") as InviteStatus,
                  mode: (data.mode ?? "auto") as InviteMode,
                  directJustification: data.directJustification ?? "",
                  invitedEmail: data.invitedEmail ?? "",
                  invitedUid: data.invitedUid ?? "",
                  createdByUid: data.createdByUid ?? "",
                  invitedAtSec,
                  respondedAtSec,
                };
              })
            );

            setItems(list);
            setPendingInvites(list.filter((i) => i.status === "pending").length);
          })().catch((err) => setMsg(err?.message ?? "Error cargando invitaciones"));
        },
        (err) => setMsg(err.message)
      );
    });

    return () => {
      if (unsubInvites) unsubInvites();
      unsubAuth();
    };
  }, [router]);

  useEffect(() => {
    const uids = new Set<string>();
    items.forEach((i) => {
      if (i.createdByUid) uids.add(i.createdByUid);
    });

    const missing = Array.from(uids).filter((uid) => uid && !emailByUid[uid]);
    if (missing.length === 0) return;

    (async () => {
      const newMap = { ...emailByUid };

      await Promise.all(
        missing.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));
            const email = snap.exists() ? String((snap.data() as any)?.email ?? "") : "";
            newMap[uid] = email || "";
          } catch {
            newMap[uid] = "";
          }
        })
      );

      setEmailByUid(newMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  async function act(inv: InviteRow, decision: "accepted" | "rejected") {
    if (inv.status !== "pending") return;

    setBusyId(inv.id);
    setMsg(null);

    try {
      const fn = httpsCallable(functions, "respondInvite");
      await fn({
        caseId: inv.caseId,
        inviteId: inv.id,
        decision,
      });
    } catch (e: any) {
      setMsg(e?.message ?? "Error al responder la invitación.");
    } finally {
      setBusyId(null);
    }
  }

  function invitedByLabel(i: InviteRow) {
    const uid = i.createdByUid || "";
    if (!uid) return "-";
    const email = emailByUid[uid];
    return email ? email : "Cargando...";
  }

  function modeBadge(i: InviteRow) {
    if (i.mode === "direct") return <Badge tone="warn">DIRECTA</Badge>;
    if (i.mode === "manual_fallback") return <Badge tone="warn">REEMPLAZO MANUAL</Badge>;
    return <Badge>AUTOMÁTICA</Badge>;
  }

  function Timeline({ i, responded }: { i: InviteRow; responded: boolean }) {
    return (
      <div className="mt-2 grid gap-1 text-xs text-gray-600 dark:text-gray-300">
        <div>Invitada el: {formatDateFromSeconds(i.invitedAtSec)}</div>
        {responded ? (
          <div>
            Respondida el: {i.respondedAtSec ? formatDateFromSeconds(i.respondedAtSec) : "-"}
          </div>
        ) : null}
        <div>Invitada por: {invitedByLabel(i)}</div>
      </div>
    );
  }

  function RowCard({ i, kind }: { i: InviteRow; kind: "pending" | "responded" }) {
    const isPending = kind === "pending";

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px]">
            <div className="font-black text-gray-900 dark:text-gray-100">
              {i.caratula}{" "}
              <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                (#{i.caseId})
              </span>
            </div>

            <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
              Materia: <span className="font-bold">{i.specialtyName || "-"}</span> · Jurisdicción:{" "}
              <span className="font-bold">{i.jurisdiccion || "-"}</span>
            </div>

            <Timeline i={i} responded={!isPending} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modeBadge(i)}
            {isPending ? (
              <Badge tone="warn">PENDIENTE</Badge>
            ) : i.status === "accepted" ? (
              <Badge tone="ok">ACEPTADA</Badge>
            ) : (
              <Badge tone="bad">RECHAZADA</Badge>
            )}
          </div>
        </div>

        {i.directJustification ? (
          <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-100">
            <span className="font-black">Justificación:</span> {i.directJustification}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/cases/${i.caseId}`}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Ver causa →
          </Link>

          {isPending ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === i.id}
                onClick={() => act(i, "accepted")}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {busyId === i.id ? "..." : "Aceptar"}
              </button>

              <button
                type="button"
                disabled={busyId === i.id}
                onClick={() => act(i, "rejected")}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {busyId === i.id ? "..." : "Rechazar"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <AppShell
      title="Mis invitaciones"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Mis invitaciones" },
      ]}
    >
      {pendingInvites > 0 ? (
        <a
          href="#invitaciones-pendientes"
          className="mb-4 block rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm transition hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-900/20 dark:hover:bg-orange-900/30"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-orange-900 dark:text-orange-100">
                Invitaciones pendientes de respuesta
              </div>
              <div className="mt-1 text-xs text-orange-800 dark:text-orange-200">
                Tenés {pendingInvites} invitación{pendingInvites === 1 ? "" : "es"} pendiente
                {pendingInvites === 1 ? "" : "s"} de respuesta.
              </div>
            </div>

            <div className="shrink-0 rounded-full border border-orange-300 bg-white px-3 py-1 text-sm font-black text-orange-900 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-100">
              {pendingInvites}
            </div>
          </div>
        </a>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          Revisá tus invitaciones pendientes y el historial de respuestas.
        </div>
        {pendingInvites > 0 ? <Badge tone="warn">{pendingInvites} pendientes</Badge> : null}
      </div>

      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      <div
        id="invitaciones-pendientes"
        className="text-sm font-black text-gray-900 dark:text-gray-100"
      >
        Invitaciones pendientes
      </div>

      <div className="mt-3 grid gap-3">
        {pendingSorted.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            No tenés invitaciones pendientes.
          </div>
        ) : (
          pendingSorted.map((i) => <RowCard key={i.id} i={i} kind="pending" />)
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Últimas invitaciones respondidas
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            Se muestran de a {RESPONDED_PAGE_SIZE}. Total respondidas: {respondedSorted.length}.
          </div>
        </div>

        {respondedSorted.length > 0 ? (
          <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
            Página {respondedPage} de {respondedTotalPages}
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3">
        {respondedSorted.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
            Todavía no respondiste invitaciones.
          </div>
        ) : (
          respondedVisible.map((i) => <RowCard key={i.id} i={i} kind="responded" />)
        )}
      </div>

      {respondedSorted.length > 0 ? (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setRespondedPage((p) => Math.max(1, p - 1))}
            disabled={respondedPage <= 1}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            Anterior
          </button>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-black text-gray-800 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100">
            {respondedPage} / {respondedTotalPages}
          </div>

          <button
            type="button"
            onClick={() => setRespondedPage((p) => Math.min(respondedTotalPages, p + 1))}
            disabled={respondedPage >= respondedTotalPages}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
          >
            Siguiente
          </button>
        </div>
      ) : null}

      <ScrollToTopButton />
    </AppShell>
  );
}