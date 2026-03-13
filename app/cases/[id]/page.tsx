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
import {
  finalizeDirectAssignment,
  inviteCaseReplacement,
} from "@/lib/cases";

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
  directAssignmentNeedsReview?: boolean;
  manualReplacementNeeded?: boolean;
  manualReplacementReason?: string;
  fallbackReplacementMode?: boolean;
};

type InviteDoc = {
  invitedUid?: string;
  invitedEmail?: string;
  status?: "pending" | "accepted" | "rejected";
  mode?: "auto" | "direct" | "manual_fallback";
  directJustification?: string;
  invitedAt?: any;
  respondedAt?: any;
  createdByUid?: string;
};

type UserDoc = { email?: string };

type UserOption = {
  uid: string;
  email: string;
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 text-sm font-black text-gray-900 dark:text-gray-100">{children}</div>;
}

export default function CaseDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const caseId = params?.id;

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [c, setC] = useState<CaseDoc | null>(null);
  const [invites, setInvites] = useState<Array<{ id: string } & InviteDoc>>([]);

  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});
  const [lawyerOptions, setLawyerOptions] = useState<UserOption[]>([]);

  const [replacementUid, setReplacementUid] = useState("");
  const [replacementJustification, setReplacementJustification] = useState("");
  const [sendingReplacement, setSendingReplacement] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
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

      try {
        const usersSnap = await getDocs(query(collection(db, "users"), orderBy("email", "asc")));
        const list = usersSnap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              email: String(data?.email ?? "").trim(),
            };
          })
          .filter((x) => Boolean(x.email));
        setLawyerOptions(list);
      } catch {
        setLawyerOptions([]);
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
          const list = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          })) as Array<{ id: string } & InviteDoc>;
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

  useEffect(() => {
    const uids = new Set<string>();

    (c?.confirmedAssigneesUids ?? []).forEach((u) => uids.add(u));
    invites.forEach((i) => {
      if (i.invitedUid) uids.add(i.invitedUid);
    });

    if (c?.broughtByUid) uids.add(c.broughtByUid);

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
              newMap[uid] = u.email ? String(u.email) : "";
            } else {
              newMap[uid] = "";
            }
          } catch {
            newMap[uid] = "";
          }
        })
      );

      setEmailByUid(newMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.confirmedAssigneesUids, c?.broughtByUid, invites]);

  const confirmedCount = uniq(c?.confirmedAssigneesUids ?? []).length;

  const required = useMemo(() => {
    const explicitRequired = Number(c?.requiredAssigneesCount ?? 0);
    return Math.max(explicitRequired || 2, confirmedCount, 1);
  }, [c?.requiredAssigneesCount, confirmedCount]);

  const missingCount = Math.max(0, required - confirmedCount);
  const status = c?.status ?? "draft";

  const inviteStats = useMemo(() => {
    const pending = invites.filter((i) => i.status === "pending").length;
    const accepted = invites.filter((i) => i.status === "accepted").length;
    const rejected = invites.filter((i) => i.status === "rejected").length;
    return { pending, accepted, rejected };
  }, [invites]);

  const isCreator = !!user?.uid && !!c?.broughtByUid && user.uid === c.broughtByUid;
  const isDirect = c?.assignmentMode === "direct";
  const rejectedInvites = invites.filter((i) => i.status === "rejected");
  const pendingInvitesInCase = invites.filter((i) => i.status === "pending").length;

  const showManualPanel =
    isCreator &&
    status !== "assigned" &&
    (
      (isDirect && rejectedInvites.length > 0) ||
      (!isDirect && Boolean(c?.manualReplacementNeeded))
    );

  const canCloseWithoutReplacement =
    isDirect &&
    confirmedCount >= 2 &&
    pendingInvitesInCase === 0 &&
    status !== "assigned";

  const alreadyUsedUids = useMemo(() => {
    return new Set(
      [
        ...(c?.confirmedAssigneesUids ?? []),
        ...invites.map((i) => String(i.invitedUid ?? "")).filter(Boolean),
      ].filter(Boolean)
    );
  }, [c?.confirmedAssigneesUids, invites]);

  const availableReplacementOptions = lawyerOptions.filter((l) => {
    if (l.uid === c?.broughtByUid) return false;
    return !alreadyUsedUids.has(l.uid);
  });

  async function handleInviteReplacement() {
    if (!caseId) return;
    if (!replacementUid) {
      alert("Seleccioná un abogado para invitar.");
      return;
    }

    setSendingReplacement(true);
    setMsg(null);

    try {
      await inviteCaseReplacement({
        caseId,
        newInvitedUid: replacementUid,
        justification: replacementJustification.trim(),
      });

      setReplacementUid("");
      setReplacementJustification("");
      setMsg("✅ Reemplazo invitado correctamente.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo invitar al reemplazo.");
    } finally {
      setSendingReplacement(false);
    }
  }

  async function handleFinalizeDirectAssignment() {
    if (!caseId) return;

    if (confirmedCount < 2) {
      alert("No podés cerrar la asignación con menos de 2 abogados confirmados.");
      return;
    }

    if (pendingInvitesInCase > 0) {
      alert("No podés cerrar la asignación mientras haya invitaciones pendientes.");
      return;
    }

    const ok = window.confirm(
      "¿Confirmás que querés dar por asignada la causa con los abogados ya confirmados?"
    );
    if (!ok) return;

    setFinalizing(true);
    setMsg(null);

    try {
      await finalizeDirectAssignment({ caseId });
      setMsg("✅ La causa quedó asignada con los confirmados actuales.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo cerrar la asignación.");
    } finally {
      setFinalizing(false);
    }
  }

  async function copyLink() {
    if (!caseId) return;
    const url = `${window.location.origin}/cases/${caseId}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado ✅");
    } catch {
      prompt("Copiá este link:", url);
    }
  }

  function shareWhatsApp() {
    if (!caseId) return;
    const text = encodeURIComponent(
      `${c?.caratulaTentativa ? `Causa: ${c.caratulaTentativa}` : "Detalle de causa"}\n${window.location.origin}/cases/${caseId}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  }

  function shareEmail() {
    if (!caseId) return;

    const subject = encodeURIComponent(
      c?.caratulaTentativa ? `Causa: ${c.caratulaTentativa}` : "Detalle de causa"
    );

    const body = encodeURIComponent(
      `${c?.caratulaTentativa ? `Causa: ${c.caratulaTentativa}` : "Detalle de causa"}\n${window.location.origin}/cases/${caseId}`
    );

    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }

  function printPdf() {
    window.print();
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  if (!caseId) {
    return (
      <AppShell
        title="Causa"
        userEmail={user?.email ?? null}
        role={role}
        pendingInvites={pendingInvites}
        onLogout={doLogout}
      >
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ID inválido.
        </div>
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

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gray-600 dark:text-gray-300">Causa</div>
          <h1 className="text-xl font-black text-gray-900 dark:text-gray-100">{title}</h1>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">#{caseId}</div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <Link
            href={`/cases/manage/${caseId}`}
            className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90"
          >
            Gestionar
          </Link>

          <button
            onClick={copyLink}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Copiar link
          </button>

          <button
            onClick={shareWhatsApp}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            WhatsApp
          </button>

          <button
            onClick={shareEmail}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Email
          </button>

          <button
            onClick={printPdf}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Imprimir / PDF
          </button>
        </div>
      </div>

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

      {!loading && !c ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          No se encontró la causa.
        </div>
      ) : null}

      {!loading && c ? (
        <>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {status === "assigned" ? <Badge tone="ok">ASIGNADA</Badge> : <Badge>DRAFT</Badge>}

                {missingCount > 0 ? (
                  <div className="text-sm text-gray-700 dark:text-gray-200">
                    Faltan <span className="font-black">{missingCount}</span> confirmaciones (
                    {confirmedCount}/{required})
                  </div>
                ) : (
                  <div className="text-sm text-gray-700 dark:text-gray-200">
                    Cupo completo ({confirmedCount}/{required})
                  </div>
                )}

                {c.assignmentMode === "direct" ? <Badge tone="warn">DIRECTA</Badge> : null}
                {c.assignmentMode === "auto" ? <Badge>AUTOMÁTICA</Badge> : null}
              </div>

              <div className="text-sm text-gray-700 dark:text-gray-200">
                Invites: <span className="font-black">{inviteStats.pending}</span> pend ·{" "}
                <span className="font-black">{inviteStats.accepted}</span> acep ·{" "}
                <span className="font-black">{inviteStats.rejected}</span> rech
              </div>
            </div>
          </div>

          {showManualPanel ? (
            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm dark:border-orange-800 dark:bg-orange-900/20">
              <div className="text-sm font-black text-orange-950 dark:text-orange-100">
                {isDirect
                  ? "Gestión manual por rechazo en asignación directa"
                  : "No hay reemplazo automático disponible por especialidad"}
              </div>

              <div className="mt-2 text-sm text-orange-900 dark:text-orange-100">
                {isDirect
                  ? "En asignación directa no se reasigna automáticamente. Podés invitar otro abogado o, si ya hay al menos 2 confirmados y no quedan pendientes, cerrar la asignación con los actuales."
                  : "No quedó ningún abogado disponible dentro de la especialidad. Podés invitar manualmente a otro abogado por fuera de la especialidad."}
              </div>

              <div className="mt-4 grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-orange-900 dark:text-orange-100">
                    Invitar reemplazo
                  </span>
                  <select
                    value={replacementUid}
                    onChange={(e) => setReplacementUid(e.target.value)}
                    className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-orange-700 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="">Seleccionar abogado…</option>
                    {availableReplacementOptions.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.email}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-orange-900 dark:text-orange-100">
                    Justificación / nota (opcional)
                  </span>
                  <textarea
                    value={replacementJustification}
                    onChange={(e) => setReplacementJustification(e.target.value)}
                    className="min-h-[90px] rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-orange-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleInviteReplacement}
                    disabled={sendingReplacement || !replacementUid}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {sendingReplacement ? "Invitando..." : "Invitar reemplazo"}
                  </button>

                  {isDirect ? (
                    <button
                      type="button"
                      onClick={handleFinalizeDirectAssignment}
                      disabled={finalizing || !canCloseWithoutReplacement}
                      className="rounded-xl border border-orange-300 bg-white px-4 py-2 text-sm font-extrabold text-orange-900 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-700 dark:bg-gray-800 dark:text-orange-100 dark:hover:bg-orange-900/30"
                    >
                      {finalizing ? "Cerrando..." : "Cerrar con confirmados actuales"}
                    </button>
                  ) : null}
                </div>

                {isDirect && !canCloseWithoutReplacement ? (
                  <div className="text-xs font-bold text-orange-900 dark:text-orange-100">
                    Para cerrar sin reemplazo necesitás al menos 2 confirmados y ninguna invitación pendiente.
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <SectionTitle>
            Confirmados ({confirmedCount}/{required})
          </SectionTitle>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            {confirmedCount === 0 ? (
              <div className="text-sm text-gray-700 dark:text-gray-200">Todavía no hay confirmados.</div>
            ) : (
              <ul className="ml-5 list-disc text-sm text-gray-800 dark:text-gray-100">
                {uniq(c.confirmedAssigneesUids ?? []).map((u) => (
                  <li key={u} className="my-2">
                    <span className="font-black">{emailByUid[u] ?? "Cargando..."}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <SectionTitle>Invitaciones</SectionTitle>
          <div className="grid gap-3">
            {invites.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
                No hay invitaciones.
              </div>
            ) : (
              invites.map((i) => {
                const uid = i.invitedUid ?? "";
                const emailShown =
                  i.invitedEmail ||
                  (uid ? emailByUid[uid] : "") ||
                  "(Cargando...)";

                return (
                  <div
                    key={i.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-[240px]">
                        <div className="font-extrabold text-gray-900 dark:text-gray-100">{emailShown}</div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {i.mode === "direct" ? <Badge tone="warn">DIRECTA</Badge> : null}
                        {i.mode === "auto" ? <Badge>AUTOMÁTICA</Badge> : null}
                        {i.mode === "manual_fallback" ? <Badge tone="warn">REEMPLAZO MANUAL</Badge> : null}

                        {i.status === "pending" ? (
                          <Badge>PENDIENTE</Badge>
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