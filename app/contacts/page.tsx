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
  query,
  orderBy,
  limit,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import { PartyRole } from "@/lib/caseManagement";

type ContactRow = {
  id: string;
  type?: string;
  personType?: string;
  name?: string;
  lastName?: string;
  fullName?: string;
  nameLower?: string;
  dni?: string;
  cuit?: string;
  email?: string;
  phone?: string;
  address?: string;
  nationality?: string;
  birthDate?: string;
  civilStatus?: string;
  marriageCount?: string;
  spouseName?: string;
  referredBy?: string;
  notes?: string;
  tuition?: string;
  conciliationArea?: string;
  specialtyArea?: string;
};

type ContactCaseRow = {
  caseId: string;
  caratula: string;
  roles: PartyRole[];
};

const PAGE_SIZE = 25;

function safeText(value: any) {
  return String(value ?? "").trim();
}

function safeLower(value: any) {
  return safeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizePersonType(value: any): "fisica" | "juridica" {
  const v = safeLower(value);

  if (
    v === "juridica" ||
    v === "persona juridica" ||
    v === "persona_juridica" ||
    v === "empresa" ||
    v === "sociedad"
  ) {
    return "juridica";
  }

  return "fisica";
}

function labelType(type?: string) {
  switch (type) {
    case "cliente":
      return "Cliente";
    case "abogado_contraria":
      return "Abogado contraria";
    case "demandado":
      return "Demandado";
    case "conciliador":
      return "Conciliador";
    case "perito":
      return "Perito";
    default:
      return "Otro";
  }
}

function labelPersonType(personType?: string) {
  return normalizePersonType(personType) === "juridica"
    ? "Persona jurídica"
    : "Persona física";
}

function roleLabel(role?: PartyRole) {
  switch (role) {
    case "actor":
      return "Actor";
    case "demandado":
      return "Demandado";
    case "citado_garantia":
      return "Citado en garantía";
    case "imputado":
      return "Imputado";
    case "querellante":
      return "Querellante";
    case "causante":
      return "Causante";
    case "fallido":
      return "Fallido";
    default:
      return "Otro";
  }
}

function getDisplayName(c: ContactRow) {
  const personType = normalizePersonType(c.personType);
  const name = safeText(c.name);
  const lastName = safeText(c.lastName);
  const fullName = safeText(c.fullName);

  if (personType === "juridica") {
    if (name) return name;
    if (fullName) return fullName;
    return "(sin nombre)";
  }

  if (lastName || name) {
    return `${lastName}${lastName && name ? ", " : ""}${name}`.trim();
  }

  if (fullName) return fullName;
  return "(sin nombre)";
}

function getSearchableText(c: ContactRow) {
  const personType = normalizePersonType(c.personType);
  const name = safeText(c.name);
  const lastName = safeText(c.lastName);
  const fullName = safeText(c.fullName);
  const dni = safeText(c.dni);
  const cuit = safeText(c.cuit);
  const email = safeText(c.email);

  if (personType === "juridica") {
    return safeLower([name, fullName, cuit, email].join(" "));
  }

  return safeLower(
    [name, lastName, fullName, `${lastName} ${name}`, `${name} ${lastName}`, dni, cuit, email].join(
      " "
    )
  );
}

function getSortKey(c: ContactRow) {
  const personType = normalizePersonType(c.personType);
  const name = safeText(c.name);
  const lastName = safeText(c.lastName);
  const fullName = safeText(c.fullName);

  if (personType === "juridica") {
    return safeLower(name || fullName);
  }

  const ln = safeLower(lastName);
  const nm = safeLower(name);
  const fn = safeLower(fullName);

  if (ln || nm) return `${ln} ${nm}`.trim();
  return fn;
}

function compareContactsAsc(a: ContactRow, b: ContactRow) {
  const aKey = getSortKey(a);
  const bKey = getSortKey(b);

  const byKey = aKey.localeCompare(bKey, "es");
  if (byKey !== 0) return byKey;

  return safeLower(getDisplayName(a)).localeCompare(safeLower(getDisplayName(b)), "es");
}

function Field({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  return (
    <div className="grid gap-1 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/60">
      <div className="text-xs font-extrabold text-gray-600 dark:text-gray-300">{label}</div>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
        {safeText(value) || "-"}
      </div>
    </div>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="text-base font-black text-gray-900 dark:text-gray-100">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ContactDetailsContent({ contact }: { contact: ContactRow }) {
  const personType = normalizePersonType(contact.personType);
  const type = safeText(contact.type);

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Tipo de contacto" value={labelType(contact.type)} />
        <Field label="Tipo de persona" value={labelPersonType(contact.personType)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label={personType === "juridica" ? "Razón social" : "Nombre"}
          value={contact.name}
        />
        {personType === "fisica" ? (
          <Field label="Apellido" value={contact.lastName} />
        ) : (
          <Field label="Apellido" value="-" />
        )}
      </div>

      {type === "cliente" && (
        <>
          {personType === "fisica" ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Nacionalidad" value={contact.nationality} />
                <Field label="Fecha de nacimiento" value={contact.birthDate} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="DNI" value={contact.dni} />
                <Field label="CUIT/CUIL" value={contact.cuit} />
              </div>

              <Field label="Estado civil" value={contact.civilStatus} />

              {safeText(contact.civilStatus) === "casado" ? (
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="En ... nupcias" value={contact.marriageCount} />
                  <Field label="Nombre cónyuge" value={contact.spouseName} />
                </div>
              ) : null}
            </>
          ) : (
            <Field label="CUIT" value={contact.cuit} />
          )}

          <Field label="Referido por" value={contact.referredBy} />
        </>
      )}

      {type === "abogado_contraria" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="CUIT" value={contact.cuit} />
          <Field
            label={personType === "fisica" ? "Matrícula" : "Matrícula / dato identificatorio"}
            value={contact.tuition}
          />
        </div>
      )}

      {type === "demandado" && (
        <>
          {personType === "fisica" ? (
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Nacionalidad" value={contact.nationality} />
              <Field label="DNI" value={contact.dni} />
              <Field label="CUIT/CUIL" value={contact.cuit} />
            </div>
          ) : (
            <Field label="CUIT" value={contact.cuit} />
          )}
        </>
      )}

      {type === "conciliador" && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {personType === "fisica" ? (
              <Field label="DNI" value={contact.dni} />
            ) : (
              <Field label="DNI" value="-" />
            )}
            <Field label={personType === "fisica" ? "CUIT/CUIL" : "CUIT"} value={contact.cuit} />
          </div>
          <Field label="Área de conciliación / mediación" value={contact.conciliationArea} />
        </>
      )}

      {type === "perito" && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {personType === "fisica" ? (
              <Field label="DNI" value={contact.dni} />
            ) : (
              <Field label="DNI" value="-" />
            )}
            <Field label={personType === "fisica" ? "CUIT/CUIL" : "CUIT"} value={contact.cuit} />
          </div>
          <Field label="Área de especialidad" value={contact.specialtyArea} />
        </>
      )}

      <Field label="Domicilio" value={contact.address} />

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Teléfono" value={contact.phone} />
        <Field label="Email" value={contact.email} />
      </div>

      <Field
        label={type === "cliente" || type === "demandado" ? "Otros datos" : "Otros"}
        value={contact.notes}
      />
    </div>
  );
}

