"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import { getChargeUserNetAmount } from "@/lib/charges";

type ChargeRow = {
  id: string;
  status: "scheduled" | "paid" | "cancelled";
  ownerUid?: string;
  caseRef?: {
    caseId?: string | null;
    caratula?: string;
    isExtraCase?: boolean;
    extraCaseReason?: string;
  };
  payerRef?: {
    displayName?: string;
    email?: string;
    phone?: string;
    cuit?: string;
  };
  totalAmount?: number;
  currency?: "ARS" | "USD";
  paidAt?: any;
  installments?: {
    enabled?: boolean;
    total?: number;
    current?: number;
  };
  distribution?: {
    grossAmount?: number;
    deductionsTotal?: number;
    baseNetAmount?: number;
    studioFundAmount?: number;
    distributableAmount?: number;
    participants?: Array<{
      id: string;
      uid?: string;
      displayName: string;
      percent: number;
      amount: number;
      kind: "lawyer" | "external";
    }>;
  };
  transferTicket?: {
    status?: "pending" | "done";
    createdAt?: any;
    confirmedAt?: any;
    confirmedByUid?: string;
  };
};

function safeText(v: any) {
  return String(v ?? "").trim();
}

function safeLower(v: any) {
  return safeText(v).toLowerCase();
}

function toDate(value?: any) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(v?: any) {
  const d = toDate(v);
  if (!d) return "-";
  return d.toLocaleDateString("es-AR");
}

function fmtMoney(n?: number, currency?: string) {
  return `${Number(n ?? 0).toLocaleString("es-AR")} ${currency ?? ""}`.trim();
}

