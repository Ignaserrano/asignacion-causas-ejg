"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  collectionGroup,
  getDocs,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

type CaseDoc = {
  caratulaTentativa?: string;
  objeto?: string;
  resumen?: string;
  jurisdiccion?: string;
  specialtyId?: string;
  assignmentMode?: "auto" | "direct";
  directJustification?: string;
  status?: "draft" | "assigned";
  requiredAssigneesCount?: number;
  confirmedAssigneesUids?: string[];
  broughtByUid?: string;
  broughtByParticipates?: boolean;
};

type InviteDoc = {
  invitedUid?: string;
  invitedEmail?: string;
  status?: "pending" | "accepted" | "rejected";
  mode?: "auto" | "direct";
  directJustification?: string;
  invitedAt?: any;
  respondedAt?: any;
};

type UserDoc = { email?: string };

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn" | "ok" | "bad";
}) {
  const cls =
    tone === "warn"
      ? "bg-orange-100 border-orange-300"
      : tone === "ok"
      ? "bg-green-100 border-green-300"
      : tone === "bad"
      ? "bg-red-100 border-red-300"
      : "bg-gray-100 border-gray-300";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-black ${cls}`}>
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 text-sm font-black">{children}</div>;
}

export default function CaseDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const caseId = params?.id;

  // shell
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // page
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [c, setC] = useState<CaseDoc | null>(null);
  const [invites, setInvites] = useState<Array<{ id: string } & InviteDoc>>([]);

  // uid -> email
  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);

      // rol
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      // pending invites para tabs
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

      if (!caseId) return;

      setLoading(true);
      setMsg(null);

      const caseRef = doc(db, "cases", caseId);

      const unsubCase = onSnapshot(
        caseRef,
        (snap) => {
          setC(snap.exists() ? (snap.data() as any) : null);
          setLoading(false);
        },
        (err) => {
          setMsg(err.message);
          setLoading(false);
        }
      );

      const invitesRef = collection(db, "cases", caseId, "invites");
      const qInv = query(invitesRef, orderBy("invitedAt", "desc"));

      const unsubInv = onSnapshot(
        qInv,
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as any;
          setInvites(list);
        },
        (err) => setMsg(err.message)
      );

      return () => {
        unsubCase();
        unsubInv();
      };
    });

    return () => unsubAuth();
  }, [router, caseId]);

  // cargar emails faltantes (confirmados + invitados)
  useEffect(() => {
    const uids = new Set<string>();

    (c?.confirmedAssigneesUids ?? []).forEach((u) => uids.add(u));
    invites.forEach((i) => {
      if (i.invitedUid) uids.add(i.invitedUid);
    });

    const missing = Array.from(uids).filter((uid) => uid && !emailByUid[uid]);
    if (missing.length === 0) return;

    (async () => {
      const newMap = { ...emailByUid };

      await Promise.all(
        missing.map(async (uid) => {
          try {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
              const u = userSnap.data() as UserDoc;
              newMap[uid] = u.email ? String(u.email) : uid;
            } else {
              newMap[uid] = uid;
            }
          } catch {
            newMap[uid] = uid;
          }
        })
      );

      setEmailByUid(newMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.confirmedAssigneesUids, invites]);

  const required = Number(c?.requiredAssigneesCount ?? 2);
  const confirmedCount = (c?.confirmedAssigneesUids ?? []).length;
  const missingCount = Math.max(0, required - confirmedCount);
  const status = c?.status ?? "draft";

  const inviteStats = useMemo(() => {
    const pending = invites.filter((i) => i.status === "pending").length;
    const accepted = invites.filter((i) => i.status === "accepted").length;
    const rejected = invites.filter((i) => i.status === "rejected").length;
    return { pending, accepted, rejected };
  }, [invites]);

  function getShareUrl() {
    if (!caseId) return "";
    return `${window.location.origin}/cases/${caseId}`;
  }

  function getShareText() {
    const t = c?.caratulaTentativa ? `Causa: ${c.caratulaTentativa}` : "Detalle de causa";
    const url = getShareUrl();
    return `${t}\n${url}`;
  }

  async function copyLink() {
    if (!caseId) return;
    const url = getShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado ✅");
    } catch {
      prompt("Copiá este link:", url);
    }
  }

  function shareWhatsApp() {
    if (!caseId) return;
    const text = encodeURIComponent(getShareText());
    // wa.me funciona en mobile y desktop (redirige a WhatsApp Web si corresponde)
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  function shareEmail() {
    if (!caseId) return;

    const subject = encodeURIComponent(
      c?.caratulaTentativa ? `Causa: ${c.caratulaTentativa}` : "Detalle de causa"
    );

    const body = encodeURIComponent(getShareText());

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function printPdf() {
    // El usuario elige "Guardar como PDF" en el diálogo de impresión
    window.print();
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  if (!caseId) {
    return (
      <AppShell title="Causa" userEmail={user?.email ?? null} role={role} pendingInvites={pendingInvites} onLogout={doLogout}>
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">ID inválido.</div>
      </AppShell>
    );
  }

  const title = c?.caratulaTentativa ?? (loading ? "Cargando..." : "(no encontrada)");

  return (
    <AppShell
      title="Detalle de causa"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {/* Estilos de impresión: oculta botones/links y ajusta márgenes */}
      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          @page {
            margin: 12mm;
          }
        }
      `}</style>

      {/* Header interno */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-black/60">Causa</div>
          <h1 className="text-xl font-black">{title}</h1>
          <div className="mt-1 text-xs text-black/60">#{caseId}</div>
        </div>

        {/* 👇 Botonera (no se imprime) */}
        <div className="no-print flex flex-wrap items-center gap-2">
         
          <button
            onClick={copyLink}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50"
          >
            Copiar link
          </button>

          <button
            onClick={shareWhatsApp}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50"
            title="Compartir por WhatsApp"
          >
            WhatsApp
          </button>

          <button
            onClick={shareEmail}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50"
            title="Compartir por email"
          >
            Email
          </button>

          <button
            onClick={printPdf}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50"
            title="Imprimir / Guardar como PDF"
          >
            Imprimir / PDF
          </button>
        </div>
      </div>

      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm">⚠️ {msg}</div>
      ) : null}

      {loading ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm">Cargando...</div>
      ) : null}

      {!loading && !c ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-black/70">
          No se encontró la causa.
        </div>
      ) : null}

      {!loading && c ? (
        <>
          {/* Banner estado */}
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {status === "assigned" ? <Badge tone="ok">ASIGNADA</Badge> : <Badge>DRAFT</Badge>}

                {missingCount > 0 ? (
                  <div className="text-sm text-black/70">
                    Faltan <span className="font-black">{missingCount}</span> confirmaciones ({confirmedCount}/{required})
                  </div>
                ) : (
                  <div className="text-sm text-black/70">
                    Cupo completo ({confirmedCount}/{required})
                  </div>
                )}

                {c.assignmentMode === "direct" ? <Badge tone="warn">DIRECTA</Badge> : null}
                {c.assignmentMode === "auto" ? <Badge>AUTOMÁTICA</Badge> : null}
              </div>

              <div className="text-sm text-black/70">
                Invites: <span className="font-black">{inviteStats.pending}</span> pend ·{" "}
                <span className="font-black">{inviteStats.accepted}</span> acep ·{" "}
                <span className="font-black">{inviteStats.rejected}</span> rech
              </div>
            </div>
          </div>

          {/* Datos */}
          <SectionTitle>Datos</SectionTitle>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 text-sm">
              <div>
                <span className="font-black">Jurisdicción:</span>{" "}
                <span className="text-black/80">{c.jurisdiccion ?? "-"}</span>
              </div>
              <div>
                <span className="font-black">Objeto:</span>{" "}
                <span className="text-black/80">{c.objeto ?? "-"}</span>
              </div>
              <div>
                <span className="font-black">Resumen:</span>{" "}
                <span className="text-black/80">{c.resumen ?? "-"}</span>
              </div>

              {c.assignmentMode === "direct" && c.directJustification ? (
                <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
                  <span className="font-black">Justificación (directa):</span> {c.directJustification}
                </div>
              ) : null}
            </div>
          </div>

          {/* Confirmados */}
          <SectionTitle>Confirmados ({confirmedCount}/{required})</SectionTitle>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            {confirmedCount === 0 ? (
              <div className="text-sm text-black/70">Todavía no hay confirmados.</div>
            ) : (
              <ul className="ml-5 list-disc text-sm">
                {(c.confirmedAssigneesUids ?? []).map((u) => (
                  <li key={u} className="my-2">
                    <span className="font-black">{emailByUid[u] ?? u}</span>{" "}
                    <span className="text-xs text-black/60">({u})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Invitaciones */}
          <SectionTitle>Invitaciones</SectionTitle>
          <div className="grid gap-3">
            {invites.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-black/70">
                No hay invitaciones.
              </div>
            ) : (
              invites.map((i) => {
                const uidShown = i.invitedUid ?? "";
                const emailShown =
                  i.invitedEmail ||
                  (uidShown ? emailByUid[uidShown] : "") ||
                  uidShown ||
                  "(sin email)";

                return (
                  <div key={i.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[240px]">
                        <div className="font-extrabold">
                          {emailShown}{" "}
                          {uidShown ? <span className="text-xs font-normal text-black/60">({uidShown})</span> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {i.mode === "direct" ? <Badge tone="warn">DIRECTA</Badge> : <Badge>AUTOMÁTICA</Badge>}
                        {i.status === "pending" ? (
                          <Badge>PENDIENTE</Badge>
                        ) : i.status === "accepted" ? (
                          <Badge tone="ok">ACEPTADA</Badge>
                        ) : (
                          <Badge tone="bad">RECHAZADA</Badge>
                        )}
                      </div>
                    </div>

                    {i.mode === "direct" && i.directJustification ? (
                      <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm">
                        <span className="font-black">Justificación:</span> {i.directJustification}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </AppShell>
  );
}