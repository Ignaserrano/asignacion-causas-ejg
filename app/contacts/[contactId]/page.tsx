"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import AppShell from "@/components/AppShell";
import { auth, db } from "@/lib/firebase";

type ContactType =
  | "cliente"
  | "abogado_contraria"
  | "demandado"
  | "conciliador"
  | "perito"
  | "otro";

type CivilStatus =
  | "soltero"
  | "casado"
  | "divorciado"
  | "viudo"
  | "separado_hecho"
  | "concubinato";

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function buildFullName(name: string, lastName: string) {
  return `${String(name ?? "").trim()} ${String(lastName ?? "").trim()}`.trim();
}

export default function ContactEditPage() {
  const params = useParams<{ contactId: string }>();
  const contactId = params.contactId;
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState("lawyer");
  const [pendingInvites, setPendingInvites] = useState(0);

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [type, setType] = useState<ContactType>("cliente");

  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nationality, setNationality] = useState("");
  const [address, setAddress] = useState("");
  const [dni, setDni] = useState("");
  const [cuit, setCuit] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [civilStatus, setCivilStatus] = useState<CivilStatus>("soltero");
  const [marriageCount, setMarriageCount] = useState("");
  const [spouseName, setSpouseName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [referredBy, setReferredBy] = useState("");
  const [notes, setNotes] = useState("");

  const [tuition, setTuition] = useState("");
  const [conciliationArea, setConciliationArea] = useState("");
  const [specialtyArea, setSpecialtyArea] = useState("");

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
    });

    return () => unsub();
  }, [router]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      setMsg(null);

      try {
        const snap = await getDoc(doc(db, "contacts", contactId));
        if (!snap.exists()) {
          setMsg("No existe el contacto.");
          setLoading(false);
          return;
        }

        const d = snap.data() as any;
        setType((d?.type ?? "cliente") as ContactType);
        setName(String(d?.name ?? ""));
        setLastName(String(d?.lastName ?? ""));
        setNationality(String(d?.nationality ?? ""));
        setAddress(String(d?.address ?? ""));
        setDni(String(d?.dni ?? ""));
        setCuit(String(d?.cuit ?? ""));
        setBirthDate(String(d?.birthDate ?? ""));
        setCivilStatus((d?.civilStatus ?? "soltero") as CivilStatus);
        setMarriageCount(String(d?.marriageCount ?? ""));
        setSpouseName(String(d?.spouseName ?? ""));
        setPhone(String(d?.phone ?? ""));
        setEmail(String(d?.email ?? ""));
        setReferredBy(String(d?.referredBy ?? ""));
        setNotes(String(d?.notes ?? ""));
        setTuition(String(d?.tuition ?? ""));
        setConciliationArea(String(d?.conciliationArea ?? ""));
        setSpecialtyArea(String(d?.specialtyArea ?? ""));
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando contacto");
      } finally {
        setLoading(false);
      }
    })();
  }, [user, contactId]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  const fullName = useMemo(() => buildFullName(name, lastName), [name, lastName]);

  async function save() {
    if (!user) return;
    setMsg(null);

    if (!name.trim()) {
      setMsg("El nombre es obligatorio.");
      return;
    }

    if (!lastName.trim() && type !== "otro") {
      setMsg("El apellido es obligatorio.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        type,
        name: name.trim(),
        lastName: lastName.trim(),
        fullName,
        nameLower: safeLower(fullName),
        address: address.trim(),
        dni: dni.trim(),
        cuit: cuit.trim(),
        phone: phone.trim(),
        email: email.trim(),
        notes: notes.trim(),
        updatedAt: serverTimestamp(),

        nationality: "",
        birthDate: "",
        civilStatus: "",
        marriageCount: "",
        spouseName: "",
        referredBy: "",
        tuition: "",
        conciliationArea: "",
        specialtyArea: "",
      };

      if (type === "cliente") {
        payload.nationality = nationality.trim();
        payload.birthDate = birthDate || "";
        payload.civilStatus = civilStatus;
        payload.marriageCount = civilStatus === "casado" ? marriageCount.trim() : "";
        payload.spouseName = civilStatus === "casado" ? spouseName.trim() : "";
        payload.referredBy = referredBy.trim();
      }

      if (type === "abogado_contraria") {
        payload.tuition = tuition.trim();
      }

      if (type === "demandado") {
        payload.nationality = nationality.trim();
      }

      if (type === "conciliador") {
        payload.conciliationArea = conciliationArea.trim();
      }

      if (type === "perito") {
        payload.specialtyArea = specialtyArea.trim();
      }

      await updateDoc(doc(db, "contacts", contactId), payload);
    } catch (e: any) {
      setMsg(e?.message ?? "Error guardando");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar este contacto?")) return;
    try {
      await deleteDoc(doc(db, "contacts", contactId));
      router.replace("/contacts");
    } catch (e: any) {
      setMsg(e?.message ?? "Error eliminando");
    }
  }

  return (
    <AppShell
      title="Editar contacto"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo de contacto</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ContactType)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="cliente">Cliente</option>
                <option value="abogado_contraria">Abogado contraria</option>
                <option value="demandado">Demandado</option>
                <option value="conciliador">Conciliador</option>
                <option value="perito">Perito</option>
                <option value="otro">Otro</option>
              </select>
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nombre *</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Apellido {type !== "otro" ? "*" : ""}</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            </div>

            {type === "cliente" && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nacionalidad</span>
                    <input
                      value={nationality}
                      onChange={(e) => setNationality(e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Fecha de nacimiento</span>
                    <input
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI</span>
                    <input
                      value={dni}
                      onChange={(e) => setDni(e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">CUIT/CUIL</span>
                    <input
                      value={cuit}
                      onChange={(e) => setCuit(e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                </div>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Estado civil</span>
                  <select
                    value={civilStatus}
                    onChange={(e) => setCivilStatus(e.target.value as CivilStatus)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="soltero">Soltero</option>
                    <option value="casado">Casado</option>
                    <option value="divorciado">Divorciado</option>
                    <option value="viudo">Viudo</option>
                    <option value="separado_hecho">Separado de hecho</option>
                    <option value="concubinato">En concubinato</option>
                  </select>
                </label>

                {civilStatus === "casado" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">En ... nupcias</span>
                      <input
                        value={marriageCount}
                        onChange={(e) => setMarriageCount(e.target.value)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </label>

                    <label className="grid gap-1">
                      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nombre cónyuge</span>
                      <input
                        value={spouseName}
                        onChange={(e) => setSpouseName(e.target.value)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </label>
                  </div>
                )}

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Referido por</span>
                  <input
                    value={referredBy}
                    onChange={(e) => setReferredBy(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              </>
            )}

            {type === "abogado_contraria" && (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">CUIT</span>
                  <input
                    value={cuit}
                    onChange={(e) => setCuit(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Matrícula</span>
                  <input
                    value={tuition}
                    onChange={(e) => setTuition(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              </div>
            )}

            {type === "demandado" && (
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Nacionalidad</span>
                  <input
                    value={nationality}
                    onChange={(e) => setNationality(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI</span>
                  <input
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              </div>
            )}

            {type === "conciliador" && (
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Área de conciliación / mediación</span>
                <input
                  value={conciliationArea}
                  onChange={(e) => setConciliationArea(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            )}

            {type === "perito" && (
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Área de especialidad</span>
                <input
                  value={specialtyArea}
                  onChange={(e) => setSpecialtyArea(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            )}

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Domicilio</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Teléfono</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Email</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                {type === "cliente" || type === "demandado" ? "Otros datos" : "Otros"}
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[100px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
              >
                Guardar cambios
              </button>

              <button
                onClick={() => router.push("/contacts")}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                Volver
              </button>

              <button
                onClick={remove}
                className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-extrabold text-red-700 hover:bg-red-50"
              >
                Eliminar contacto
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}