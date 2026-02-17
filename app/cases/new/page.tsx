"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";

import { getUserProfile } from "@/lib/users";
import { listActiveSpecialties, listPracticingUsers } from "@/lib/data";
import { createCaseWithInvites } from "@/lib/cases";

type Jurisdiccion = "nacional" | "federal" | "caba" | "provincia_bs_as";
type AssignmentMode = "auto" | "direct";

type Specialty = { id: string; name: string; active: boolean };
type UserRow = { uid: string; email: string; role: string };

export default function NewCasePage() {
  const router = useRouter();

  // auth/shell data
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  // auth guard
  const [authReady, setAuthReady] = useState(false);
  const [uid, setUid] = useState<string | null>(null);

  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [practicingUsers, setPracticingUsers] = useState<UserRow[]>([]);

  // Form
  const [caratulaTentativa, setCaratulaTentativa] = useState("");
  const [specialtyId, setSpecialtyId] = useState("");
  const [objeto, setObjeto] = useState("");
  const [resumen, setResumen] = useState("");
  const [jurisdiccion, setJurisdiccion] = useState<Jurisdiccion>("provincia_bs_as");

  const [broughtByParticipates, setBroughtByParticipates] = useState(true);
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("auto");

  // Direct assignment
  const [directAssignees, setDirectAssignees] = useState<string[]>([]);
  const [directJustification, setDirectJustification] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const requiredDirectCount = broughtByParticipates ? 1 : 2;
  const directAssigneesSet = useMemo(() => new Set(directAssignees), [directAssignees]);

  // Auth guard + shell data
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setUid(u.uid);
      setMsg(null);

      // rol (para tabs admin)
      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(data?.role ?? "lawyer"));
      } catch {
        setRole("lawyer");
      }

      // pending invites (badge tabs)
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

      // perfil (tu guard original)
      try {
        const profile = await getUserProfile(u.uid);
        if (!profile) {
          router.replace("/dashboard");
          return;
        }
        setAuthReady(true);
      } catch {
        router.replace("/dashboard");
      }
    });

    return () => unsub();
  }, [router]);

  // Load data
  useEffect(() => {
    if (!authReady) return;

    (async () => {
      const [sp, pu] = await Promise.all([listActiveSpecialties(), listPracticingUsers()]);
      setSpecialties(sp as any);
      setPracticingUsers(pu as any);
      if (sp.length && !specialtyId) setSpecialtyId((sp as any)[0].id);
    })().catch((e: any) => setMsg("Error cargando datos: " + (e?.message ?? "desconocido")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  // Keep direct count consistent
  useEffect(() => {
    if (assignmentMode !== "direct") return;
    if (directAssignees.length > requiredDirectCount) {
      setDirectAssignees(directAssignees.slice(0, requiredDirectCount));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broughtByParticipates, assignmentMode]);

  function toggleDirectAssignee(targetUid: string) {
    setMsg(null);
    setDirectAssignees((prev) => {
      const exists = prev.includes(targetUid);
      if (exists) return prev.filter((x) => x !== targetUid);
      if (prev.length >= requiredDirectCount) return prev;
      return [...prev, targetUid];
    });
  }

  function validate(): string | null {
    if (!uid) return "No hay sesión iniciada.";
    if (!caratulaTentativa.trim()) return "Completá la carátula tentativa.";
    if (!specialtyId) return "Elegí una materia/especialidad.";
    if (!objeto.trim()) return "Completá el objeto.";
    if (!resumen.trim()) return "Completá el resumen.";

    if (assignmentMode === "direct") {
      if (directAssignees.length !== requiredDirectCount) {
        return `En asignación directa, debés elegir ${requiredDirectCount} abogado(s).`;
      }
      if (!directJustification.trim() || directJustification.trim().length < 10) {
        return "La justificación es obligatoria (mínimo 10 caracteres).";
      }
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const err = validate();
    if (err) {
      setMsg("⚠️ " + err);
      return;
    }

    setSaving(true);
    try {
      const res = await createCaseWithInvites({
        caratulaTentativa,
        specialtyId,
        objeto,
        resumen,
        jurisdiccion,
        broughtByParticipates,
        assignmentMode,
        directAssigneesUids: assignmentMode === "direct" ? directAssignees : [],
        directJustification: assignmentMode === "direct" ? directJustification : "",
      });

      router.replace(`/cases/${res.caseId}`);
    } catch (e: any) {
      setMsg("❌ Error: " + (e?.message ?? "desconocido"));
    } finally {
      setSaving(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  if (!authReady) {
    return (
      <AppShell
        title="Nueva causa"
        userEmail={user?.email ?? null}
        role={role}
        pendingInvites={pendingInvites}
        onLogout={doLogout}
      >
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">Cargando...</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Nueva causa"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      <div className="mb-4">
        <h1 className="text-xl font-black">Nueva causa</h1>
        <div className="mt-1 text-sm text-black/60">
          Completá los datos para crear la causa y, si corresponde, invitar/asignar abogados.
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4">
        {/* Carátula */}
        <label className="grid gap-2">
          <span className="text-sm font-extrabold">Carátula tentativa</span>
          <input
            value={caratulaTentativa}
            onChange={(e) => setCaratulaTentativa(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
          />
        </label>

        {/* Materia */}
        <label className="grid gap-2">
          <span className="text-sm font-extrabold">Materia (especialidad)</span>
          <select
            value={specialtyId}
            onChange={(e) => setSpecialtyId(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold"
          >
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {/* Objeto */}
        <label className="grid gap-2">
          <span className="text-sm font-extrabold">Objeto</span>
          <textarea
            value={objeto}
            onChange={(e) => setObjeto(e.target.value)}
            className="min-h-[96px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
          />
        </label>

        {/* Resumen */}
        <label className="grid gap-2">
          <span className="text-sm font-extrabold">Resumen</span>
          <textarea
            value={resumen}
            onChange={(e) => setResumen(e.target.value)}
            className="min-h-[96px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
          />
        </label>

        {/* Jurisdicción */}
        <label className="grid gap-2">
          <span className="text-sm font-extrabold">Jurisdicción</span>
          <select
            value={jurisdiccion}
            onChange={(e) => setJurisdiccion(e.target.value as Jurisdiccion)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold"
          >
            <option value="nacional">Nacional</option>
            <option value="federal">Federal</option>
            <option value="caba">CABA</option>
            <option value="provincia_bs_as">Provincia de Bs. As.</option>
          </select>
        </label>

        {/* Participa */}
        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-sm">
          <input
            type="checkbox"
            checked={broughtByParticipates}
            onChange={(e) => setBroughtByParticipates(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="font-extrabold">Voy a participar directamente en la causa</span>
        </label>

        {/* Modo de asignación */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-black">Modo de asignación</div>

          <div className="mt-3 grid gap-2">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="radio"
                name="assignmentMode"
                checked={assignmentMode === "auto"}
                onChange={() => setAssignmentMode("auto")}
                className="h-4 w-4"
              />
              <span className="font-extrabold">Asignación automática</span>
              <span className="text-black/60">(turno estricto)</span>
            </label>

            <label className="flex items-center gap-3 text-sm">
              <input
                type="radio"
                name="assignmentMode"
                checked={assignmentMode === "direct"}
                onChange={() => setAssignmentMode("direct")}
                className="h-4 w-4"
              />
              <span className="font-extrabold">Asignación directa</span>
              <span className="text-black/60">(con justificación)</span>
            </label>
          </div>

          {assignmentMode === "direct" ? (
            <div className="mt-4 grid gap-3">
              <div className="text-sm text-black/70">
                Elegí <span className="font-black">{requiredDirectCount}</span> abogado(s) (sin restricciones):
              </div>

              <div className="max-h-[260px] overflow-auto rounded-xl border border-gray-200 p-3">
                {practicingUsers.map((u) => {
                  const checked = directAssigneesSet.has(u.uid);
                  const disabled = !checked && directAssignees.length >= requiredDirectCount;

                  return (
                    <label key={u.uid} className="flex items-center gap-3 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDirectAssignee(u.uid)}
                        disabled={disabled}
                        className="h-4 w-4 disabled:opacity-60"
                      />
                      <span className="font-semibold">{u.email}</span>
                      <span className="text-black/50">({u.role})</span>
                    </label>
                  );
                })}
              </div>

              <label className="grid gap-2">
                <span className="text-sm font-extrabold">Justificación (obligatoria)</span>
                <textarea
                  value={directJustification}
                  onChange={(e) => setDirectJustification(e.target.value)}
                  className="min-h-[88px] w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold"
                />
              </label>

              <div className="text-xs text-black/60">
                Recordatorio: mínimo 10 caracteres. Queda registrada en la invitación.
              </div>
            </div>
          ) : null}
        </div>

        {msg ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm font-bold">
            {msg}
          </div>
        ) : null}

        <button
          disabled={saving}
          className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-extrabold shadow-sm hover:bg-gray-50 disabled:opacity-60"
        >
          {saving ? "Guardando..." : "Guardar causa"}
        </button>
      </form>
    </AppShell>
  );
}