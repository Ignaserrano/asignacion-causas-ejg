"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

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

type UserDoc = {
  email?: string;
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
        fontWeight: 800,
        background: bg ?? "white",
      }}
    >
      {text}
    </span>
  );
}

function sectionTitle(text: string) {
  return <div style={{ marginTop: 18, fontWeight: 900, fontSize: 14 }}>{text}</div>;
}

export default function CaseDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const caseId = params?.id;

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [c, setC] = useState<CaseDoc | null>(null);
  const [invites, setInvites] = useState<Array<{ id: string } & InviteDoc>>([]);

  // ✅ mapa uid -> email
  const [emailByUid, setEmailByUid] = useState<Record<string, string>>({});

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      if (!caseId) return;

      setLoading(true);
      setMsg(null);

      try {
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
        const q = query(invitesRef, orderBy("invitedAt", "desc"));

        const unsubInv = onSnapshot(
          q,
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
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando causa");
        setLoading(false);
      }
    });

    return () => unsubAuth();
  }, [router, caseId]);

  // ✅ cargar emails faltantes (confirmados + invitados)
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

  async function copyLink() {
    const url = `${window.location.origin}/cases/${caseId}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiado ✅");
    } catch {
      prompt("Copiá este link:", url);
    }
  }

  if (!caseId) return <main style={{ padding: 16 }}>ID inválido.</main>;

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Causa</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>
            {c?.caratulaTentativa ?? (loading ? "Cargando..." : "(no encontrada)")}
          </h1>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/cases" style={{ textDecoration: "none" }}>
            ← Volver a todas
          </a>
          <a href="/cases/mine" style={{ textDecoration: "none", fontWeight: 700 }}>
            Mis causas →
          </a>
          <a href="/invites" style={{ textDecoration: "none" }}>
            Mis invitaciones →
          </a>
          <button
            onClick={copyLink}
            style={{ padding: "8px 12px", border: "1px solid #ddd", background: "white", cursor: "pointer" }}
          >
            Copiar link
          </button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 16 }}>⚠️ {msg}</div>}
      {loading && <div style={{ marginTop: 16 }}>Cargando...</div>}

      {!loading && !c && <div style={{ marginTop: 16 }}>No se encontró la causa.</div>}

      {!loading && c && (
        <>
          {/* Banner estado */}
          <div
            style={{
              marginTop: 16,
              border: "1px solid #ddd",
              padding: 12,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {status === "assigned" ? badge("ASIGNADA", "#d4edda") : badge("DRAFT", "#f8f9fa")}
              {missingCount > 0 ? (
                <span style={{ fontSize: 13 }}>
                  Faltan <b>{missingCount}</b> confirmaciones ({confirmedCount}/{required})
                </span>
              ) : (
                <span style={{ fontSize: 13 }}>
                  Cupo completo ({confirmedCount}/{required})
                </span>
              )}
              {c.assignmentMode === "direct" && badge("DIRECTA", "#ffe9c7")}
              {c.assignmentMode === "auto" && badge("AUTOMÁTICA")}
            </div>

            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Invites: <b>{inviteStats.pending}</b> pend · <b>{inviteStats.accepted}</b> acep ·{" "}
              <b>{inviteStats.rejected}</b> rech
            </div>
          </div>

          {/* Datos */}
          {sectionTitle("Datos")}
          <div style={{ border: "1px solid #ddd", padding: 12, display: "grid", gap: 8 }}>
            <div>
              <b>Jurisdicción:</b> {c.jurisdiccion ?? "-"}
            </div>
            <div>
              <b>Objeto:</b> {c.objeto ?? "-"}
            </div>
            <div>
              <b>Resumen:</b> {c.resumen ?? "-"}
            </div>
            {c.assignmentMode === "direct" && c.directJustification && (
              <div style={{ background: "#fff3cd", padding: 10 }}>
                <b>Justificación (directa):</b> {c.directJustification}
              </div>
            )}
          </div>

          {/* Confirmados */}
          {sectionTitle(`Confirmados (${confirmedCount}/${required})`)}
          <div style={{ border: "1px solid #ddd", padding: 12 }}>
            {confirmedCount === 0 ? (
              <div style={{ opacity: 0.8 }}>Todavía no hay confirmados.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {(c.confirmedAssigneesUids ?? []).map((u) => (
                  <li key={u} style={{ margin: "6px 0" }}>
                    <b>{emailByUid[u] ?? u}</b>{" "}
                    <span style={{ opacity: 0.6, fontSize: 12 }}>({u})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Invitaciones */}
          {sectionTitle("Invitaciones")}
          <div style={{ border: "1px solid #ddd" }}>
            {invites.length === 0 ? (
              <div style={{ padding: 12, opacity: 0.8 }}>No hay invitaciones.</div>
            ) : (
              invites.map((i) => {
                const uidShown = i.invitedUid ?? "";
                const emailShown =
                  i.invitedEmail ||
                  (uidShown ? emailByUid[uidShown] : "") ||
                  uidShown ||
                  "(sin email)";

                return (
                  <div key={i.id} style={{ padding: 12, borderTop: "1px solid #eee", display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 800 }}>
                        {emailShown}{" "}
                        {uidShown && <span style={{ opacity: 0.6, fontWeight: 400 }}>({uidShown})</span>}
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {i.mode === "direct" && badge("DIRECTA", "#ffe9c7")}
                        {i.status === "pending" && badge("PENDIENTE")}
                        {i.status === "accepted" && badge("ACEPTADA", "#d4edda")}
                        {i.status === "rejected" && badge("RECHAZADA", "#f8d7da")}
                      </div>
                    </div>

                    {i.mode === "direct" && i.directJustification && (
                      <div style={{ background: "#fff3cd", padding: 10, fontSize: 13 }}>
                        <b>Justificación:</b> {i.directJustification}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </main>
  );
}