export default function ContactsListPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState("lawyer");
  const [pendingInvites, setPendingInvites] = useState(0);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const [allRows, setAllRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [page, setPage] = useState(1);

  const [casesModalOpen, setCasesModalOpen] = useState(false);
  const [casesModalContactName, setCasesModalContactName] = useState("");
  const [casesLoading, setCasesLoading] = useState(false);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [contactCases, setContactCases] = useState<ContactCaseRow[]>([]);

  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [detailsContact, setDetailsContact] = useState<ContactRow | null>(null);

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

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!user) return;

      setLoading(true);
      setMsg(null);

      try {
        const qRef = query(
          collection(db, "contacts"),
          orderBy("nameLower", "asc"),
          limit(1000)
        );

        const snap = await getDocs(qRef);
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ContactRow[];

        if (!alive) return;
        setAllRows(list);
      } catch (e: any) {
        if (!alive) return;
        setMsg(e?.message ?? "Error cargando contactos");
        setAllRows([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter]);

  const filteredRows = useMemo(() => {
    const s = safeLower(search);

    const list = allRows.filter((c) => {
      const matchesType = typeFilter === "all" ? true : safeText(c.type) === typeFilter;
      if (!matchesType) return false;

      if (!s) return true;
      return getSearchableText(c).includes(s);
    });

    return [...list].sort(compareContactsAsc);
  }, [allRows, search, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredRows.slice(start, start + PAGE_SIZE);
  }, [filteredRows, currentPage]);

  const fromRow = filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const toRow = Math.min(currentPage * PAGE_SIZE, filteredRows.length);

  function openDetailsModal(contact: ContactRow) {
    setDetailsContact(contact);
    setDetailsModalOpen(true);
  }

  async function openCasesModal(contact: ContactRow) {
    const contactName = getDisplayName(contact);

    setCasesModalOpen(true);
    setCasesModalContactName(contactName);
    setCasesLoading(true);
    setCasesError(null);
    setContactCases([]);

    try {
      const snap = await getDocs(
        query(
          collection(db, "contacts", contact.id, "caseLinks"),
          orderBy("caratula", "asc"),
          limit(200)
        )
      );

      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          caseId: String(data?.caseId ?? d.id),
          caratula: String(data?.caratula ?? "").trim() || "(sin carátula)",
          roles: Array.isArray(data?.roles) ? (data.roles as PartyRole[]) : [],
        } satisfies ContactCaseRow;
      });

      setContactCases(rows);
    } catch (e: any) {
      setCasesError(e?.message ?? "No se pudieron cargar las causas de este contacto.");
      setContactCases([]);
    } finally {
      setCasesLoading(false);
    }
  }

  function goToCase(caseId: string) {
    setCasesModalOpen(false);
    router.push(`/cases/${caseId}`);
  }

  return (
    <AppShell
      title="Agenda de contactos"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          ⚠️ {msg}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 md:grid-cols-2">
          <div className="min-w-[220px]">
            <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Buscar contacto
            </label>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              placeholder="Apellido, nombre o razón social..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="min-w-[180px]">
            <label className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Filtrar por tipo
            </label>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="cliente">Cliente</option>
              <option value="abogado_contraria">Abogado contraria</option>
              <option value="demandado">Demandado</option>
              <option value="conciliador">Conciliador</option>
              <option value="perito">Perito</option>
              <option value="otro">Otro</option>
            </select>
          </div>
        </div>

        <Link
          href="/contacts/new"
          className="rounded-xl bg-black px-3 py-2 text-sm font-extrabold text-white hover:opacity-90"
        >
          Nuevo contacto
        </Link>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
          {loading
            ? "Cargando contactos..."
            : `Mostrando ${fromRow}-${toRow} de ${filteredRows.length} contacto(s)`}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          No hay contactos.
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="hidden grid-cols-[2.2fr_1fr_1.4fr_auto] gap-3 border-b border-gray-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-gray-600 dark:border-gray-800 dark:text-gray-300 md:grid">
              <div>Contacto</div>
              <div>Teléfono</div>
              <div>Email</div>
              <div>Acciones</div>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {paginatedRows.map((c) => (
                <div
                  key={c.id}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[2.2fr_1fr_1.4fr_auto] md:items-center"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {getDisplayName(c)}
                      </div>

                      <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                        {labelType(c.type)}
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 md:hidden">
                      {c.phone ? `Tel: ${c.phone}` : "Tel: -"}
                      {" · "}
                      {c.email ? c.email : "Email: -"}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 md:hidden">
                      <button
                        type="button"
                        onClick={() => openDetailsModal(c)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Ver completo
                      </button>

                      <button
                        type="button"
                        onClick={() => openCasesModal(c)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Ver causas
                      </button>

                      <Link
                        href={`/contacts/${c.id}/edit`}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                      >
                        Editar
                      </Link>
                    </div>
                  </div>

                  <div className="hidden text-sm font-semibold text-gray-700 dark:text-gray-200 md:block">
                    {c.phone || "-"}
                  </div>

                  <div className="hidden text-sm font-semibold text-gray-700 dark:text-gray-200 md:block">
                    {c.email || "-"}
                  </div>

                  <div className="hidden md:flex md:flex-wrap md:justify-end md:gap-2">
                    <button
                      type="button"
                      onClick={() => openDetailsModal(c)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      Ver completo
                    </button>

                    <button
                      type="button"
                      onClick={() => openCasesModal(c)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      Ver causas
                    </button>

                    <Link
                      href={`/contacts/${c.id}/edit`}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-900 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                    >
                      Editar
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-bold text-gray-600 dark:text-gray-300">
              Página {currentPage} de {totalPages}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              >
                Anterior
              </button>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}

      <Modal
        open={detailsModalOpen}
        title={detailsContact ? `Ficha de ${getDisplayName(detailsContact)}` : "Ficha del contacto"}
        onClose={() => {
          setDetailsModalOpen(false);
          setDetailsContact(null);
        }}
      >
        {detailsContact ? <ContactDetailsContent contact={detailsContact} /> : null}
      </Modal>

      <Modal
        open={casesModalOpen}
        title={`Causas de ${casesModalContactName}`}
        onClose={() => setCasesModalOpen(false)}
      >
        {casesLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            Cargando causas...
          </div>
        ) : casesError ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            ⚠️ {casesError}
          </div>
        ) : contactCases.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
            Este contacto no participa en ninguna causa cargada.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <div className="hidden grid-cols-[2fr_1fr] gap-3 border-b border-gray-200 px-4 py-3 text-xs font-black uppercase tracking-wide text-gray-600 dark:border-gray-800 dark:text-gray-300 md:grid">
              <div>Carátula</div>
              <div>Rol</div>
            </div>

            <div className="divide-y divide-gray-200 dark:divide-gray-800">
              {contactCases.map((row) => (
                <button
                  key={row.caseId}
                  type="button"
                  onClick={() => goToCase(row.caseId)}
                  className="grid w-full gap-2 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/40 md:grid-cols-[2fr_1fr] md:items-center"
                >
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {row.caratula}
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {row.roles.length > 0 ? (
                      row.roles.map((r) => (
                        <span
                          key={`${row.caseId}-${r}`}
                          className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-black text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                        >
                          {roleLabel(r)}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-gray-600 dark:text-gray-300">-</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}