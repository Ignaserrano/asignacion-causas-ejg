"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collectionGroup,
  query,
  where,
  onSnapshot,
  doc,
  getDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";

type InviteStatus = "pending" | "accepted" | "rejected";
type InviteMode = "auto" | "direct";

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

  invitedAtSec: number; // para ordenar
  respondedAtSec: number; // para ordenar respondidas
};

function badge(text: string, bg?: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontSize: 12,
        fontWeight: 900,
        background: bg ?? "white",
      }}
    >
      {text}
    </span>
  );
}

function pill(text: string, bg: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        background: bg,
        border: "1px solid #ddd",
      }}
    >
      {text}
    </span>
  );
}

function sectionTitle(text: string) {
  return <div style={{ marginTop: 18, fontWeight: 900, fontSize: 14 }}>{text}</div>;
}

function toSecondsMaybe(ts: any): number {
  const s = ts?.seconds;
  return typeof s === "number" ? s : 0;
}

function formatDateFromSeconds(seconds: number): string {
  if (!seconds) return "-";
  return new Date(seconds * 1000).toLocaleString();
}

export default function InvitesPage() {
  const router = useRouter();

  const [items, setItems] = useState<InviteRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // uid -> email (para mostrar quien creó la invitación)
  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});

  const pending = useMemo(() => items.filter((i) => i.status === "pending"), [items]);
  const responded = useMemo(() => items.filter((i) => i.status !== "pending"), [items]);

  const pendingCount = pending.length;

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setMsg(null);

      const q = query(
        collectionGroup(db, "invites"),
        where("invitedUid", "==", u.uid)
      );

      const unsub = onSnapshot(
        q,
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
                } catch {
                  // silencioso
                }

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
          })().catch((err) => setMsg(err?.message ?? "Error cargando invitaciones"));
        },
        (err) => setMsg(err.message)
      );

      return () => unsub();
    });

    return () => unsubAuth();
  }, [router]);

  // cargar emails de createdByUid (quien invitó)
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
            newMap[uid] = email || uid;
          } catch {
            newMap[uid] = uid;
          }
        })
      );

      setEmailByUid(newMap);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const pendingSorted = useMemo(() => {
    return [...pending].sort((a, b) => (b.invitedAtSec ?? 0) - (a.invitedAtSec ?? 0));
  }, [pending]);

  const respondedSorted = useMemo(() => {
    return [...responded].sort((a, b) => {
      const ta = (a.respondedAtSec || a.invitedAtSec || 0);
      const tb = (b.respondedAtSec || b.invitedAtSec || 0);
      return tb - ta;
    });
  }, [responded]);

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
    return emailByUid[uid] ?? uid;
  }

  function timelinePending(i: InviteRow) {
    return (
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.72, display: "grid", gap: 2 }}>
        <div>Invitada el: {formatDateFromSeconds(i.invitedAtSec)}</div>
        <div>Invitada por: {invitedByLabel(i)}</div>
      </div>
    );
  }

  function timelineResponded(i: InviteRow) {
    return (
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.72, display: "grid", gap: 2 }}>
        <div>Invitada el: {formatDateFromSeconds(i.invitedAtSec)}</div>
        <div>
          Respondida el:{" "}
          {i.respondedAtSec ? formatDateFromSeconds(i.respondedAtSec) : "-"}
        </div>
        <div>Invitada por: {invitedByLabel(i)}</div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      {/* Header integrado al flujo + contador */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 900, fontSize: 22 }}>Mis invitaciones</h1>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/dashboard" style={{ textDecoration: "none", fontWeight: 700 }}>
            Inicio →
          </a>
          <a href="/cases/mine" style={{ textDecoration: "none", fontWeight: 700 }}>
            Mis causas →
          </a>
          <a href="/cases" style={{ textDecoration: "none" }}>
            Ver todas →
          </a>
          {pendingCount > 0 && pill(`${pendingCount} pendientes`, "#ffe9c7")}
        </div>
      </div>

      {msg && <div style={{ marginTop: 12 }}>⚠️ {msg}</div>}

      {/* ========================= Pendientes ========================= */}
      {sectionTitle("Invitaciones pendientes")}

      <div style={{ marginTop: 10, border: "1px solid #ddd" }}>
        {pendingSorted.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.85 }}>No tenés invitaciones pendientes.</div>
        ) : (
          pendingSorted.map((i) => (
            <div
              key={i.id}
              style={{
                padding: 12,
                borderTop: "1px solid #eee",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {i.caratula}{" "}
                  <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
                    (#{i.caseId})
                  </span>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {i.mode === "direct" ? badge("DIRECTA", "#ffe9c7") : badge("AUTOMÁTICA")}
                  {badge("PENDIENTE")}
                </div>
              </div>

              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Materia: <b>{i.specialtyName || "-"}</b> · Jurisdicción:{" "}
                <b>{i.jurisdiccion || "-"}</b>
                {timelinePending(i)}
              </div>

              {i.mode === "direct" && i.directJustification && (
                <div style={{ background: "#fff3cd", padding: 10, fontSize: 13 }}>
                  <b>Justificación:</b> {i.directJustification}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <a
                  href={`/cases/${i.caseId}`}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #ddd",
                    textDecoration: "none",
                    fontSize: 13,
                  }}
                >
                  Ver causa →
                </a>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    disabled={busyId === i.id}
                    onClick={() => act(i, "accepted")}
                    style={{
                      padding: "7px 10px",
                      border: "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    {busyId === i.id ? "..." : "Aceptar"}
                  </button>

                  <button
                    disabled={busyId === i.id}
                    onClick={() => act(i, "rejected")}
                    style={{
                      padding: "7px 10px",
                      border: "1px solid #ddd",
                      background: "white",
                      cursor: "pointer",
                      fontWeight: 900,
                    }}
                  >
                    {busyId === i.id ? "..." : "Rechazar"}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ========================= Respondidas ========================= */}
      {sectionTitle("Invitaciones respondidas")}

      <div style={{ marginTop: 10, border: "1px solid #ddd" }}>
        {respondedSorted.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.85 }}>Todavía no respondiste invitaciones.</div>
        ) : (
          respondedSorted.map((i) => (
            <div
              key={i.id}
              style={{
                padding: 12,
                borderTop: "1px solid #eee",
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900 }}>
                  {i.caratula}{" "}
                  <span style={{ fontWeight: 400, opacity: 0.7, fontSize: 12 }}>
                    (#{i.caseId})
                  </span>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {i.mode === "direct" ? badge("DIRECTA", "#ffe9c7") : badge("AUTOMÁTICA")}
                  {i.status === "accepted" && badge("ACEPTADA", "#d4edda")}
                  {i.status === "rejected" && badge("RECHAZADA", "#f8d7da")}
                </div>
              </div>

              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Materia: <b>{i.specialtyName || "-"}</b> · Jurisdicción:{" "}
                <b>{i.jurisdiccion || "-"}</b>
                {timelineResponded(i)}
              </div>

              <div>
                <a
                  href={`/cases/${i.caseId}`}
                  style={{
                    padding: "6px 10px",
                    border: "1px solid #ddd",
                    textDecoration: "none",
                    fontSize: 13,
                  }}
                >
                  Ver causa →
                </a>
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}