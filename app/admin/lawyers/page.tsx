"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

type Specialty = { id: string; name: string; active?: boolean };
type UserRow = {
  uid: string;
  email: string;
  role: "lawyer" | "admin" | string;
  isPracticing: boolean;
  specialties: string[];
  missingProfile?: boolean;
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-black text-gray-900
                 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
    >
      {children}
    </span>
  );
}

export default function AdminLawyersPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

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

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsPracticing, setNewIsPracticing] = useState(true);
  const [newSpecialties, setNewSpecialties] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editIsPracticing, setEditIsPracticing] = useState(true);
  const [editSpecialties, setEditSpecialties] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const [pwUid, setPwUid] = useState<string | null>(null);
  const [pwEmail, setPwEmail] = useState<string>("");
  const [pwValue, setPwValue] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function ensureAdminOrRedirect(uid: string) {
    const snap = await getDoc(doc(db, "users", uid));
    const r = String((snap.data() as any)?.role ?? "lawyer");
    if (r !== "admin") router.replace("/dashboard");
  }

  async function loadAll() {
    setLoading(true);
    setMsg(null);

    try {
      const spSnap = await getDocs(query(collection(db, "specialties"), orderBy("name", "asc")));
      const spList: Specialty[] = spSnap.docs.map((d) => ({
        id: d.id,
        name: String((d.data() as any)?.name ?? d.id),
        active: (d.data() as any)?.active !== false,
      }));
      setSpecialties(spList);

      const uSnap = await getDocs(query(collection(db, "users"), orderBy("email", "asc")));

      const profileRows: UserRow[] = uSnap.docs.map((d) => {
        const data = d.data() as any;
        const roleRaw = String(data?.role ?? "lawyer");
        const role = roleRaw === "abogado" ? "lawyer" : roleRaw;

        return {
          uid: d.id,
          email: String(data?.email ?? d.id).toLowerCase(),
          role,
          isPracticing: !!data?.isPracticing,
          specialties: Array.isArray(data?.specialties) ? data.specialties : [],
        };
      });

      const profileByUid = new Map(profileRows.map((r) => [r.uid, r]));

      const listFn = httpsCallable(functions, "adminListAuthUsers");
      const authRes = (await listFn({})) as any;
      const authUsers: Array<{ uid: string; email: string }> = authRes?.data?.users ?? [];

      const merged: UserRow[] = authUsers.map((u) => {
        const existing = profileByUid.get(u.uid);
        if (existing) return existing;

        return {
          uid: u.uid,
          email: String(u.email ?? "").toLowerCase(),
          role: "lawyer",
          isPracticing: true,
          specialties: [],
          missingProfile: true,
        };
      });

      for (const r of profileRows) {
        if (!merged.find((x) => x.uid === r.uid)) merged.push(r);
      }

      merged.sort((a, b) => a.email.localeCompare(b.email));
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

      await ensureAdminOrRedirect(u.uid);
      await loadAll();
    });

    return () => unsub();
  }, [router]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

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
    <AppShell
      title="Administrar abogados"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      <div className="mb-4 text-sm text-gray-700 dark:text-gray-200">
        Gestión de usuarios (Auth + perfiles en Firestore).
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

      {/* CREAR */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-black text-gray-900 dark:text-gray-100">Agregar nuevo abogado</div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="abogado@estudio.com"
            className="min-w-[260px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />

          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="mín. 6 caracteres"
            className="min-w-[220px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />

          <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
            <input
              type="checkbox"
              checked={newIsPracticing}
              onChange={(e) => setNewIsPracticing(e.target.checked)}
              className="h-4 w-4"
            />
            Practicante
          </label>

          <button
            disabled={creating}
            onClick={createLawyer}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-extrabold shadow-sm hover:bg-gray-50 disabled:opacity-60
                       dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            {creating ? "Creando..." : "Crear abogado"}
          </button>
        </div>
      </div>

      {/* LISTADO */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 p-4 dark:border-gray-800">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Abogados existentes ({users.length})
          </div>
        </div>

        {users.length === 0 ? (
          <div className="p-4 text-sm text-gray-700 dark:text-gray-200">No hay abogados.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {users.map((r) => {
              const isEditing = editingUid === r.uid;

              return (
                <div key={r.uid} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-[260px]">
                      <div className="font-black text-gray-900 dark:text-gray-100">
                        {r.email}{" "}
                        <span className="text-xs font-normal text-gray-600 dark:text-gray-400">
                          ({r.role === "admin" ? "admin" : "abogado"})
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip>isPracticing: {r.isPracticing ? "true" : "false"}</Chip>
                        {r.missingProfile ? <Chip>sin perfil</Chip> : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => startEdit(r)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50
                                   dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Editar
                      </button>

                      <button
                        onClick={() => openPassword(r.uid, r.email)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50
                                   dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Cambiar password
                      </button>

                      <button
                        onClick={() => deleteLawyer(r.uid, r.email)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50
                                   dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL PASSWORD */}
      {pwUid ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Cambiar password — {pwEmail}
            </div>

            <input
              type="password"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              placeholder="mín. 6 caracteres"
              className="mt-3 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                disabled={savingPw}
                onClick={() => setPwUid(null)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50
                           dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>

              <button
                disabled={savingPw}
                onClick={savePassword}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50
                           dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {savingPw ? "Guardando..." : "Guardar password"}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Nota: la contraseña se cambia en Firebase Auth.
            </div>
          </div>
        </div>
      ) : null}

            {/* MODAL EDITAR */}
      {editingUid ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Editar abogado —{" "}
              {users.find((u) => u.uid === editingUid)?.email ?? editingUid}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={editIsPracticing}
                  onChange={(e) => setEditIsPracticing(e.target.checked)}
                  className="h-4 w-4"
                />
                Practicante (isPracticing)
              </label>
            </div>

            <div className="mt-4">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Especialidades
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {activeSpecialties.length === 0 ? (
                  <div className="text-sm text-gray-700 dark:text-gray-200">
                    No hay especialidades activas cargadas.
                  </div>
                ) : (
                  activeSpecialties.map((s) => {
                    const checked = editSpecialties.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setEditSpecialties((prev) => toggle(prev, s.id))}
                        className={`rounded-xl border px-3 py-2 text-sm font-extrabold shadow-sm
                          ${
                            checked
                              ? "border-gray-300 bg-gray-100 hover:bg-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
                              : "border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                          }`}
                        title={s.id}
                      >
                        {s.name}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="mt-3 text-xs text-gray-600 dark:text-gray-400">
                Seleccionadas:{" "}
                {editSpecialties.length === 0
                  ? "ninguna"
                  : editSpecialties
                      .map((id) => specialtyNameById[id] ?? id)
                      .join(", ")}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                disabled={savingEdit}
                onClick={() => setEditingUid(null)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50
                           dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>

              <button
                disabled={savingEdit}
                onClick={saveEdit}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50 disabled:opacity-60
                           dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {savingEdit ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>

            <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Nota: guarda en Firestore vía Cloud Function <code>adminUpdateLawyerProfile</code>.
            </div>
          </div>
        </div>
      ) : null}
      
    </AppShell>
  );
}

