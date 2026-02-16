"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";

type Specialty = { id: string; name: string; active?: boolean };
type UserRow = {
  uid: string;
  email: string;
  role: "lawyer" | "admin" | string;
  isPracticing: boolean;
  specialties: string[];
  missingProfile?: boolean;
};

function chip(text: string) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontSize: 12,
        fontWeight: 900,
        background: "#f8f9fa",
      }}
    >
      {text}
    </span>
  );
}

export default function AdminLawyersPage() {
  const router = useRouter();

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const specialtyNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of specialties) m[s.id] = s.name;
    return m;
  }, [specialties]);

  const activeSpecialties = useMemo(
    () => specialties.filter((s) => s.active !== false),
    [specialties]
  );

  const [users, setUsers] = useState<UserRow[]>([]);

  // ---- create ----
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsPracticing, setNewIsPracticing] = useState(true);
  const [newSpecialties, setNewSpecialties] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // ---- edit ----
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editIsPracticing, setEditIsPracticing] = useState(true);
  const [editSpecialties, setEditSpecialties] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  // ---- password modal ----
  const [pwUid, setPwUid] = useState<string | null>(null);
  const [pwEmail, setPwEmail] = useState<string>("");
  const [pwValue, setPwValue] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function ensureAdminOrRedirect(uid: string) {
    const snap = await getDoc(doc(db, "users", uid));
    const role = String((snap.data() as any)?.role ?? "lawyer");
    if (role !== "admin") router.replace("/dashboard");
  }

  async function loadAll() {
    setLoading(true);
    setMsg(null);

    try {
      // specialties (para mostrar por nombre y checkboxes)
      const spSnap = await getDocs(
        query(collection(db, "specialties"), orderBy("name", "asc"))
      );
      const spList: Specialty[] = spSnap.docs.map((d) => ({
        id: d.id,
        name: String((d.data() as any)?.name ?? d.id),
        active: (d.data() as any)?.active !== false,
      }));
      setSpecialties(spList);

      // users
      const uSnap = await getDocs(
        query(collection(db, "users"), orderBy("email", "asc"))
      );

  const profileRows: UserRow[] = uSnap.docs.map((d) => {
  const data = d.data() as any;
  const roleRaw = String(data?.role ?? "lawyer");
  const role = roleRaw === "abogado" ? "lawyer" : roleRaw; // compat viejo

  return {
    uid: d.id,
    email: String(data?.email ?? d.id).toLowerCase(),
    role,
    isPracticing: !!data?.isPracticing,
    specialties: Array.isArray(data?.specialties) ? data.specialties : [],
  };
});

// Map por uid de perfiles existentes
const profileByUid = new Map(profileRows.map((r) => [r.uid, r]));

// Traer usuarios de Auth (para incluir los que no tienen perfil)
const listFn = httpsCallable(functions, "adminListAuthUsers");
const authRes = (await listFn({})) as any;
const authUsers: Array<{ uid: string; email: string }> = authRes?.data?.users ?? [];

// Unir: si está en Firestore, usamos ese.
// Si está en Auth pero no en Firestore, lo mostramos igual con defaults.
const merged: UserRow[] = authUsers.map((u) => {
  const existing = profileByUid.get(u.uid);
  if (existing) return existing;

  return {
    uid: u.uid,
    email: u.email,
    role: "lawyer",
    isPracticing: true,
    specialties: [],
  };
});

// Además, por si hay perfiles sin email (raros), sumamos los que no estén en Auth
for (const r of profileRows) {
  if (!merged.find((x) => x.uid === r.uid)) merged.push(r);
}

merged.sort((a, b) => a.email.localeCompare(b.email));

// Si querés seguir filtrando solo abogados/admin:
const finalRows = merged.filter((r) => r.role === "lawyer" || r.role === "admin");

setUsers(finalRows);
    } catch (e: any) {
      setMsg(e?.message ?? "Error cargando abogados");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      await ensureAdminOrRedirect(u.uid);
      await loadAll();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function createLawyer() {
    setMsg(null);
    setCreating(true);

    try {
      const fn = httpsCallable(functions, "adminCreateLawyer");
      await fn({
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        specialties: newSpecialties,
        isPracticing: newIsPracticing,
        role: "lawyer",
      });

      setNewEmail("");
      setNewPassword("");
      setNewIsPracticing(true);
      setNewSpecialties([]);

      await loadAll();
      setMsg("✅ Abogado creado.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error creando abogado");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(r: UserRow) {
    setEditingUid(r.uid);
    setEditIsPracticing(r.isPracticing);
    setEditSpecialties(r.specialties);
  }

  async function saveEdit() {
    if (!editingUid) return;

    setMsg(null);
    setSavingEdit(true);

    try {
      const fn = httpsCallable(functions, "adminUpdateLawyerProfile");
      await fn({
        uid: editingUid,
        specialties: editSpecialties,
        isPracticing: editIsPracticing,
      });

      setEditingUid(null);
      await loadAll();
      setMsg("✅ Cambios guardados.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error guardando cambios");
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteLawyer(uid: string, email: string) {
    setMsg(null);

    const ok = confirm(
      `¿Eliminar abogado ${email}?\n\nEsto elimina el usuario de Auth + su perfil en Firestore. No borra causas/invites históricos.`
    );
    if (!ok) return;

    try {
      const fn = httpsCallable(functions, "adminDeleteLawyer");
      await fn({ uid });
      await loadAll();
      setMsg("✅ Abogado eliminado.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error eliminando abogado");
    }
  }

  function openPassword(uid: string, email: string) {
    setPwUid(uid);
    setPwEmail(email);
    setPwValue("");
  }

  async function savePassword() {
    if (!pwUid) return;

    setMsg(null);
    setSavingPw(true);

    try {
      const fn = httpsCallable(functions, "adminSetLawyerPassword");
      await fn({ uid: pwUid, password: pwValue });

      setPwUid(null);
      setPwEmail("");
      setPwValue("");

      setMsg("✅ Password actualizada.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error actualizando password");
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <main style={{ maxWidth: 1100, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontWeight: 900 }}>Administrar abogados</h1>
        <a href="/dashboard" style={{ textDecoration: "none", fontWeight: 900 }}>
          ← Inicio
        </a>
      </div>

      {msg && <div style={{ marginTop: 12 }}>⚠️ {msg}</div>}
      {loading && <div style={{ marginTop: 12 }}>Cargando...</div>}

      {/* CREAR */}
      <div style={{ marginTop: 16, border: "1px solid #ddd", padding: 12 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Agregar nuevo abogado</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>
            Email{" "}
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="abogado@estudio.com"
              style={{ padding: 7, border: "1px solid #ddd", minWidth: 260 }}
            />
          </label>

          <label style={{ fontSize: 13 }}>
            Password{" "}
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="mín. 6 caracteres"
              style={{ padding: 7, border: "1px solid #ddd", minWidth: 220 }}
            />
          </label>

          <label style={{ fontSize: 13 }}>
            Practicante{" "}
            <input
              type="checkbox"
              checked={newIsPracticing}
              onChange={(e) => setNewIsPracticing(e.target.checked)}
              style={{ marginLeft: 8 }}
            />
          </label>

          <button
            disabled={creating}
            onClick={createLawyer}
            style={{
              padding: "8px 12px",
              border: "1px solid #ddd",
              background: "white",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            {creating ? "Creando..." : "Crear abogado"}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
            Especialidades
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {activeSpecialties.map((s) => (
              <label
                key={s.id}
                style={{
                  fontSize: 13,
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={newSpecialties.includes(s.id)}
                  onChange={() => setNewSpecialties((prev) => toggle(prev, s.id))}
                />
                {s.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* LISTADO */}
      <div style={{ marginTop: 16, border: "1px solid #ddd" }}>
        <div style={{ padding: 12, fontWeight: 900 }}>
          Abogados existentes ({users.length})
        </div>

        {users.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>No hay abogados.</div>
        ) : (
          users.map((r) => {
            const isEditing = editingUid === r.uid;
const hasProfile = true; // lo calculamos con un lookup rápido

            return (
              <div
                key={r.uid}
                style={{ padding: 12, borderTop: "1px solid #eee", display: "grid", gap: 8 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>
                    {r.email}{" "}
                    <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 12 }}>
                      ({r.role === "admin" ? "admin" : "abogado"})
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {r.isPracticing ? chip("isPracticing: true") : chip("isPracticing: false")}

                    <button
                      onClick={() => startEdit(r)}
                      style={{ padding: "6px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
                    >
                      Editar
                    </button>

                    <button
                      onClick={() => openPassword(r.uid, r.email)}
                      style={{ padding: "6px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
                    >
                      Cambiar password
                    </button>

                    <button
                      onClick={() => deleteLawyer(r.uid, r.email)}
                      style={{ padding: "6px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>

                {!isEditing ? (
                  <div style={{ fontSize: 13, opacity: 0.9, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ opacity: 0.8 }}>Especialidades:</span>
                    {r.specialties.length === 0 ? (
                      <span style={{ opacity: 0.8 }}>(sin especialidades)</span>
                    ) : (
                     r.specialties.map((sid) => (
  <span key={sid}>{chip(specialtyNameById[sid] ?? sid)}</span>
))

                    )}
                  </div>
                ) : (
                  <div style={{ border: "1px solid #eee", padding: 10, display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ fontSize: 13 }}>
                        Practicante{" "}
                        <input
                          type="checkbox"
                          checked={editIsPracticing}
                          onChange={(e) => setEditIsPracticing(e.target.checked)}
                          style={{ marginLeft: 8 }}
                        />
                      </label>

                      <button
                        disabled={savingEdit}
                        onClick={saveEdit}
                        style={{ padding: "7px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
                      >
                        {savingEdit ? "Guardando..." : "Guardar"}
                      </button>

                      <button
                        disabled={savingEdit}
                        onClick={() => setEditingUid(null)}
                        style={{ padding: "7px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
                      >
                        Cancelar
                      </button>
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 800 }}>Especialidades</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {activeSpecialties.map((s) => (
                        <label
                          key={s.id}
                          style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}
                        >
                          <input
                            type="checkbox"
                            checked={editSpecialties.includes(s.id)}
                            onChange={() => setEditSpecialties((prev) => toggle(prev, s.id))}
                          />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* MODAL PASSWORD */}
      {pwUid && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: "white",
              border: "1px solid #ddd",
              padding: 14,
              width: "min(520px, 100%)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 10 }}>
              Cambiar password — {pwEmail}
            </div>

            <label style={{ fontSize: 13 }}>
              Nueva password{" "}
              <input
                type="password"
                value={pwValue}
                onChange={(e) => setPwValue(e.target.value)}
                placeholder="mín. 6 caracteres"
                style={{ padding: 7, border: "1px solid #ddd", width: "100%", marginTop: 6 }}
              />
            </label>

            <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                disabled={savingPw}
                onClick={() => setPwUid(null)}
                style={{ padding: "7px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                disabled={savingPw}
                onClick={savePassword}
                style={{ padding: "7px 10px", border: "1px solid #ddd", background: "white", fontWeight: 900, cursor: "pointer" }}
              >
                {savingPw ? "Guardando..." : "Guardar password"}
              </button>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              Nota: la contraseña se cambia en Firebase Auth.
            </div>
          </div>
        </div>
      )}
    </main>
  );
}