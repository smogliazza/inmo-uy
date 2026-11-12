"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useToast } from "@/components/ui/Toast";
import { useExtra, fmt } from "@/lib/i18n/extra";
import { api, ApiError, dateInputToISO } from "@/lib/api";
import { useSettings } from "@/lib/settings/useSettings";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS, zhCN, es } from "date-fns/locale";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { fmtLocale } from "@/lib/format";

const locales = {
  en:     enUS,
  "zh-CN": zhCN,
  "zh-TW": zhCN,   // date-fns only has zhCN; close enough for calendar headers
  es:     es,
};
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

export default function AppointmentsPage() {
  const { t, language } = useI18n();
  const toast = useToast();
  const X = useExtra();
  // Brokerage rules (Settings > Appointments) and this person's preferences
  const { policies, preferences } = useSettings();
  const ap = policies.appointments;

  const [appointments, setAppointments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [viewMode, setViewMode] = React.useState<"list" | "calendar">("list");
  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSyncingGoogle, setIsSyncingGoogle] = React.useState(false);

  // Form data for new appointment
  const [formData, setFormData] = React.useState({
    title: "",
    date: "",
    notes: "",
    status: "SCHEDULED",
    clientId: "",
    propertyId: "",
    type: "SHOWING",
    location: "",
  });

  // Reference data
  const [clients, setClients] = React.useState<any[]>([]);
  const [properties, setProperties] = React.useState<any[]>([]);

  const fetchAppointments = () => {
    setLoading(true);
    const token = localStorage.getItem("token");
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/appointments`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setAppointments(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  React.useEffect(() => {
    fetchAppointments();

    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };

    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/clients?limit=100`, { headers })
      .then((res) => res.json())
      .then((data) => setClients(data.data || []));
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/properties?limit=100`, { headers })
      .then((res) => res.json())
      .then((data) => setProperties(data.data || []));
  }, []);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // A blank form. New appointments start Confirmed when the person prefers that.
  const blankForm = () => ({
    title: "", date: "", notes: "", clientId: "", propertyId: "", type: "SHOWING", location: "",
    status: preferences.appointments.autoConfirm ? "CONFIRMED" : "SCHEDULED",
  });
  const openAddModal = () => { setFormData(blankForm()); setIsAddModalOpen(true); };

  const saveAppointment = async (force = false): Promise<void> => {
    setIsSubmitting(true);
    try {
      await api("/api/appointments", {
        method: "POST",
        body: {
          ...formData,
          date: dateInputToISO(formData.date),
          clientId: formData.clientId || undefined,
          propertyId: formData.propertyId || undefined,
          ...(force ? { force: true } : {}),
        },
      });
      setIsAddModalOpen(false);
      setFormData(blankForm());
      fetchAppointments();
      toast.success(t.appointments.modal.save ?? "Meeting scheduled");
    } catch (err) {
      // The brokerage prevents double booking: let the person book it anyway after confirming
      if (err instanceof ApiError && err.status === 409 && err.body?.code === "APPOINTMENT_CONFLICT") {
        // Show the clash in the viewer's own time zone (the server message is in UTC)
        const c = err.body?.conflict;
        const msg = c?.date
          ? fmt(X.policy.appointments.overlaps, { title: c.title, time: new Date(c.date).toLocaleString(fmtLocale()) })
          : err.message;
        if (window.confirm(fmt(X.policy.appointments.conflictConfirm, { msg }))) {
          setIsSubmitting(false);
          return saveAppointment(true);
        }
      } else {
        toast.error(err instanceof Error ? err.message : t.appointments.failSchedule || "Failed to schedule appointment");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    return saveAppointment();
  };

  const handleSyncGoogle = async () => {
    setIsSyncingGoogle(true);
    // Placeholder: Google Calendar OAuth integration — coming soon
    await new Promise(resolve => setTimeout(resolve, 1200));
    setIsSyncingGoogle(false);
    toast.info(t.appointments.syncSuccess ?? "Google Calendar sync is coming soon.");
  };

  const updateAppointment = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/appointments/${id}`, { method: "PATCH", body });
      toast.success(X.appts.updated);
      fetchAppointments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    }
  };

  const deleteAppointment = async (id: string) => {
    if (!window.confirm(X.common.confirmDelete)) return;
    try {
      await api(`/api/appointments/${id}`, { method: "DELETE" });
      toast.success(X.appts.deleted);
      fetchAppointments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    }
  };

  const upcomingAppointments = appointments.filter(
    (a) => new Date(a.date) >= new Date() && a.status !== "CANCELLED",
  );
  const pastAppointments = appointments.filter(
    (a) => new Date(a.date) < new Date() || a.status === "CANCELLED",
  );

  const renderAppointmentCard = (apt: any) => {
    const dateObj = new Date(apt.date);
    const day = dateObj.getDate().toString().padStart(2, "0");
    const month = dateObj
      .toLocaleString(fmtLocale(), { month: "short" })
      .toUpperCase();
    const time = dateObj.toLocaleTimeString(fmtLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div
        key={apt.id}
        className="bg-surface border border-border p-6 flex items-stretch gap-6 group hover:border-primary/50 transition-colors duration-500"
      >
        {/* Date Block */}
        <div className="flex flex-col items-center justify-center pr-6 border-r border-border min-w-[100px]">
          <span className="text-primary text-base uppercase tracking-widest font-sans mb-1">
            {month}
          </span>
          <span className="font-serif text-4xl text-foreground font-light">
            {day}
          </span>
          <span className="text-foreground/40 text-xs uppercase tracking-widest mt-2">
            {time}
          </span>
        </div>

        {/* Content Block */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="flex justify-between items-start mb-2">
            <h3 className="font-serif text-2xl text-foreground font-light group-hover:text-primary transition-colors">
              {apt.title}
            </h3>
            <span
              className={`text-xs px-2 py-1 uppercase tracking-widest border
                            ${apt.status === "SCHEDULED" || apt.status === "CONFIRMED" ? "bg-primary/10 border-primary/20 text-primary" : ""}
                            ${apt.status === "COMPLETED" ? "bg-surface border-border text-foreground/50" : ""}
                            ${apt.status === "CANCELLED" ? "bg-red-900/10 border-red-900/20 text-red-500/80" : ""}
                        `}
            >
              {apt.status === "COMPLETED"
                ? t.appointments.modal.completed
                : apt.status === "CANCELLED"
                  ? t.appointments.modal.cancelled
                  : apt.status === "CONFIRMED"
                    ? X.appts.confirm
                    : t.appointments.modal.scheduled}
            </span>
          </div>

          <div className="flex gap-4 text-sm font-sans uppercase tracking-widest text-foreground/50">
            {apt.client && (
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 bg-border rounded-full inline-block mr-1"></span>
                {apt.client.firstName} {apt.client.lastName}
              </span>
            )}
            {apt.property && (
              <span className="flex items-center gap-1">
                <span className="w-1 h-1 bg-border rounded-full inline-block mr-1"></span>
                {apt.property.address}
              </span>
            )}
          </div>

          {apt.notes && (
            <p className="mt-4 text-base font-sans text-foreground/70 line-clamp-2 leading-relaxed">
              {apt.notes}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            {apt.type && <span className="px-2 py-0.5 border border-border text-foreground/60 uppercase tracking-widest">{(X.appts.types as any)[apt.type] || apt.type}</span>}
            {apt.location && <span className="text-foreground/50">📍 {apt.location}</span>}
            {apt.status !== "COMPLETED" && apt.status !== "CANCELLED" && (
              <>
                {apt.status !== "CONFIRMED" && (
                  <button onClick={() => updateAppointment(apt.id, { status: "CONFIRMED" })} className="text-primary hover:underline">{X.appts.confirm}</button>
                )}
                <button onClick={() => updateAppointment(apt.id, { status: "COMPLETED" })} className="text-primary hover:underline">{X.appts.markComplete}</button>
                <button onClick={() => updateAppointment(apt.id, { status: "CANCELLED" })} className="text-foreground/50 hover:underline">{X.appts.markCancelled}</button>
              </>
            )}
            <button onClick={() => deleteAppointment(apt.id)} className="text-foreground/40 hover:text-red-500">{X.common.delete}</button>
          </div>
        </div>
      </div>
    );
  };

  // Format appointments for react-big-calendar
  const calendarEvents = appointments.map((apt) => ({
    id: apt.id,
    title: `${apt.title} ${apt.status === "CANCELLED" ? "(Cancelled)" : ""}`,
    start: new Date(apt.date),
    end: apt.endDate ? new Date(apt.endDate) : new Date(new Date(apt.date).getTime() + (apt.durationMin || 60) * 60 * 1000),
    raw: apt,
  }));

  // Week/day views show the brokerage's workday hours, stretched so no appointment is ever hidden
  const visibleRange = (() => {
    const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    let lo = toMin(ap.workdayStart), hi = toMin(ap.workdayEnd);
    for (const ev of calendarEvents) {
      lo = Math.min(lo, ev.start.getHours() * 60 + ev.start.getMinutes());
      const sameDay = ev.end.toDateString() === ev.start.toDateString();
      hi = Math.max(hi, sameDay ? ev.end.getHours() * 60 + ev.end.getMinutes() : 24 * 60 - 1);
    }
    hi = Math.min(hi, 24 * 60 - 1);
    return { min: new Date(1970, 0, 1, Math.floor(lo / 60), lo % 60), max: new Date(1970, 0, 1, Math.floor(hi / 60), hi % 60) };
  })();

  const handleSelectEvent = (event: any) => {
    // Show a brief toast with appointment details; edit modal can be added later
    const clientName = event.raw.client
      ? `${event.raw.client.firstName} ${event.raw.client.lastName}`
      : null;
    const parts = [event.title];
    if (clientName) parts.push(`Client: ${clientName}`);
    if (event.raw.property?.address) parts.push(`Property: ${event.raw.property.address}`);
    toast.info(parts.join(" · "));
  };

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out text-foreground">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 border-b border-border pb-8">
        <div className="max-w-xl">
          <h1 className="font-serif text-5xl font-light tracking-tight text-foreground">
            {t.appointments.title}
          </h1>
          <p className="font-sans text-foreground/60 mt-4 text-base font-light leading-relaxed">
            {t.appointments.subtitle}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
          <button
            onClick={handleSyncGoogle}
            disabled={isSyncingGoogle}
            className="px-6 py-3 bg-blue-600/10 text-blue-500 border border-blue-600/20 hover:bg-blue-600/20 transition-colors duration-500 rounded-xl text-base font-semibold w-full sm:w-auto text-center flex items-center justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.64 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
            </svg>
            {isSyncingGoogle ? (t.appointments.syncing ?? "Syncing...") : (t.appointments.syncGoogle ?? "Sync with Google")}
          </button>
          <button
            onClick={openAddModal}
            className="px-6 py-3 bg-primary text-background hover:bg-primary-hover transition-colors duration-500 rounded-xl text-base font-semibold w-full sm:w-auto text-center shadow-md"
          >
            {t.appointments.addMeeting}
          </button>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setViewMode("list")}
          className={`px-8 py-4 font-sans text-sm uppercase tracking-widest transition-colors ${viewMode === "list" ? "border-b-2 border-primary text-foreground" : "text-foreground/40 hover:text-foreground"}`}
        >
          {t.appointments.list}
        </button>
        <button
          onClick={() => setViewMode("calendar")}
          className={`px-8 py-4 font-sans text-sm uppercase tracking-widest transition-colors ${viewMode === "calendar" ? "border-b-2 border-primary text-foreground" : "text-foreground/40 hover:text-foreground"}`}
        >
          {t.appointments.calendar}
        </button>
      </div>

      {/* Main Content */}
      <div className="min-h-[500px]">
        {loading ? (
          <div className="py-24 border border-border bg-surface/30 text-center text-foreground/50 tracking-widest uppercase text-sm">
            {t.appointments.loading || "Loading..."}
          </div>
        ) : appointments.length === 0 ? (
          <div className="py-24 border border-border bg-surface/30 text-center text-foreground/50 tracking-widest uppercase text-sm">
            {t.appointments.empty}
          </div>
        ) : viewMode === "list" ? (
          <div className="space-y-12">
            {/* Upcoming Section */}
            {upcomingAppointments.length > 0 && (
              <div>
                <h2 className="font-serif text-2xl text-foreground font-light mb-6 flex items-center gap-4">
                  {t.appointments.upcoming}
                  <span className="h-px bg-border flex-1"></span>
                  <span className="text-sm font-sans text-foreground/30 uppercase tracking-widest">
                    {upcomingAppointments.length}
                  </span>
                </h2>
                <div className="space-y-4">
                  {upcomingAppointments.map(renderAppointmentCard)}
                </div>
              </div>
            )}

            {/* Past/Completed Section */}
            {pastAppointments.length > 0 && (
              <div>
                <h2 className="font-serif text-xl text-foreground/60 font-light mb-6 flex items-center gap-4">
                  {t.appointments.past}
                  <span className="h-px bg-border flex-1 opacity-50"></span>
                </h2>
                <div className="space-y-4 opacity-70 grayscale-[30%]">
                  {pastAppointments.map(renderAppointmentCard)}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="border border-border p-6 bg-surface/20 min-h-[600px] h-[80vh]">
            <style>{`
                            .rbc-calendar { font-family: var(--font-sans); color: var(--foreground); }
                            .rbc-header { border-bottom: 1px solid var(--border); padding: 10px; font-weight: normal; text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.75rem; color: var(--foreground); opacity: 0.6; }
                            .rbc-month-view, .rbc-time-view, .rbc-agenda-view { border: 1px solid var(--border); border-radius: 0; background: transparent; }
                            .rbc-day-bg { border-left: 1px solid var(--border); }
                            .rbc-month-row { border-top: 1px solid var(--border); }
                            .rbc-today { background-color: rgba(197, 160, 89, 0.05); }
                            .rbc-event { background-color: var(--primary); border-radius: 0; color: var(--background); text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.65rem; padding: 2px 6px; border: none; }
                            .rbc-event.rbc-selected { background-color: var(--primary-hover); }
                            .rbc-off-range-bg { background-color: rgba(255, 255, 255, 0.02); }
                            .rbc-button-link { color: var(--foreground); }
                            .rbc-toolbar button { font-family: var(--font-sans); color: var(--foreground); border: 1px solid var(--border); border-radius: 0; padding: 6px 12px; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; background: transparent; transition: all 0.3s; margin-right: 4px; }
                            .rbc-toolbar button:hover, .rbc-toolbar button:focus, .rbc-toolbar button:active { background-color: var(--border); color: var(--foreground); box-shadow: none; outline: none; }
                            .rbc-toolbar button.rbc-active { background-color: var(--primary); color: var(--background); border-color: var(--primary); }
                            .rbc-toolbar .rbc-toolbar-label { font-family: var(--font-serif); font-size: 1.5rem; font-weight: 300; }
                            .rbc-time-content { border-top: 1px solid var(--border); }
                            .rbc-time-header.rbc-overflowing { border-right: 1px solid var(--border); }
                            .rbc-time-header-content { border-left: 1px solid var(--border); }
                            .rbc-timeslot-group { border-bottom: 1px solid var(--border); }
                            .rbc-day-slot .rbc-time-slot { border-top: 1px dotted var(--border); opacity: 0.3; }
                        `}</style>
            <Calendar
              localizer={localizer}
              events={calendarEvents}
              views={ap.showWeekends ? ["month", "week", "day", "agenda"] : ["month", "work_week", "day", "agenda"]}
              min={visibleRange.min}
              max={visibleRange.max}
              startAccessor="start"
              endAccessor="end"
              style={{ height: "100%" }}
              onSelectEvent={handleSelectEvent}
              culture={language}
              messages={{
                today: t.appointments.calendarTranslations?.today,
                previous: t.appointments.calendarTranslations?.previous,
                next: t.appointments.calendarTranslations?.next,
                month: t.appointments.calendarTranslations?.month,
                week: t.appointments.calendarTranslations?.week,
                work_week: t.appointments.calendarTranslations?.week,
                day: t.appointments.calendarTranslations?.day,
                agenda: t.appointments.calendarTranslations?.agenda,
                date: t.appointments.calendarTranslations?.date,
                time: t.appointments.calendarTranslations?.time,
                event: t.appointments.calendarTranslations?.event,
                showMore: (total) => `+${total} more`,
              }}
            />
          </div>
        )}
      </div>

      {/* Add Appointment Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm animate-in fade-in duration-500">
          <div className="bg-background border border-border shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] rounded-none">
            <div className="p-8 border-b border-border flex justify-between items-center bg-surface">
              <h2 className="font-serif text-3xl font-light text-foreground">
                {t.appointments.modal.title}
              </h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-foreground/50 hover:text-primary text-3xl font-light transition-colors leading-none"
              >
                &times;
              </button>
            </div>
            <form
              onSubmit={handleAddAppointment}
              className="p-8 overflow-y-auto space-y-8"
            >
              <div>
                <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">
                  {t.appointments.modal.meetingTitle}
                </label>
                <input
                  required
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  type="text"
                  className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors placeholder:text-foreground/20"
                  placeholder="e.g. Property Showing at 123 Main St"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">
                    {t.appointments.modal.date}
                  </label>
                  <input
                    required
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                    type="datetime-local"
                    className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors font-sans"
                  />
                </div>
                <div>
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">
                    {t.appointments.modal.status}
                  </label>
                  <select
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors appearance-none cursor-pointer"
                  >
                    <option value="SCHEDULED">
                      {t.appointments.modal.scheduled}
                    </option>
                    <option value="CONFIRMED">{X.appts.confirm}</option>
                    <option value="COMPLETED">
                      {t.appointments.modal.completed}
                    </option>
                    <option value="CANCELLED">
                      {t.appointments.modal.cancelled}
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">{X.appts.type}</label>
                  <select
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors appearance-none cursor-pointer"
                  >
                    {Object.entries(X.appts.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">{X.appts.location}</label>
                  <input
                    name="location"
                    value={formData.location}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">
                    {t.appointments.modal.selectClient}
                  </label>
                  <select
                    name="clientId"
                    value={formData.clientId}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors appearance-none cursor-pointer"
                  >
                    <option value="">-- {t.appointments.none ?? "None"} --</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.firstName} {c.lastName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">
                    {t.appointments.modal.selectProperty}
                  </label>
                  <select
                    name="propertyId"
                    value={formData.propertyId}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors appearance-none cursor-pointer"
                  >
                    <option value="">-- {t.appointments.none ?? "None"} --</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.address}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-2">
                  {t.appointments.modal.notes}
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="w-full px-4 py-3 bg-surface border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors placeholder:text-foreground/20"
                  placeholder="Optional notes for the meeting..."
                ></textarea>
              </div>

              <div className="pt-6 flex justify-end gap-4 mt-8 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-6 py-3 bg-transparent border border-border text-foreground/70 rounded-none text-base uppercase tracking-widest font-medium hover:text-foreground hover:border-foreground transition-colors"
                >
                  {t.appointments.modal.cancel}
                </button>
                <button
                  disabled={isSubmitting}
                  type="submit"
                  className="px-6 py-3 bg-primary text-background rounded-none text-base uppercase tracking-widest font-medium hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {isSubmitting
                    ? t.appointments.modal.saving
                    : t.appointments.modal.save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
