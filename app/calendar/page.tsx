"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { auth, db } from "@/lib/firebase";
import AppShell from "@/components/AppShell";
import {
  CalendarEventRow,
  createCalendarEvent,
  type EventVisibility,
} from "@/lib/events";
import { addAutoLog } from "@/lib/caseManagement";
import ScrollToTopButton from "@/components/ScrollToTopButton";

type MainCaseRow = {
  id: string;
  caratulaTentativa?: string;
  confirmedAssigneesUids?: string[];
};

type UserOption = {
  uid: string;
  email: string;
};

type CalendarViewMode = "month" | "week" | "day" | "agenda";
type ManualEntryType = "event" | "recordatorio";

function safeText(v: any) {
  return String(v ?? "").trim();
}

function safeLower(v: any) {
  return safeText(v).toLowerCase();
}

function fmtDateTime(value?: any) {
  if (!value) return "-";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-AR", {
    hour12: false,
  });
}

function fmtHour(value?: any) {
  if (!value) return "-";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDateLabel(date: Date) {
  return date.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function fmtDateTimeInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function colorLabel(hex: string) {
  switch (hex) {
    case "#ef4444":
      return "Rojo";
    case "#f59e0b":
    case "#f97316":
      return "Naranja";
    case "#10b981":
      return "Verde";
    case "#14b8a6":
      return "Turquesa";
    case "#3b82f6":
      return "Azul";
    case "#8b5cf6":
    case "#a855f7":
      return "Violeta";
    case "#ec4899":
      return "Rosa";
    case "#6b7280":
    case "#9ca3af":
      return "Gris";
    default:
      return hex;
  }
}

function toDate(value?: any) {
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfWeek(d: Date) {
  const copy = startOfDay(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function endOfWeek(d: Date) {
  const start = startOfWeek(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfDay(end);
}

function startOfWeekSunday(d: Date) {
  const copy = startOfDay(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  return copy;
}

function endOfWeekSunday(d: Date) {
  const start = startOfWeekSunday(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfDay(end);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(base: Date, days: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function getMonthGridDates(anchor: Date) {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);

  const gridStart = startOfWeekSunday(monthStart);
  const gridEnd = endOfWeekSunday(monthEnd);

  const dates: Date[] = [];
  let cursor = new Date(gridStart);

  while (cursor <= gridEnd) {
    dates.push(new Date(cursor));
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function eventStartsInRange(row: CalendarEventRow, rangeStart: Date, rangeEnd: Date) {
  const start = toDate(row.startAt);
  if (!start) return false;
  return start >= rangeStart && start <= rangeEnd;
}

function eventBelongsToDay(row: CalendarEventRow, day: Date) {
  const start = toDate(row.startAt);
  if (!start) return false;
  return isSameDay(start, day);
}

function getViewTitle(viewMode: CalendarViewMode, currentDate: Date) {
  if (viewMode === "month") {
    return currentDate.toLocaleDateString("es-AR", {
      month: "long",
      year: "numeric",
    });
  }

  if (viewMode === "week" || viewMode === "agenda") {
    const weekStart = startOfWeek(currentDate);
    const weekEnd = endOfWeek(currentDate);
    return `${weekStart.toLocaleDateString("es-AR")} – ${weekEnd.toLocaleDateString("es-AR")}`;
  }

  return currentDate.toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function sourceLabel(row: CalendarEventRow) {
  if (row.source === "manual") return "Manual";
  if (row.source === "case_log") return "Bitácora";
  if (row.source === "charge") return "Cobros";
  return "Automático";
}

function getVisibleToUids(row: CalendarEventRow) {
  return Array.isArray((row as any).visibleToUids) ? ((row as any).visibleToUids as string[]) : [];
}

function getCaseParticipantsSnapshot(row: CalendarEventRow) {
  return Array.isArray((row as any).caseParticipantsSnapshot)
    ? ((row as any).caseParticipantsSnapshot as string[])
    : [];
}

function isRescheduledEvent(row: CalendarEventRow) {
  return Boolean((row as any).rescheduled);
}

function isDoneEvent(row: CalendarEventRow) {
  const status = safeLower((row as any).status || "active");
  return (
    status === "completed" ||
    Boolean((row as any).done) ||
    Boolean((row as any).completedAt)
  );
}

function isReminderEvent(row: CalendarEventRow) {
  const autoType = safeText((row as any).autoType);
  return autoType === "manual_recordatorio" || autoType === "case_log_recordatorio";
}

function isDeadlineEvent(row: CalendarEventRow) {
  const autoType = safeLower((row as any).autoType);
  const title = safeLower(row.title);
  return (
    autoType.includes("vencim") ||
    autoType.includes("deadline") ||
    autoType === "case_log_vencimiento" ||
    title.includes("vencimiento")
  );
}

function isCompletableEvent(row: CalendarEventRow) {
  return isReminderEvent(row) || isDeadlineEvent(row);
}

function shouldHideFromUpcoming(row: CalendarEventRow) {
  const status = safeLower((row as any).status || "active");
  return status === "cancelled" || isRescheduledEvent(row) || isDoneEvent(row);
}

function visibilityLabel(
  row: CalendarEventRow,
  users: UserOption[],
  currentUser?: User | null
) {
  if (row.visibility === "case_shared") return "Abogados de la causa";
  if (row.visibility === "global") return "Todos";
  if (row.visibility === "private") return "Solo para mí";

  const visibleToUids = getVisibleToUids(row);
  const emails = users
    .filter((u) => visibleToUids.includes(u.uid))
    .map((u) => u.email)
    .filter(Boolean);

  const withoutCurrentUser = emails.filter((email) => email !== safeText(currentUser?.email));
  const unique = Array.from(new Set(withoutCurrentUser.length > 0 ? withoutCurrentUser : emails));

  return unique.length > 0 ? unique.join(", ") : "Usuarios seleccionados";
}

async function loadAllVisibleEventsForUser(uid: string): Promise<CalendarEventRow[]> {
  const qPersonal = query(
    collection(db, "events"),
    where("visibleToUids", "array-contains", uid),
    orderBy("startAt", "asc"),
    limit(500)
  );

  const qGlobal = query(
    collection(db, "events"),
    where("visibility", "==", "global"),
    orderBy("startAt", "asc"),
    limit(500)
  );

  const [personalSnap, globalSnap] = await Promise.all([getDocs(qPersonal), getDocs(qGlobal)]);

  const map = new Map<string, CalendarEventRow>();

  [...personalSnap.docs, ...globalSnap.docs].forEach((d) => {
    map.set(d.id, { id: d.id, ...(d.data() as any) });
  });

  return Array.from(map.values()).sort((a, b) => {
    const aa = a.startAt?.toDate ? a.startAt.toDate().getTime() : new Date(a.startAt).getTime();
    const bb = b.startAt?.toDate ? b.startAt.toDate().getTime() : new Date(b.startAt).getTime();
    return aa - bb;
  });
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-800 dark:bg-gray-900">
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

function EventPill({
  row,
  onClick,
}: {
  row: CalendarEventRow;
  onClick: (row: CalendarEventRow) => void;
}) {
  const rescheduled = isRescheduledEvent(row);
  const reminder = isReminderEvent(row);
  const done = isDoneEvent(row);
  const pillColor = rescheduled || done ? "#9ca3af" : row.color || "#3b82f6";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(row);
      }}
      className="block w-full min-w-0 max-w-full overflow-hidden rounded-lg border px-2 py-1 text-left text-xs shadow-sm transition hover:opacity-90"
      style={{
        borderColor: `${pillColor}55`,
        backgroundColor: `${pillColor}18`,
      }}
      title={`${row.title} · ${fmtDateTime(row.startAt)}`}
    >
      <div className="flex items-center gap-1">
        <div className="truncate font-black text-gray-900 dark:text-gray-100">{row.title}</div>

        {reminder ? (
          <span className="shrink-0 rounded bg-teal-100 px-1 py-0.5 text-[10px] font-black uppercase text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
            Recordatorio
          </span>
        ) : null}

        {isDeadlineEvent(row) ? (
          <span className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[10px] font-black uppercase text-red-800 dark:bg-red-900/30 dark:text-red-100">
            Vencimiento
          </span>
        ) : null}

        {done ? (
          <span className="shrink-0 rounded bg-gray-200 px-1 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
            Hecho
          </span>
        ) : null}

        {rescheduled ? (
          <span className="shrink-0 rounded bg-gray-200 px-1 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
            Reprogramado
          </span>
        ) : null}
      </div>
      <div className="truncate text-[11px] text-gray-700 dark:text-gray-300">
        {fmtHour(row.startAt)}
      </div>
    </button>
  );
}

export default function CalendarPage() {
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string>("lawyer");
  const [pendingInvites, setPendingInvites] = useState<number>(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [cases, setCases] = useState<MainCaseRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [rows, setRows] = useState<CalendarEventRow[]>([]);

  const [entryType, setEntryType] = useState<ManualEntryType>("event");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAtInput, setStartAtInput] = useState(fmtDateTimeInput(new Date()));
  const [endAtInput, setEndAtInput] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [color, setColor] = useState("#3b82f6");
  const [visibility, setVisibility] = useState<EventVisibility>("private");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [selectedUserUids, setSelectedUserUids] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");

  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventRow | null>(null);

  const [reprogramModalOpen, setReprogramModalOpen] = useState(false);
  const [reprogramStartAtInput, setReprogramStartAtInput] = useState("");
  const [reprogramEndAtInput, setReprogramEndAtInput] = useState("");
  const [reprogramSaving, setReprogramSaving] = useState(false);

  const [markDoneSaving, setMarkDoneSaving] = useState(false);

  const [quickEventSearch, setQuickEventSearch] = useState("");
  const [quickEventSearchFocused, setQuickEventSearchFocused] = useState(false);
  const [quickEventSelectedIndex, setQuickEventSelectedIndex] = useState(0);

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

        const qPending = query(
          collectionGroup(db, "invites"),
          where("invitedUid", "==", u.uid),
          where("status", "==", "pending")
        );
        const pendingSnap = await getDocs(qPending);
        setPendingInvites(pendingSnap.size);

        const qCases = query(
          collection(db, "cases"),
          where("confirmedAssigneesUids", "array-contains", u.uid),
          limit(300)
        );
        const casesSnap = await getDocs(qCases);
        const myCases = casesSnap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as MainCaseRow[];
        myCases.sort((a, b) =>
          safeText(a.caratulaTentativa).localeCompare(safeText(b.caratulaTentativa), "es")
        );
        setCases(myCases);

        const qUsers = query(collection(db, "users"), orderBy("email", "asc"));
        const usersSnap = await getDocs(qUsers);
        const userOptions = usersSnap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              uid: d.id,
              email: safeText(data?.email),
            };
          })
          .filter((x) => Boolean(x.email));
        setUsers(userOptions);

        const allEvents = await loadAllVisibleEventsForUser(u.uid);
        setRows(allEvents);
      } catch (e: any) {
        setMsg(e?.message ?? "Error cargando agenda");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, [router]);

  const selectedCase = useMemo(
    () => cases.find((c) => c.id === selectedCaseId) ?? null,
    [cases, selectedCaseId]
  );

  const visibleRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aa = a.startAt?.toDate ? a.startAt.toDate().getTime() : new Date(a.startAt).getTime();
      const bb = b.startAt?.toDate ? b.startAt.toDate().getTime() : new Date(b.startAt).getTime();
      return aa - bb;
    });
  }, [rows]);

  const upcomingRows = useMemo(() => {
    const now = Date.now();

    return visibleRows.filter((row) => {
      const start = row.startAt?.toDate ? row.startAt.toDate() : new Date(row.startAt);
      return !Number.isNaN(start.getTime()) && start.getTime() >= now && !shouldHideFromUpcoming(row);
    });
  }, [visibleRows]);

  const upcomingRowsLimited = useMemo(() => upcomingRows.slice(0, 20), [upcomingRows]);

  const quickEventSearchResults = useMemo(() => {
    const term = safeLower(quickEventSearch);
    if (!term) return [];

    return visibleRows
      .filter((row) => {
        const status = safeText((row as any).status || "active");
        if (status === "cancelled") return false;
        return safeLower(row.title).includes(term);
      })
      .slice(0, 12);
  }, [visibleRows, quickEventSearch]);

  useEffect(() => {
    setQuickEventSelectedIndex(0);
  }, [quickEventSearch]);

  const monthDates = useMemo(() => getMonthGridDates(currentDate), [currentDate]);

  const weekDates = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const monthEventsMap = useMemo(() => {
    const map: Record<string, CalendarEventRow[]> = {};

    for (const day of monthDates) {
      const key = day.toISOString().slice(0, 10);
      map[key] = visibleRows.filter((row) => eventBelongsToDay(row, day));
    }

    return map;
  }, [monthDates, visibleRows]);

  const weekEventsMap = useMemo(() => {
    const map: Record<string, CalendarEventRow[]> = {};

    for (const day of weekDates) {
      const key = day.toISOString().slice(0, 10);
      map[key] = visibleRows.filter((row) => eventBelongsToDay(row, day));
    }

    return map;
  }, [weekDates, visibleRows]);

  const dayEvents = useMemo(() => {
    const start = startOfDay(currentDate);
    const end = endOfDay(currentDate);
    return visibleRows.filter((row) => eventStartsInRange(row, start, end));
  }, [visibleRows, currentDate]);

  const agendaRows = useMemo(() => {
    const start = startOfWeek(currentDate);
    const end = endOfWeek(currentDate);
    return visibleRows.filter((row) => eventStartsInRange(row, start, end));
  }, [visibleRows, currentDate]);

  function toggleSelectedUser(uid: string) {
    setSelectedUserUids((prev) =>
      prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]
    );
  }

  async function reloadEvents(uid: string) {
    const allEvents = await loadAllVisibleEventsForUser(uid);
    setRows(allEvents);
  }

  function handleEntryTypeChange(next: ManualEntryType) {
    setEntryType(next);

    if (next === "recordatorio") {
      setEndAtInput("");
      setAllDay(false);
      setColor("#14b8a6");
    } else {
      if (color === "#14b8a6") {
        setColor("#3b82f6");
      }
    }
  }

  async function saveEvent() {
    if (!user) return;

    if (!safeText(title)) {
      alert("Ingresá un título.");
      return;
    }

    const startAt = new Date(startAtInput);
    if (Number.isNaN(startAt.getTime())) {
      alert("Ingresá una fecha válida.");
      return;
    }

    const isReminder = entryType === "recordatorio";
    const endAt = !isReminder && endAtInput ? new Date(endAtInput) : undefined;

    if (!isReminder && endAtInput && endAt && Number.isNaN(endAt.getTime())) {
      alert("Ingresá una fecha de fin válida.");
      return;
    }

    if (!isReminder && endAt && endAt.getTime() < startAt.getTime()) {
      alert("La fecha de fin no puede ser anterior al inicio.");
      return;
    }

    if (visibility === "case_shared" && !selectedCaseId) {
      alert("Seleccioná una causa para compartir el evento.");
      return;
    }

    if (visibility === "selected_users" && selectedUserUids.length === 0) {
      alert("Seleccioná al menos un usuario.");
      return;
    }

    if (visibility === "global" && role !== "admin") {
      alert("Solo el administrador puede crear eventos globales.");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      await createCalendarEvent({
        title: safeText(title),
        description: safeText(description),
        startAt,
        endAt,
        allDay: isReminder ? false : allDay,
        color: isReminder ? "#14b8a6" : color,
        visibility,
        ownerUid: user.uid,
        ownerEmail: user.email ?? "",
        selectedUserUids,
        caseParticipantUids: selectedCase?.confirmedAssigneesUids ?? [],
        caseRef:
          visibility === "case_shared"
            ? {
                caseId: selectedCase?.id ?? null,
                caratula: safeText(selectedCase?.caratulaTentativa),
              }
            : undefined,
        source: "manual",
        autoGenerated: false,
        autoType: isReminder ? "manual_recordatorio" : "manual_event",
        location: safeText(location),
        meetingUrl: safeText(meetingUrl),
      });

      setEntryType("event");
      setTitle("");
      setDescription("");
      setStartAtInput(fmtDateTimeInput(new Date()));
      setEndAtInput("");
      setAllDay(false);
      setColor("#3b82f6");
      setVisibility("private");
      setSelectedCaseId("");
      setSelectedUserUids([]);
      setLocation("");
      setMeetingUrl("");

      await reloadEvents(user.uid);
      setMsg(isReminder ? "✅ Recordatorio guardado correctamente." : "✅ Evento guardado correctamente.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo guardar el evento.");
    } finally {
      setSaving(false);
    }
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  function goPrev() {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "month") d.setMonth(d.getMonth() - 1);
      else if (viewMode === "week" || viewMode === "agenda") d.setDate(d.getDate() - 7);
      else d.setDate(d.getDate() - 1);
      return d;
    });
  }

  function goNext() {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "month") d.setMonth(d.getMonth() + 1);
      else if (viewMode === "week" || viewMode === "agenda") d.setDate(d.getDate() + 7);
      else d.setDate(d.getDate() + 1);
      return d;
    });
  }

  function openDayView(day: Date) {
    setCurrentDate(new Date(day));
    setViewMode("day");
  }

  function openEventDetail(row: CalendarEventRow) {
    setSelectedEvent(row);
    setReprogramModalOpen(false);

    const start = toDate(row.startAt);
    const end = toDate(row.endAt);

    setReprogramStartAtInput(start ? fmtDateTimeInput(start) : "");
    setReprogramEndAtInput(end ? fmtDateTimeInput(end) : "");
  }

  function openEventFromQuickSearch(row: CalendarEventRow) {
    const start = toDate(row.startAt);
    if (start) {
      setCurrentDate(start);
      setViewMode("day");
    }

    setQuickEventSearch("");
    setQuickEventSearchFocused(false);
    setQuickEventSelectedIndex(0);
    openEventDetail(row);
  }

  function handleQuickEventSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (quickEventSearchResults.length === 0) return;
      setQuickEventSelectedIndex((prev) =>
        prev + 1 >= quickEventSearchResults.length ? 0 : prev + 1
      );
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (quickEventSearchResults.length === 0) return;
      setQuickEventSelectedIndex((prev) =>
        prev - 1 < 0 ? quickEventSearchResults.length - 1 : prev - 1
      );
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (quickEventSearchResults.length > 0) {
        openEventFromQuickSearch(
          quickEventSearchResults[
            Math.min(quickEventSelectedIndex, quickEventSearchResults.length - 1)
          ]
        );
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setQuickEventSearchFocused(false);
    }
  }

  async function markEventAsDone() {
    if (!user || !selectedEvent) return;

    if (!isCompletableEvent(selectedEvent)) {
      alert("Solo se pueden marcar como hechos los recordatorios y vencimientos.");
      return;
    }

    if (isDoneEvent(selectedEvent)) {
      alert("Este evento ya fue marcado como hecho.");
      return;
    }

    if (isRescheduledEvent(selectedEvent)) {
      alert("Un evento reprogramado no puede marcarse como hecho.");
      return;
    }

    setMarkDoneSaving(true);
    setMsg(null);

    try {
      await updateDoc(doc(db, "events", selectedEvent.id), {
        status: "completed",
        done: true,
        doneLabel: "hecho",
        color: "#9ca3af",
        completedAt: serverTimestamp(),
        completedByUid: user.uid,
        completedByEmail: user.email ?? "",
        updatedAt: serverTimestamp(),
      });

      if (safeText(selectedEvent.caseRef?.caseId)) {
        await addAutoLog({
          caseId: String(selectedEvent.caseRef?.caseId),
          uid: user.uid,
          email: user.email ?? "",
          type: "informativa",
          title: `Evento marcado como hecho: ${safeText(selectedEvent.title)}`,
          body:
            `Se marcó como hecho el evento "${safeText(selectedEvent.title)}".\n\n` +
            `Fecha original: ${fmtDateTime(selectedEvent.startAt)}` +
            `${selectedEvent.endAt ? ` → ${fmtDateTime(selectedEvent.endAt)}` : ""}`,
        });
      }

      await reloadEvents(user.uid);
      setSelectedEvent(null);
      setReprogramModalOpen(false);
      setMsg("✅ Evento marcado como hecho.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo marcar el evento como hecho.");
    } finally {
      setMarkDoneSaving(false);
    }
  }

  async function reprogramEvent() {
    if (!user || !selectedEvent) return;

    const originalStart = toDate(selectedEvent.startAt);
    if (!originalStart) {
      alert("El evento original no tiene una fecha válida.");
      return;
    }

    const newStart = new Date(reprogramStartAtInput);
    if (Number.isNaN(newStart.getTime())) {
      alert("Ingresá una nueva fecha de inicio válida.");
      return;
    }

    let newEnd: Date | undefined = undefined;
    if (safeText(reprogramEndAtInput)) {
      const parsedEnd = new Date(reprogramEndAtInput);
      if (Number.isNaN(parsedEnd.getTime())) {
        alert("Ingresá una nueva fecha de fin válida.");
        return;
      }
      if (parsedEnd.getTime() < newStart.getTime()) {
        alert("La fecha de fin no puede ser anterior al inicio.");
        return;
      }
      newEnd = parsedEnd;
    } else {
      const originalEnd = toDate(selectedEvent.endAt);
      if (originalEnd) {
        const durationMs = originalEnd.getTime() - originalStart.getTime();
        if (durationMs > 0) {
          newEnd = new Date(newStart.getTime() + durationMs);
        }
      }
    }

    setReprogramSaving(true);
    setMsg(null);

    try {
      const visibleToUids = getVisibleToUids(selectedEvent);
      const caseParticipantsSnapshot = getCaseParticipantsSnapshot(selectedEvent);

      let nextSelectedUserUids: string[] = [];
      if (selectedEvent.visibility === "selected_users") {
        nextSelectedUserUids = visibleToUids.filter((uid) => uid !== selectedEvent.ownerUid);
      }

      const newEventId = await createCalendarEvent({
        title: safeText(selectedEvent.title),
        description: safeText(selectedEvent.description),
        startAt: newStart,
        endAt: newEnd,
        allDay: Boolean(selectedEvent.allDay),
        color: safeText(selectedEvent.color) || "#3b82f6",
        visibility: selectedEvent.visibility,
        ownerUid: safeText(selectedEvent.ownerUid) || user.uid,
        ownerEmail: safeText(selectedEvent.ownerEmail) || user.email || "",
        selectedUserUids: nextSelectedUserUids,
        caseParticipantUids:
          selectedEvent.visibility === "case_shared" ? caseParticipantsSnapshot : [],
        caseRef: selectedEvent.caseRef
          ? {
              caseId: selectedEvent.caseRef.caseId ?? null,
              caratula: safeText(selectedEvent.caseRef.caratula),
            }
          : undefined,
        source: selectedEvent.source,
        sourceRef: (selectedEvent as any).sourceRef
          ? {
              logId: (selectedEvent as any).sourceRef?.logId ?? null,
              chargeId: (selectedEvent as any).sourceRef?.chargeId ?? null,
              scheduledChargeId: (selectedEvent as any).sourceRef?.scheduledChargeId ?? null,
            }
          : undefined,
        autoGenerated: Boolean((selectedEvent as any).autoGenerated),
        autoType: safeText((selectedEvent as any).autoType),
        location: safeText((selectedEvent as any).location),
        meetingUrl: safeText((selectedEvent as any).meetingUrl),
        reminderMinutesBefore: Array.isArray((selectedEvent as any).reminderMinutesBefore)
          ? (selectedEvent as any).reminderMinutesBefore
          : [],
        status: "active",
      });

      await updateDoc(doc(db, "events", selectedEvent.id), {
        status: "cancelled",
        color: "#9ca3af",
        rescheduled: true,
        rescheduledLabel: "reprogramado",
        reprogrammedAt: serverTimestamp(),
        reprogrammedByUid: user.uid,
        reprogrammedByEmail: user.email ?? "",
        reprogrammedToEventId: newEventId,
        reprogrammedToStartAt: Timestamp.fromDate(newStart),
        reprogrammedToEndAt: newEnd ? Timestamp.fromDate(newEnd) : null,
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, "events", newEventId), {
        reprogrammedFromEventId: selectedEvent.id,
        updatedAt: serverTimestamp(),
      });

      if (safeText(selectedEvent.caseRef?.caseId)) {
        const oldStartText = fmtDateTime(selectedEvent.startAt);
        const oldEndText = selectedEvent.endAt ? fmtDateTime(selectedEvent.endAt) : "";
        const newStartText = newStart.toLocaleString("es-AR", { hour12: false });
        const newEndText = newEnd ? newEnd.toLocaleString("es-AR", { hour12: false }) : "";

        await addAutoLog({
          caseId: String(selectedEvent.caseRef?.caseId),
          uid: user.uid,
          email: user.email ?? "",
          type: "informativa",
          title: `Reprogramación de evento: ${safeText(selectedEvent.title)}`,
          body:
            `Se reprogramó el evento "${safeText(selectedEvent.title)}".\n\n` +
            `Fecha original: ${oldStartText}${oldEndText ? ` → ${oldEndText}` : ""}\n` +
            `Nueva fecha: ${newStartText}${newEndText ? ` → ${newEndText}` : ""}`,
        });
      }

      await reloadEvents(user.uid);
      setSelectedEvent(null);
      setReprogramModalOpen(false);
      setMsg("✅ Evento reprogramado correctamente.");
    } catch (e: any) {
      setMsg(e?.message ?? "No se pudo reprogramar el evento.");
    } finally {
      setReprogramSaving(false);
    }
  }

  async function doLogout() {
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <AppShell
      title="Agenda"
      userEmail={user?.email ?? null}
      role={role}
      pendingInvites={pendingInvites}
      onLogout={doLogout}
      breadcrumbs={[
        { label: "Inicio", href: "/dashboard" },
        { label: "Agenda" },
      ]}
    >
      {msg ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          {msg}
        </div>
      ) : null}

      {loading ? (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100">
          Cargando...
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="text-sm font-black text-gray-900 dark:text-gray-100">
            Nuevo {entryType === "recordatorio" ? "recordatorio" : "evento"}
          </div>

          <div className="mt-4 grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Tipo</span>
              <select
                value={entryType}
                onChange={(e) => handleEntryTypeChange(e.target.value as ManualEntryType)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="event">Evento</option>
                <option value="recordatorio">Recordatorio</option>
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Título</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Descripción
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={entryType === "recordatorio" ? "Opcional" : ""}
                className="min-h-[90px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  {entryType === "recordatorio" ? "Fecha y hora" : "Inicio"}
                </span>
                <input
                  type="datetime-local"
                  value={startAtInput}
                  onChange={(e) => setStartAtInput(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                />
              </label>

              {entryType === "event" ? (
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                    Fin (opcional)
                  </span>
                  <input
                    type="datetime-local"
                    value={endAtInput}
                    onChange={(e) => setEndAtInput(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  />
                </label>
              ) : (
                <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-bold text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-100">
                  Se guardará como recordatorio puntual.
                </div>
              )}
            </div>

            {entryType === "event" ? (
              <label className="inline-flex items-center gap-2 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => setAllDay(e.target.checked)}
                />
                Evento de todo el día
              </label>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              {entryType === "event" ? (
                <label className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Color</span>
                  <select
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                  >
                    <option value="#ef4444">Rojo</option>
                    <option value="#f59e0b">Naranja</option>
                    <option value="#10b981">Verde</option>
                    <option value="#3b82f6">Azul</option>
                    <option value="#8b5cf6">Violeta</option>
                    <option value="#ec4899">Rosa</option>
                    <option value="#6b7280">Gris</option>
                  </select>
                </label>
              ) : (
                <div className="grid gap-1">
                  <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Color</span>
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-black text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-100">
                    Turquesa
                  </div>
                </div>
              )}

              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  Visibilidad
                </span>
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as EventVisibility)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="private">Solo para mí</option>
                  <option value="case_shared">Compartido con causa</option>
                  <option value="selected_users">Usuarios seleccionados</option>
                  {role === "admin" ? <option value="global">Todos los usuarios</option> : null}
                </select>
              </label>
            </div>

            {visibility === "case_shared" ? (
              <label className="grid gap-1">
                <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">Causa</span>
                <select
                  value={selectedCaseId}
                  onChange={(e) => setSelectedCaseId(e.target.value)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                >
                  <option value="">Seleccionar causa…</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {safeText(c.caratulaTentativa) || c.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {visibility === "selected_users" ? (
              <div className="grid gap-2">
                <div className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                  Elegir usuarios
                </div>

                <div className="max-h-[200px] overflow-auto rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                  {users
                    .filter((u) => u.uid !== user?.uid)
                    .map((u) => (
                      <label
                        key={u.uid}
                        className="flex items-center gap-2 py-1 text-sm text-gray-900 dark:text-gray-100"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUserUids.includes(u.uid)}
                          onChange={() => toggleSelectedUser(u.uid)}
                        />
                        <span>{u.email}</span>
                      </label>
                    ))}
                </div>
              </div>
            ) : null}

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Ubicación (opcional)
              </span>
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                Enlace (opcional)
              </span>
              <input
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
              />
            </label>

            <div className="pt-2">
              <button
                type="button"
                onClick={saveEvent}
                disabled={saving}
                className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving
                  ? "Guardando..."
                  : entryType === "recordatorio"
                  ? "Guardar recordatorio"
                  : "Guardar evento"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
              Buscador rápido de eventos
            </div>

            <div className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Buscá por título y movete con ↑ ↓ Enter para abrir rápido el evento.
            </div>

            <div className="relative mt-3">
              <input
                value={quickEventSearch}
                onChange={(e) => setQuickEventSearch(e.target.value)}
                onFocus={() => setQuickEventSearchFocused(true)}
                onBlur={() => {
                  setTimeout(() => setQuickEventSearchFocused(false), 150);
                }}
                onKeyDown={handleQuickEventSearchKeyDown}
                placeholder="Ej.: Audiencia, reunión con cliente, vencimiento..."
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 placeholder:text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-400"
              />

              {quickEventSearchFocused && safeText(quickEventSearch) ? (
                <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
                  {quickEventSearchResults.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                      No hay coincidencias.
                    </div>
                  ) : (
                    quickEventSearchResults.map((item, idx) => {
                      const isActive = idx === quickEventSelectedIndex;
                      const reminder = isReminderEvent(item);
                      const rescheduled = isRescheduledEvent(item);
                      const done = isDoneEvent(item);
                      const dotColor = rescheduled || done ? "#9ca3af" : item.color || "#3b82f6";

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setQuickEventSelectedIndex(idx)}
                          onClick={() => openEventFromQuickSearch(item)}
                          className={`block w-full border-b border-gray-100 px-4 py-3 text-left transition last:border-b-0 dark:border-gray-800 ${
                            isActive
                              ? "bg-gray-100 dark:bg-gray-800"
                              : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className="mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
                              style={{ backgroundColor: dotColor }}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="truncate text-sm font-black text-gray-900 dark:text-gray-100">
                                  {item.title}
                                </div>

                                {reminder ? (
                                  <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
                                    Recordatorio
                                  </span>
                                ) : null}

                                {isDeadlineEvent(item) ? (
                                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-800 dark:bg-red-900/30 dark:text-red-100">
                                    Vencimiento
                                  </span>
                                ) : null}

                                {done ? (
                                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                                    Hecho
                                  </span>
                                ) : null}

                                {rescheduled ? (
                                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                                    Reprogramado
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                {fmtDateTime(item.startAt)}
                                {item.caseRef?.caratula ? ` · ${item.caseRef.caratula}` : ""}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Vista de agenda
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  ←
                </button>

                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  Hoy
                </button>

                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  →
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-lg font-black capitalize text-gray-900 dark:text-gray-100">
                {getViewTitle(viewMode, currentDate)}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode("month")}
                  className={`rounded-xl px-3 py-2 text-sm font-extrabold ${
                    viewMode === "month"
                      ? "bg-black text-white"
                      : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  Mes
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("week")}
                  className={`rounded-xl px-3 py-2 text-sm font-extrabold ${
                    viewMode === "week"
                      ? "bg-black text-white"
                      : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  Semana
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("day")}
                  className={`rounded-xl px-3 py-2 text-sm font-extrabold ${
                    viewMode === "day"
                      ? "bg-black text-white"
                      : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  Día
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("agenda")}
                  className={`rounded-xl px-3 py-2 text-sm font-extrabold ${
                    viewMode === "agenda"
                      ? "bg-black text-white"
                      : "border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                  }`}
                >
                  Agenda
                </button>
              </div>
            </div>

            {viewMode === "month" ? (
              <div className="mt-4">
                <div className="grid grid-cols-7 gap-2">
                  {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((label) => (
                    <div
                      key={label}
                      className="rounded-xl bg-gray-100 px-2 py-2 text-center text-xs font-black text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      {label}
                    </div>
                  ))}

                  {monthDates.map((day) => {
                    const key = day.toISOString().slice(0, 10);
                    const dayRows = monthEventsMap[key] ?? [];
                    const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                    const isToday = isSameDay(day, new Date());

                    return (
                      <div
                        key={key}
                        role="button"
                        tabIndex={0}
                        onClick={() => openDayView(day)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openDayView(day);
                          }
                        }}
                        className={`min-h-[130px] min-w-0 overflow-hidden rounded-2xl border p-2 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 ${
                          isToday
                            ? "border-black dark:border-white"
                            : "border-gray-200 dark:border-gray-800"
                        } ${isCurrentMonth ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800/50"}`}
                      >
                        <div
                          className={`mb-2 text-sm font-black ${
                            isCurrentMonth
                              ? "text-gray-900 dark:text-gray-100"
                              : "text-gray-400 dark:text-gray-500"
                          }`}
                        >
                          {day.getDate()}
                        </div>

                        <div className="grid min-w-0 gap-1 overflow-hidden">
                          {dayRows.slice(0, 3).map((row) => (
                            <EventPill key={row.id} row={row} onClick={openEventDetail} />
                          ))}

                          {dayRows.length > 3 ? (
                            <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400">
                              +{dayRows.length - 3} más
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {viewMode === "week" ? (
              <div className="mt-4 grid gap-3 md:grid-cols-7">
                {weekDates.map((day) => {
                  const key = day.toISOString().slice(0, 10);
                  const dayRows = weekEventsMap[key] ?? [];
                  const isToday = isSameDay(day, new Date());

                  return (
                    <div
                      key={key}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDayView(day)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openDayView(day);
                        }
                      }}
                      className={`min-w-0 overflow-hidden rounded-2xl border p-3 text-left cursor-pointer focus:outline-none focus:ring-2 focus:ring-black/20 dark:focus:ring-white/20 ${
                        isToday
                          ? "border-black dark:border-white"
                          : "border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                        {fmtDateLabel(day)}
                      </div>

                      <div className="mt-3 grid min-w-0 gap-2 overflow-hidden">
                        {dayRows.length === 0 ? (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Sin eventos
                          </div>
                        ) : (
                          dayRows.map((row) => (
                            <EventPill key={row.id} row={row} onClick={openEventDetail} />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {viewMode === "day" ? (
              <div className="mt-4 rounded-2xl border border-gray-200 dark:border-gray-800">
                <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
                  <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                    {currentDate.toLocaleDateString("es-AR", {
                      weekday: "long",
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                </div>

                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {dayEvents.length === 0 ? (
                    <div className="p-4 text-sm text-gray-700 dark:text-gray-200">
                      No hay eventos para este día.
                    </div>
                  ) : (
                    dayEvents.map((row) => {
                      const rescheduled = isRescheduledEvent(row);
                      const reminder = isReminderEvent(row);
                      const done = isDoneEvent(row);
                      const dotColor = rescheduled || done ? "#9ca3af" : row.color || "#3b82f6";

                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => openEventDetail(row)}
                          className="w-full p-4 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className="mt-1 h-4 w-4 shrink-0 rounded-full border border-black/10"
                              style={{ backgroundColor: dotColor }}
                            />

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                                  {row.title}
                                </div>

                                {reminder ? (
                                  <span className="rounded bg-teal-100 px-2 py-0.5 text-[10px] font-black uppercase text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
                                    Recordatorio
                                  </span>
                                ) : null}

                                {isDeadlineEvent(row) ? (
                                  <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-800 dark:bg-red-900/30 dark:text-red-100">
                                    Vencimiento
                                  </span>
                                ) : null}

                                {done ? (
                                  <span className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                                    Hecho
                                  </span>
                                ) : null}

                                {rescheduled ? (
                                  <span className="rounded bg-gray-200 px-2 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                                    Reprogramado
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                {fmtDateTime(row.startAt)}
                                {row.endAt ? ` → ${fmtDateTime(row.endAt)}` : ""}
                              </div>

                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                {visibilityLabel(row, users, user)} · {sourceLabel(row)}
                              </div>

                              {safeText(row.description) ? (
                                <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-200">
                                  {row.description}
                                </div>
                              ) : null}

                              {safeText((row as any).location) ? (
                                <div className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                                  Lugar: {(row as any).location}
                                </div>
                              ) : null}

                              {safeText((row as any).meetingUrl) ? (
                                <div className="mt-2">
                                  <span className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200">
                                    Abrir enlace
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}

            {viewMode === "agenda" ? (
              <div className="mt-4 grid gap-3">
                {agendaRows.length === 0 ? (
                  <div className="rounded-2xl border border-gray-200 p-4 text-sm text-gray-700 dark:border-gray-800 dark:text-gray-200">
                    No hay eventos en este período.
                  </div>
                ) : (
                  agendaRows.map((row) => {
                    const rescheduled = isRescheduledEvent(row);
                    const reminder = isReminderEvent(row);
                    const done = isDoneEvent(row);
                    const dotColor = rescheduled || done ? "#9ca3af" : row.color || "#3b82f6";

                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => openEventDetail(row)}
                        className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800/40"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className="mt-1 inline-block h-4 w-4 shrink-0 rounded-full border border-black/10"
                            style={{ backgroundColor: dotColor }}
                            title={colorLabel(dotColor)}
                          />

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                                {row.title}
                              </div>

                              {reminder ? (
                                <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
                                  Recordatorio
                                </span>
                              ) : null}

                              {isDeadlineEvent(row) ? (
                                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-800 dark:bg-red-900/30 dark:text-red-100">
                                  Vencimiento
                                </span>
                              ) : null}

                              {done ? (
                                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                                  Hecho
                                </span>
                              ) : null}

                              {rescheduled ? (
                                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-black uppercase text-gray-700 dark:bg-gray-700 dark:text-gray-100">
                                  Reprogramado
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                              {toDate(row.startAt)?.toLocaleDateString("es-AR") ?? "-"} · {fmtHour(row.startAt)}
                              {row.endAt ? ` → ${fmtHour(row.endAt)}` : ""}
                            </div>

                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                              {visibilityLabel(row, users, user)} · {sourceLabel(row)}
                            </div>

                            {safeText(row.caseRef?.caratula) ? (
                              <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                                Causa: {row.caseRef?.caratula}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Próximos eventos
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300">
                mostrando {upcomingRowsLimited.length} de {upcomingRows.length}
              </div>
            </div>

            <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
              {upcomingRowsLimited.length === 0 ? (
                <div className="py-2 text-sm text-gray-700 dark:text-gray-200">
                  No hay próximos eventos.
                </div>
              ) : (
                upcomingRowsLimited.map((row) => {
                  const reminder = isReminderEvent(row);
                  const dotColor = row.color || "#3b82f6";

                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => openEventDetail(row)}
                      className="block w-full py-3 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800/40"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-1 h-4 w-4 shrink-0 rounded-full border border-black/10"
                          style={{ backgroundColor: dotColor }}
                          title={colorLabel(dotColor)}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                              {row.title}
                            </div>

                            {reminder ? (
                              <span className="rounded bg-teal-100 px-2 py-0.5 text-[10px] font-black uppercase text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
                                Recordatorio
                              </span>
                            ) : null}

                            {isDeadlineEvent(row) ? (
                              <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-black uppercase text-red-800 dark:bg-red-900/30 dark:text-red-100">
                                Vencimiento
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {fmtDateTime(row.startAt)}
                            {row.endAt ? ` → ${fmtDateTime(row.endAt)}` : ""}
                          </div>

                          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {visibilityLabel(row, users, user)} · {sourceLabel(row)}
                          </div>

                          {safeText((row as any).location) ? (
                            <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                              Lugar: {(row as any).location}
                            </div>
                          ) : null}

                          {safeText((row as any).meetingUrl) ? (
                            <div className="mt-1">
                              <span className="text-xs font-extrabold underline text-gray-700 dark:text-gray-200">
                                Abrir enlace
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={!!selectedEvent}
        title={selectedEvent?.title || "Detalle del evento"}
        onClose={() => {
          setSelectedEvent(null);
          setReprogramModalOpen(false);
        }}
      >
        {selectedEvent ? (
          <div className="grid gap-4">
            {isReminderEvent(selectedEvent) ? (
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm font-bold text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-100">
                Este evento es un recordatorio.
              </div>
            ) : null}

            {isDeadlineEvent(selectedEvent) ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900 dark:border-red-800 dark:bg-red-900/20 dark:text-red-100">
                Este evento es un vencimiento.
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Inicio</div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {fmtDateTime(selectedEvent.startAt)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Fin</div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {selectedEvent.endAt ? fmtDateTime(selectedEvent.endAt) : "-"}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Visible para
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {visibilityLabel(selectedEvent, users, user)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Origen</div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {sourceLabel(selectedEvent)}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800 md:col-span-2">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Todo el día
                </div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {selectedEvent.allDay ? "Sí" : "No"}
                </div>
              </div>
            </div>

            {isDoneEvent(selectedEvent) ? (
              <div className="rounded-xl border border-gray-300 bg-gray-100 p-3 text-sm font-bold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                Este evento fue marcado como hecho.
              </div>
            ) : null}

            {isRescheduledEvent(selectedEvent) ? (
              <div className="rounded-xl border border-gray-300 bg-gray-100 p-3 text-sm font-bold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100">
                Este evento fue reprogramado.
              </div>
            ) : null}

            {safeText(selectedEvent.caseRef?.caratula) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Causa</div>
                <div className="mt-1 text-sm font-black text-gray-900 dark:text-gray-100">
                  {selectedEvent.caseRef?.caratula}
                </div>
              </div>
            ) : null}

            {safeText(selectedEvent.description) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Descripción
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-100">
                  {selectedEvent.description}
                </div>
              </div>
            ) : null}

            {safeText((selectedEvent as any).location) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                  Ubicación
                </div>
                <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {(selectedEvent as any).location}
                </div>
              </div>
            ) : null}

            {safeText((selectedEvent as any).meetingUrl) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">Enlace</div>
                <div className="mt-1">
                  <a
                    href={(selectedEvent as any).meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm font-extrabold underline text-gray-700 dark:text-gray-200"
                  >
                    {(selectedEvent as any).meetingUrl}
                  </a>
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <div className="text-xs font-extrabold text-gray-500 dark:text-gray-400">
                Creado por
              </div>
              <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {safeText((selectedEvent as any).createdByEmail) ||
                  safeText(selectedEvent.ownerEmail) ||
                  safeText(selectedEvent.ownerUid) ||
                  "-"}
              </div>
            </div>

            {!isDoneEvent(selectedEvent) &&
            !isRescheduledEvent(selectedEvent) &&
            isCompletableEvent(selectedEvent) ? (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
                <label className="inline-flex items-center gap-3 text-sm font-extrabold text-gray-900 dark:text-gray-100">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={markEventAsDone}
                    disabled={markDoneSaving}
                  />
                  <span>{markDoneSaving ? "Marcando..." : "Hecho"}</span>
                </label>
              </div>
            ) : null}

            {!isRescheduledEvent(selectedEvent) && !isDoneEvent(selectedEvent) ? (
              <div className="border-t border-gray-200 pt-4 dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setReprogramModalOpen((v) => !v)}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-extrabold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
                >
                  {reprogramModalOpen ? "Cancelar reprogramación" : "Reprogramar"}
                </button>

                {reprogramModalOpen ? (
                  <div className="mt-4 grid gap-3">
                    <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                      Reprogramar evento
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1">
                        <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                          Nuevo inicio
                        </span>
                        <input
                          type="datetime-local"
                          value={reprogramStartAtInput}
                          onChange={(e) => setReprogramStartAtInput(e.target.value)}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                        />
                      </label>

                      <label className="grid gap-1">
                        <span className="text-xs font-extrabold text-gray-700 dark:text-gray-200">
                          Nuevo fin
                        </span>
                        <input
                          type="datetime-local"
                          value={reprogramEndAtInput}
                          onChange={(e) => setReprogramEndAtInput(e.target.value)}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-100"
                        />
                      </label>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={reprogramEvent}
                        disabled={reprogramSaving}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-extrabold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        {reprogramSaving ? "Reprogramando..." : "Confirmar reprogramación"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ScrollToTopButton />
    </AppShell>
  );
}