function monthKeyFromDate(value: any) {
  const d = toDate(value);
  if (!d) return "sin-fecha";
  const y = d.getFullYear();
  const m = d.getMonth();
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthLabelFromKey(key: string) {
  if (key === "sin-fecha") return "Sin fecha";
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString("es-AR", {
    year: "numeric",
    month: "long",
  });
}

function getCauseLabel(
  row: ChargeRow,
  casesMap: Record<string, string>
) {
  if (row.caseRef?.isExtraCase) {
    return safeText(row.caseRef?.extraCaseReason) || "Extra-causa";
  }

  return (
    safeText(row.caseRef?.caratula) ||
    safeText(casesMap[safeText(row.caseRef?.caseId)]) ||
    "(sin carátula)"
  );
}

export default function RealizadasPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const queryCaseId = searchParams.get("caseId");

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [msg, setMsg] = useState<string | null>(null);
  const [loadingShell, setLoadingShell] = useState(true);
  const [loadingData, setLoadingData] = useState(true);

  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [casesMap, setCasesMap] = useState<Record<string, string>>({});
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState<"all" | "ARS" | "USD">("all");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.replace("/login");
        return;
      }

      setUser(u);
      setLoadingShell(true);
      setLoadingData(true);
      setMsg(null);

      try {
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const userData = userSnap.exists() ? (userSnap.data() as any) : {};
        setRole(String(userData?.role ?? "lawyer"));

        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const pendingSnap = await getDocs(qPending);
        setPendingInvites(pendingSnap.size);

        const qCharges = query(
          collection(db, "charges"),
          where("visibleToUids", "array-contains", u.uid),
          where("status", "==", "paid"),
          limit(1000)
        );

        const chargesSnap = await getDocs(qCharges);
        const list = chargesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as ChargeRow[];

        setRows(list);

        const caseIds = Array.from(
          new Set(
            list
              .map((r) => safeText(r.caseRef?.caseId))
              .filter(Boolean)
          )
        );

        if (caseIds.length > 0) {
          const entries = await Promise.all(
            caseIds.map(async (caseId) => {
              try {
                const snap = await getDoc(doc(db, "cases", caseId));
                const data = snap.exists() ? (snap.data() as any) : {};
                return [caseId, safeText(data?.caratulaTentativa) || caseId] as const;
              } catch {
                return [caseId, caseId] as const;
              }
            })
          );

          const map: Record<string, string> = {};
          for (const [id, label] of entries) {
            map[id] = label;
          }
          setCasesMap(map);
        } else {
          setCasesMap({});
        }
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando cobros realizados");
      } finally {
        setLoadingShell(false);
        setLoadingData(false);
      }
    });

    return () => unsub();
  }, [router]);

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  const visibleRows = useMemo(() => {
    let list = [...rows];

    if (queryCaseId) {
      list = list.filter((r) => safeText(r.caseRef?.caseId) === queryCaseId);
    }

    if (currencyFilter !== "all") {
      list = list.filter((r) => r.currency === currencyFilter);
    }

    const s = safeLower(search);
    if (s) {
      list = list.filter((r) => {
        const payer = safeLower(r.payerRef?.displayName);
        const caratula = safeLower(r.caseRef?.caratula);
        const extra = safeLower(r.caseRef?.extraCaseReason);
        const fallbackCase = safeLower(casesMap[safeText(r.caseRef?.caseId)]);
        return (
          payer.includes(s) ||
          caratula.includes(s) ||
          extra.includes(s) ||
          fallbackCase.includes(s)
        );
      });
    }

    list.sort((a, b) => {
      const aa = toDate(a.paidAt)?.getTime() ?? 0;
      const bb = toDate(b.paidAt)?.getTime() ?? 0;
      return bb - aa;
    });

    return list;
  }, [rows, queryCaseId, currencyFilter, search, casesMap]);

  const grouped = useMemo(() => {
    const map = new Map<string, ChargeRow[]>();

    for (const row of visibleRows) {
      const key = monthKeyFromDate(row.paidAt);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }

    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "sin-fecha") return 1;
      if (b[0] === "sin-fecha") return -1;
      return a[0] < b[0] ? 1 : -1;
    });
  }, [visibleRows]);

  return (
    <AppShell
      title="Cobros realizados"
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

      {loadingShell || loadingData ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-700 dark:text-gray-200">
          {queryCaseId
            ? `Mostrando historial de la causa: ${safeText(casesMap[queryCaseId]) || queryCaseId}`
            : "Historial general de cobros realizados"}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={queryCaseId ? `/cobranzas?caseId=${queryCaseId}` : "/cobranzas"}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Volver a cobranzas
          </Link>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Buscar por pagador o causa
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
              Moneda
            </span>
            <select
              value={currencyFilter}
              onChange={(e) => setCurrencyFilter(e.target.value as any)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="all">Todas</option>
              <option value="ARS">Pesos</option>
              <option value="USD">Dólares</option>
            </select>
          </label>
        </div>
      </div>

      {grouped.length === 0 && !loadingData ? (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
          No hay cobros realizados con esos filtros.
        </div>
      ) : null}

      <div className="grid gap-5">
        {grouped.map(([monthKey, monthRows]) => {
          const monthlyTotal = monthRows.reduce(
            (sum, r) => sum + getChargeUserNetAmount(r, user?.uid),
            0
          );
          const monthCurrency = monthRows[0]?.currency ?? "";

          return (
            <section
              key={monthKey}
              className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-black capitalize text-gray-900 dark:text-gray-100">
                    {monthLabelFromKey(monthKey)}
                  </h2>
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-200">
                    Total del mes:{" "}
                    <span className="text-base font-black text-gray-900 dark:text-gray-100">
                      {fmtMoney(monthlyTotal, monthCurrency)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="hidden grid-cols-[56px_minmax(180px,1.4fr)_130px_minmax(220px,2fr)_150px] gap-3 border-b border-gray-200 px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400 md:grid">
                <div></div>
                <div>Pagador</div>
                <div>Fecha</div>
                <div>Causa</div>
                <div className="text-right">Mi neto</div>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {monthRows.map((r) => {
                  const expanded = !!expandedIds[r.id];
                  const myNet = getChargeUserNetAmount(r, user?.uid);
                  const causeLabel = getCauseLabel(r, casesMap);

                  return (
                    <div key={r.id} className="px-4 py-3">
                      <div className="hidden items-center gap-3 md:grid md:grid-cols-[56px_minmax(180px,1.4fr)_130px_minmax(220px,2fr)_150px]">
                        <div>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(r.id)}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-lg font-black text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                            aria-expanded={expanded}
                            aria-label={expanded ? "Ocultar detalle" : "Mostrar detalle"}
                          >
                            {expanded ? "−" : "+"}
                          </button>
                        </div>

                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                            {safeText(r.payerRef?.displayName) || "(sin pagador)"}
                          </div>
                        </div>

                        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                          {fmtDate(r.paidAt)}
                        </div>

                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-700 dark:text-gray-200">
                            {causeLabel}
                          </div>
                        </div>

                        <div className="text-right text-sm font-black text-gray-900 dark:text-gray-100">
                          {fmtMoney(myNet, r.currency)}
                        </div>
                      </div>

                      <div className="md:hidden">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => toggleExpanded(r.id)}
                            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-white text-lg font-black text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                            aria-expanded={expanded}
                            aria-label={expanded ? "Ocultar detalle" : "Mostrar detalle"}
                          >
                            {expanded ? "−" : "+"}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                              {safeText(r.payerRef?.displayName) || "(sin pagador)"}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                              {fmtDate(r.paidAt)}
                            </div>
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                              {causeLabel}
                            </div>
                            <div className="mt-2 text-sm font-black text-gray-900 dark:text-gray-100">
                              Mi neto: {fmtMoney(myNet, r.currency)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800">
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                                Pagador
                              </div>
                              <div className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
                                {safeText(r.payerRef?.displayName) || "-"}
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                {safeText(r.payerRef?.email) || "-"}
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Tel: {safeText(r.payerRef?.phone) || "-"}
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                CUIT: {safeText(r.payerRef?.cuit) || "-"}
                              </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                                Cobro
                              </div>
                              <div className="mt-1 text-sm font-bold text-gray-900 dark:text-gray-100">
                                Fecha: {fmtDate(r.paidAt)}
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Estado: Cobrado
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Moneda: {safeText(r.currency) || "-"}
                              </div>
                              {r.installments?.enabled ? (
                                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                  Cuota {Number(r.installments.current ?? 0)} de{" "}
                                  {Number(r.installments.total ?? 0)}
                                </div>
                              ) : (
                                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                  Pago sin cuotas
                                </div>
                              )}
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                                Causa
                              </div>
                              <div className="mt-1 break-words text-sm font-bold text-gray-900 dark:text-gray-100">
                                {causeLabel}
                              </div>
                              {!r.caseRef?.isExtraCase && safeText(r.caseRef?.caseId) ? (
                                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                  ID causa: {safeText(r.caseRef?.caseId)}
                                </div>
                              ) : null}
                              {r.caseRef?.isExtraCase ? (
                                <div className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                                  Cobro extra-causa
                                </div>
                              ) : null}
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 dark:border-gray-700 dark:bg-gray-900">
                              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                                Importes
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Bruto:{" "}
                                <span className="font-bold text-gray-900 dark:text-gray-100">
                                  {fmtMoney(
                                    r.distribution?.grossAmount ?? r.totalAmount,
                                    r.currency
                                  )}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Deducciones:{" "}
                                <span className="font-bold text-gray-900 dark:text-gray-100">
                                  {fmtMoney(r.distribution?.deductionsTotal, r.currency)}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Fondo estudio:{" "}
                                <span className="font-bold text-gray-900 dark:text-gray-100">
                                  {fmtMoney(r.distribution?.studioFundAmount, r.currency)}
                                </span>
                              </div>
                              <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                                Mi neto: {fmtMoney(myNet, r.currency)}
                              </div>
                            </div>
                          </div>

                          {r.transferTicket?.status ? (
                            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                                Transferencias
                              </div>

                              {r.transferTicket?.status === "pending" ? (
                                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-sm font-bold text-amber-700 dark:text-amber-300">
                                    Ticket pendiente
                                  </div>
                                  <Link
                                    href={`/cobranzas/registrar?ticket=${r.id}`}
                                    className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200"
                                  >
                                    Ver ticket pendiente
                                  </Link>
                                </div>
                              ) : (
                                <div className="mt-2 text-sm font-bold text-green-700 dark:text-green-300">
                                  Transferencias confirmadas
                                </div>
                              )}
                            </div>
                          ) : null}

                          {(r.distribution?.participants ?? []).length > 0 ? (
                            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                                Participantes de la distribución
                              </div>

                              <div className="mt-3 grid gap-2">
                                {(r.distribution?.participants ?? []).map((p) => (
                                  <div
                                    key={p.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
                                  >
                                    <div className="font-semibold text-gray-900 dark:text-gray-100">
                                      {p.displayName}
                                    </div>
                                    <div className="font-black text-gray-900 dark:text-gray-100">
                                      {p.percent}% · {fmtMoney(p.amount, r.currency)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
                <div className="flex items-center justify-end">
                  <div className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-black text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                    Total del mes: {fmtMoney(monthlyTotal, monthCurrency)}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}