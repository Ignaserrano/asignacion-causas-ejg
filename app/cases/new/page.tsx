"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import { getUserProfile } from "@/lib/users";
import { listActiveSpecialties, listPracticingUsers } from "@/lib/data";

import { createCaseWithInvites } from "@/lib/cases";

type Jurisdiccion = "nacional" | "federal" | "caba" | "provincia_bs_as";
type AssignmentMode = "auto" | "direct";

type Specialty = { id: string; name: string; active: boolean };
type UserRow = { uid: string; email: string; role: string };

export default function NewCasePage() {
  const router = useRouter();

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

  // Auth guard
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }
      setUid(u.uid);

      const profile = await getUserProfile(u.uid);
      if (!profile) {
        router.replace("/dashboard");
        return;
      }
      setAuthReady(true);
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
  
    if (!authReady) return <main style={{ padding: 16 }}>Cargando...</main>;

  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 12 }}>Nueva causa</h1>

      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <label>
          Carátula tentativa
          <input
            value={caratulaTentativa}
            onChange={(e) => setCaratulaTentativa(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          />
        </label>

        <label>
          Materia (especialidad)
          <select
            value={specialtyId}
            onChange={(e) => setSpecialtyId(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          >
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Objeto
          <textarea
            value={objeto}
            onChange={(e) => setObjeto(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6, minHeight: 90 }}
          />
        </label>

        <label>
          Resumen
          <textarea
            value={resumen}
            onChange={(e) => setResumen(e.target.value)}
            style={{ width: "100%", padding: 10, marginTop: 6, minHeight: 90 }}
          />
        </label>

        <label>
          Jurisdicción
          <select
            value={jurisdiccion}
            onChange={(e) => setJurisdiccion(e.target.value as Jurisdiccion)}
            style={{ width: "100%", padding: 10, marginTop: 6 }}
          >
            <option value="nacional">Nacional</option>
            <option value="federal">Federal</option>
            <option value="caba">CABA</option>
            <option value="provincia_bs_as">Provincia de Bs. As.</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={broughtByParticipates}
            onChange={(e) => setBroughtByParticipates(e.target.checked)}
          />
          Voy a participar directamente en la causa
        </label>

        <div style={{ border: "1px solid #ddd", padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Modo de asignación</div>

          <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
            <input
              type="radio"
              name="assignmentMode"
              checked={assignmentMode === "auto"}
              onChange={() => setAssignmentMode("auto")}
            />
            Asignación automática (turno estricto)
          </label>

          <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              type="radio"
              name="assignmentMode"
              checked={assignmentMode === "direct"}
              onChange={() => setAssignmentMode("direct")}
            />
            Asignación directa (con justificación)
          </label>

          {assignmentMode === "direct" && (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div>
                Elegí <b>{requiredDirectCount}</b> abogado(s) (sin restricciones):
              </div>

              <div style={{ border: "1px solid #eee", padding: 10, maxHeight: 240, overflow: "auto" }}>
                {practicingUsers.map((u) => (
                  <label key={u.uid} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={directAssigneesSet.has(u.uid)}
                      onChange={() => toggleDirectAssignee(u.uid)}
                      disabled={!directAssigneesSet.has(u.uid) && directAssignees.length >= requiredDirectCount}
                    />
                    <span>{u.email}</span>
                    <span style={{ opacity: 0.6 }}>({u.role})</span>
                  </label>
                ))}
              </div>

              <label>
                Justificación (obligatoria)
                <textarea
                  value={directJustification}
                  onChange={(e) => setDirectJustification(e.target.value)}
                  style={{ width: "100%", padding: 10, marginTop: 6, minHeight: 80 }}
                />
              </label>
            </div>
          )}
        </div>

        {msg && (
          <p>
            <b>{msg}</b>
          </p>
        )}

        <button disabled={saving} style={{ padding: 10, cursor: "pointer" }}>
          {saving ? "Guardando..." : "Guardar causa"}
        </button>
      </form>
    </main>
  );
}