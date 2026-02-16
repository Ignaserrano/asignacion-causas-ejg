"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, query, where } from "firebase/firestore";

import { auth, db } from "@/lib/firebase";

function cardButton(href: string, title: string, subtitle?: string, tag?: string) {
  return (
    <a
      href={href}
      style={{
        border: "1px solid #ddd",
        padding: 16,
        textDecoration: "none",
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
        {tag ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 900,
              border: "1px solid #ddd",
              padding: "2px 8px",
              borderRadius: 999,
              background: "#f8f9fa",
            }}
          >
            {tag}
          </span>
        ) : null}
      </div>
      {subtitle ? <div style={{ fontSize: 13, opacity: 0.8 }}>{subtitle}</div> : null}
    </a>
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

export default function DashboardPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
        // 1) Leer rol desde users/{uid}
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));

        // 2) Contador de invitaciones pendientes
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

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  const isAdmin = role === "admin";

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>
            Dashboard {isAdmin ? "(Admin)" : ""}
          </h1>

          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
            Logueado como: <b>{user?.email ?? "-"}</b>{" "}
            {isAdmin ? <span style={{ marginLeft: 8 }}>{pill("ADMIN", "#ffe9c7")}</span> : null}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/cases/mine" style={{ textDecoration: "none", fontWeight: 800 }}>
            Mis causas →
          </a>

          <a
            href="/invites"
            style={{
              textDecoration: "none",
              display: "inline-flex",
              gap: 8,
              alignItems: "center",
              fontWeight: 800,
            }}
          >
            Mis invitaciones →
            {pendingInvites > 0 && pill(`${pendingInvites}`, "#ffe9c7")}
          </a>

          <button
            onClick={doLogout}
            style={{
              padding: "8px 12px",
              border: "1px solid #ddd",
              background: "white",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 14 }}>⚠️ {msg}</div>}
      {loading && <div style={{ marginTop: 14 }}>Cargando...</div>}

      {/* Panel abogado (siempre) */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 10 }}>Trabajo</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {cardButton("/cases/mine", "Mis causas", "Causas donde participo o que creé")}
          {cardButton(
            "/invites",
            "Mis invitaciones",
            pendingInvites > 0 ? `Tenés ${pendingInvites} pendientes` : "No tenés pendientes",
            pendingInvites > 0 ? "PENDIENTES" : undefined
          )}
          {cardButton("/cases/new", "Agregar nueva causa", "Cargar una causa y enviar invitaciones")}
          {cardButton("/specialties", "Mis especialidades", "Ver tus especialidades")}
        </div>
      </div>

      {/* Panel admin (solo si role=admin) */}
      {isAdmin && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontWeight: 900, fontSize: 14, marginBottom: 10 }}>Administración</div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 12,
            }}
          >
            {cardButton("/admin/lawyers", "Administrar abogados", "Crear/editar abogados, estado y especialidades", "ADMIN")}
            {cardButton("/admin/specialties", "Administrar especialidades", "Crear/editar/activar especialidades", "ADMIN")}
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 13, opacity: 0.8 }}>
        Tip: guardá esta página como favorito: <b>/dashboard</b>
      </div>
    </main>
  );
}