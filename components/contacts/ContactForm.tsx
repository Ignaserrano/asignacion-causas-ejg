"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type ContactType =
  | "cliente"
  | "abogado_contraria"
  | "demandado"
  | "conciliador"
  | "perito"
  | "otro";

export type PersonType = "fisica" | "juridica";

export type CivilStatus =
  | "soltero"
  | "casado"
  | "divorciado"
  | "viudo"
  | "separado_hecho"
  | "concubinato";

export type CreatedContact = {
  id: string;
  type?: string;
  personType?: string;
  name?: string;
  lastName?: string;
  fullName?: string;
  nameLower?: string;
  nationality?: string;
  address?: string;
  dni?: string;
  cuit?: string;
  birthDate?: string;
  civilStatus?: string;
  marriageCount?: string;
  spouseName?: string;
  phone?: string;
  email?: string;
  referredBy?: string;
  notes?: string;
  tuition?: string;
  conciliationArea?: string;
  specialtyArea?: string;
};

function safeLower(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function buildFullName(personType: PersonType, name: string, lastName: string) {
  if (personType === "juridica") {
    return String(name ?? "").trim();
  }
  return `${String(name ?? "").trim()} ${String(lastName ?? "").trim()}`.trim();
}

export default function ContactForm({
  userUid,
  onSaved,
  onCancel,
  submitLabel = "Guardar contacto",
  cancelLabel = "Cancelar",
}: {
  userUid: string;
  onSaved?: (contact: CreatedContact) => void;
  onCancel?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
}) {
  const [type, setType] = useState<ContactType>("cliente");
  const [personType, setPersonType] = useState<PersonType>("fisica");

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

  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (personType === "juridica") {
      setLastName("");
      setBirthDate("");
      setCivilStatus("soltero");
      setMarriageCount("");
      setSpouseName("");
      setNationality("");
      setDni("");
    }
  }, [personType]);

  const fullName = useMemo(
    () => buildFullName(personType, name, lastName),
    [personType, name, lastName]
  );

  async function save() {
    setMsg(null);

    if (!name.trim()) {
      setMsg(personType === "juridica" ? "La razón social es obligatoria." : "El nombre es obligatorio.");
      return;
    }

    if (personType === "fisica" && !lastName.trim() && type !== "otro") {
      setMsg("El apellido es obligatorio.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        type,
        personType,
        name: name.trim(),
        lastName: personType === "fisica" ? lastName.trim() : "",
        fullName: fullName.trim(),
        nameLower: safeLower(fullName),
        address: address.trim(),
        dni: personType === "fisica" ? dni.trim() : "",
        cuit: cuit.trim(),
        phone: phone.trim(),
        email: email.trim(),
        notes: notes.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: userUid,
      };

      if (type === "cliente") {
        payload.nationality = personType === "fisica" ? nationality.trim() : "";
        payload.birthDate = personType === "fisica" ? birthDate || "" : "";
        payload.civilStatus = personType === "fisica" ? civilStatus : "";
        payload.marriageCount =
          personType === "fisica" && civilStatus === "casado" ? marriageCount.trim() : "";
        payload.spouseName =
          personType === "fisica" && civilStatus === "casado" ? spouseName.trim() : "";
        payload.referredBy = referredBy.trim();
      }

      if (type === "abogado_contraria") {
        payload.tuition = tuition.trim();
      }

      if (type === "demandado") {
        payload.nationality = personType === "fisica" ? nationality.trim() : "";
      }

      if (type === "conciliador") {
        payload.conciliationArea = conciliationArea.trim();
      }

      if (type === "perito") {
        payload.specialtyArea = specialtyArea.trim();
      }

      const ref = await addDoc(collection(db, "contacts"), payload);

      if (onSaved) {
        onSaved({
          id: ref.id,
          ...payload,
        });
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Error guardando contacto");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

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

        <label className="grid gap-1">
          <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo de persona</span>
          <select
            value={personType}
            onChange={(e) => setPersonType(e.target.value as PersonType)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="fisica">Persona física</option>
            <option value="juridica">Persona jurídica</option>
          </select>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              {personType === "juridica" ? "Nombre / Razón social *" : "Nombre *"}
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>

          {personType === "fisica" ? (
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Apellido {type !== "otro" ? "*" : ""}
              </span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          ) : (
            <div />
          )}
        </div>

        {type === "cliente" && (
          <>
            {personType === "fisica" ? (
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

                {civilStatus === "casado" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="grid gap-1">
                      <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">En ... nupcias</span>
                      <input
                        value={marriageCount}
                        onChange={(e) => setMarriageCount(e.target.value)}
                        placeholder="Ej: primeras / segundas"
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
                ) : null}
              </>
            ) : (
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">CUIT</span>
                <input
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
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
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                {personType === "fisica" ? "Matrícula" : "Matrícula / dato identificatorio"}
              </span>
              <input
                value={tuition}
                onChange={(e) => setTuition(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          </div>
        )}

        {type === "demandado" && (
          <>
            {personType === "fisica" ? (
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
                    <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI</span>
                    <input
                      value={dni}
                      onChange={(e) => setDni(e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                </div>

                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">CUIT/CUIL</span>
                  <input
                    value={cuit}
                    onChange={(e) => setCuit(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              </>
            ) : (
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">CUIT</span>
                <input
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            )}
          </>
        )}

        {type === "conciliador" && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {personType === "fisica" ? (
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI</span>
                  <input
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              ) : (
                <div />
              )}

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  {personType === "fisica" ? "CUIT/CUIL" : "CUIT"}
                </span>
                <input
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Área de conciliación / mediación</span>
              <input
                value={conciliationArea}
                onChange={(e) => setConciliationArea(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          </>
        )}

        {type === "perito" && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {personType === "fisica" ? (
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">DNI</span>
                  <input
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              ) : (
                <div />
              )}

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  {personType === "fisica" ? "CUIT/CUIL" : "CUIT"}
                </span>
                <input
                  value={cuit}
                  onChange={(e) => setCuit(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Área de especialidad</span>
              <input
                value={specialtyArea}
                onChange={(e) => setSpecialtyArea(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>
          </>
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
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Guardando..." : submitLabel}
          </button>

          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              {cancelLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}