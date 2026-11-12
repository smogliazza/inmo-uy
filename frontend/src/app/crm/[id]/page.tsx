"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useExtra, fmt, label } from "@/lib/i18n/extra";
import { useToast } from "@/components/ui/Toast";
import { api, dateInputToISO } from "@/lib/api";
import { useAiAssistantEnabled } from "@/lib/modules";
import { fmtLocale } from "@/lib/format";
import { formatPhoneUY } from "@/lib/catalogs";

interface TimelineEvent {
  id: string;
  type: "OFFER" | "APPOINTMENT" | "GIFT" | "TRANSACTION" | "MODIFICATION" | "NOTE" | "TASK";
  subtype?: string;
  title: string;
  description: string;
  date: string;
  status?: string;
}

export default function ClientProfilePage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useI18n();
  const { token } = useAuth();
  const X = useExtra();
  const toast = useToast();
  const AI_ON = useAiAssistantEnabled();
  const [now] = useState(() => Date.now());

  const [client, setClient] = useState<any>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states for Edit Profile
  const [editForm, setEditForm] = useState<any>({});
  // Form states for Log Activity
  const [logForm, setLogForm] = useState({ type: "CALL", subject: "", content: "", followUpDate: "" });

  useEffect(() => {
    if (!token || !id) return;

    const fetchClientDetails = async () => {
      setLoading(true);
      try {
        const [clientRes, timelineRes] = await Promise.all([
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/clients/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/clients/${id}/timeline`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (clientRes.ok) {
          const data = await clientRes.json();
          setClient(data);
          setEditForm(data);
        }
        if (timelineRes.ok) setTimeline(await timelineRes.json());
      } catch (error) {
        console.error("Failed to fetch client details", error);
      } finally {
        setLoading(false);
      }
    };

    fetchClientDetails();
  }, [id, token]);

  const fetchTimeline = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/clients/${id}/timeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setTimeline(await res.json());
    } catch (e) { console.error(e); }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fields = ["firstName", "lastName", "email", "phone", "type", "funnelStage", "budget", "source", "tags", "temperature", "preferredContact", "notes"];
      const body: Record<string, unknown> = {};
      for (const f of fields) if (editForm[f] !== undefined) body[f] = editForm[f];
      const updated = await api(`/api/clients/${id}`, { method: "PATCH", body });
      setClient((prev: any) => ({ ...prev, ...updated }));
      setShowEditModal(false);
      toast.success(X.common.saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : X.common.error);
    } finally {
      setSaving(false);
    }
  };

  const handleLogActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api(`/api/clients/${id}/activities`, {
        method: "POST",
        body: { ...logForm, followUpDate: dateInputToISO(logForm.followUpDate) || undefined },
      });
      setShowLogModal(false);
      setLogForm({ type: "CALL", subject: "", content: "", followUpDate: "" });
      setClient((prev: any) => ({ ...prev, lastContactedAt: new Date().toISOString() }));
      toast.success(X.detail.logged);
      fetchTimeline();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : X.common.error);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!window.confirm(X.crm.archiveConfirm)) return;
    try {
      await api(`/api/clients/${id}`, { method: "DELETE" });
      toast.success(X.crm.archived);
      router.push("/crm");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : X.common.error);
    }
  };

  const lastContactDays = client?.lastContactedAt
    ? Math.floor((now - new Date(client.lastContactedAt).getTime()) / 86400000)
    : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-12 text-center text-foreground/50 font-sans">
        {t.crm.timeline.clientNotFound ?? "Client not found."}
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700 ease-out text-foreground pb-20">
      {/* Header / Breadcrumbs */}
      <div className="flex flex-col gap-6 border-b border-border/40 pb-8">
        <button
          onClick={() => router.back()}
          className="text-sm uppercase tracking-widest text-foreground/50 hover:text-primary transition-colors flex items-center gap-2 w-fit"
        >
          &larr; {t.crm.table.backToList}
        </button>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="font-sans text-4xl font-semibold tracking-tight text-foreground">
              {client.firstName} {client.lastName}
            </h1>
            <div className="flex items-center gap-4 mt-3">
              <span className="text-sm font-semibold px-3 py-1 bg-primary/10 text-primary rounded-full uppercase tracking-widest">
                {label(X.labels.clientType, client.type)}
              </span>
              <span className="text-sm font-semibold px-3 py-1 bg-surface ring-1 ring-border/50 text-foreground/60 rounded-full uppercase tracking-widest">
                {label(X.labels.status, client.status)}
              </span>
              {client.temperature && (
                <span className={`text-sm font-semibold px-3 py-1 rounded-full uppercase tracking-widest ${client.temperature === "HOT" ? "bg-red-500/10 text-red-500" : client.temperature === "COLD" ? "bg-sky-500/10 text-sky-600" : "bg-amber-500/10 text-amber-600"}`}>
                  {(X.crm as any)[client.temperature]}
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-4 w-full md:w-auto">
            <button 
              onClick={() => setShowEditModal(true)}
              className="flex-1 md:flex-none px-6 py-2.5 bg-primary text-background rounded-xl text-base font-semibold hover:bg-primary-hover transition-colors shadow-sm"
            >
              {t.crm.timeline.editProfile}
            </button>
            <button 
              onClick={() => setShowLogModal(true)}
              className="flex-1 md:flex-none px-6 py-2.5 bg-surface text-foreground ring-1 ring-border/50 rounded-xl text-base font-semibold hover:bg-background transition-colors shadow-sm"
            >
              {t.crm.timeline.logActivity}
            </button>
            {AI_ON && <button
              onClick={() => router.push(`/marketing?skill=follow_up&clientId=${id}`)}
              className="flex-1 md:flex-none px-6 py-2.5 bg-surface text-primary ring-1 ring-primary/40 rounded-xl text-base font-semibold hover:bg-primary/5 transition-colors shadow-sm"
            >
              ✨ {X.detail.aiFollowUp}
            </button>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        {/* Contact Info Sidebar */}
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-background ring-1 ring-border/50 rounded-2xl p-6 shadow-sm space-y-6">
            <h3 className="font-sans text-base font-bold uppercase tracking-widest text-foreground/40 border-b border-border/40 pb-4">
              {t.crm.timeline.contactDetails}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">
                  {t.crm.timeline.email}
                </label>
                <p className="font-sans text-base text-foreground/80 break-all">
                  {client.email || "—"}
                </p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">
                  {t.crm.timeline.phone}
                </label>
                <p className="font-sans text-base text-foreground/80">
                  {formatPhoneUY(client.phone) || "—"}
                </p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">
                  {t.crm.timeline.budget}
                </label>
                <p className="font-sans text-base text-foreground/80">
                  {client.budget || "—"}
                </p>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">{X.crm.lastContact}</label>
                <p className={`font-sans text-base ${lastContactDays === null || lastContactDays >= 14 ? "text-red-500" : "text-foreground/80"}`}>
                  {lastContactDays === null ? X.crm.never : lastContactDays === 0 ? X.crm.today : fmt(X.crm.daysAgo, { n: lastContactDays })}
                </p>
              </div>
              {client.source && (
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">{X.crm.source}</label>
                  <p className="font-sans text-base text-foreground/80">{client.source}</p>
                </div>
              )}
              {client.tags && (
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">{X.crm.tags}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {String(client.tags).split(",").map((tag: string) => tag.trim()).filter(Boolean).map((tag: string) => (
                      <span key={tag} className="text-xs px-2 py-0.5 rounded bg-surface ring-1 ring-border/50 text-foreground/70">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
              {client.agent?.name && (
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/30 font-bold mb-1">{X.publicListing.agent}</label>
                  <p className="font-sans text-base text-foreground/80">{client.agent.name}</p>
                </div>
              )}
            </div>
          </div>
          <button onClick={handleArchive} className="text-sm text-foreground/40 hover:text-red-500 transition-colors">
            {X.crm.archive}
          </button>
        </div>

        {/* Timeline Area */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          <h2 className="font-sans text-2xl font-semibold text-foreground flex items-center gap-3">
            {t.crm.timeline.title}
            <span className="text-xs uppercase tracking-widest bg-primary/10 text-primary px-2 py-0.5 rounded">
              {t.crm.timeline.live}
            </span>
          </h2>

          <div className="relative border-l border-border/60 ml-3 space-y-12 pb-12">
            {timeline.length === 0 ? (
              <p className="pl-8 text-foreground/40 font-sans text-base italic">
                {t.crm.timeline.noHistory}
              </p>
            ) : (
              timeline.map((event) => (
                <div key={event.id} className="relative pl-8 group">
                  {/* Timeline Dot */}
                  <div className="absolute left-[-5px] top-1.5 w-2.5 h-2.5 rounded-full bg-border group-hover:bg-primary ring-4 ring-background transition-colors z-10" />
                  
                  <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
                    <h4 className="font-sans font-bold text-foreground group-hover:text-primary transition-colors">
                      {event.title}
                    </h4>
                    <span className="text-xs font-sans font-semibold text-foreground/30 uppercase tracking-widest">
                      {new Date(event.date).toLocaleDateString(fmtLocale(), {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="font-sans text-base text-foreground/60 mt-1 whitespace-pre-line">
                    {event.description}
                  </p>
                  
                  {event.status && (
                    <div className="mt-3 flex gap-2">
                      <span className="text-xs font-bold uppercase tracking-tighter px-2 py-0.5 bg-surface ring-1 ring-border/50 text-foreground/50 rounded">
                        {label(X.labels.event, event.type)}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-tighter px-2 py-0.5 bg-primary/5 text-primary rounded">
                        {label(X.labels.status, event.status)}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-surface ring-1 ring-border shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-border/40 flex justify-between items-center">
              <h3 className="font-sans text-xl font-bold">{(t.crm.timeline as any).modals?.editTitle}</h3>
              <button 
                onClick={() => setShowEditModal(false)}
                className="text-foreground/40 hover:text-foreground transition-colors"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleUpdateProfile} className="p-6 space-y-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.modal.firstName}</label>
                  <input 
                    type="text" 
                    value={editForm.firstName || ""} 
                    onChange={e => setEditForm({...editForm, firstName: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.modal.lastName}</label>
                  <input 
                    type="text" 
                    value={editForm.lastName || ""} 
                    onChange={e => setEditForm({...editForm, lastName: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.timeline.email}</label>
                <input 
                  type="email" 
                  value={editForm.email || ""} 
                  onChange={e => setEditForm({...editForm, email: e.target.value})}
                  className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.timeline.phone}</label>
                <input 
                  type="text" 
                  value={editForm.phone || ""} 
                  onChange={e => setEditForm({...editForm, phone: e.target.value})}
                  className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.modal.type}</label>
                  <select 
                    value={editForm.type || "BUYER"} 
                    onChange={e => setEditForm({...editForm, type: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none appearance-none"
                  >
                    <option value="BUYER">{t.crm.modal.typeBuyer}</option>
                    <option value="SELLER">{t.crm.modal.typeSeller}</option>
                    <option value="REFERRAL">{t.crm.modal.typeReferral}</option>
                    <option value="RENTER">{X.crm.typeRenter}</option>
                    <option value="INVESTOR">{X.crm.typeInvestor}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.modal.stage ?? "Stage"}</label>
                  <select 
                    value={editForm.funnelStage || "LEAD"} 
                    onChange={e => setEditForm({...editForm, funnelStage: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none appearance-none"
                  >
                    <option value="LEAD">LEAD</option>
                    <option value="QUALIFIED">QUALIFIED</option>
                    <option value="SHOWING">SHOWING</option>
                    <option value="OFFERING">OFFERING</option>
                    <option value="IN_CONTRACT">IN CONTRACT</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{X.crm.priority}</label>
                  <select
                    value={editForm.temperature || "WARM"}
                    onChange={e => setEditForm({...editForm, temperature: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none appearance-none"
                  >
                    <option value="HOT">{X.crm.HOT}</option>
                    <option value="WARM">{X.crm.WARM}</option>
                    <option value="COLD">{X.crm.COLD}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{t.crm.timeline.budget}</label>
                  <input
                    type="text"
                    value={editForm.budget || ""}
                    onChange={e => setEditForm({...editForm, budget: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{X.crm.source}</label>
                  <input
                    type="text"
                    value={editForm.source || ""}
                    placeholder={X.crm.sourcePlaceholder}
                    onChange={e => setEditForm({...editForm, source: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{X.crm.tags}</label>
                  <input
                    type="text"
                    value={editForm.tags || ""}
                    placeholder={X.crm.tagsPlaceholder}
                    onChange={e => setEditForm({...editForm, tags: e.target.value})}
                    className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                  />
                </div>
              </div>
            </form>
            <div className="p-6 bg-surface border-t border-border/40 flex gap-4">
              <button
                onClick={() => setShowEditModal(false)}
                className="flex-1 py-3 ring-1 ring-border/50 rounded-xl text-base font-semibold hover:bg-background transition-colors"
              >
                {(t.crm.timeline as any).modals?.cancel ?? "Cancel"}
              </button>
              <button
                onClick={handleUpdateProfile}
                disabled={saving}
                className="flex-1 py-3 bg-primary text-background rounded-xl text-base font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50"
              >
                {saving ? ((t.crm.timeline as any).modals?.saving ?? "Saving...") : ((t.crm.timeline as any).modals?.saveChanges ?? "Save Changes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Activity Modal */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-surface ring-1 ring-border shadow-2xl rounded-2xl w-full max-w-lg flex flex-col">
            <div className="p-6 border-b border-border/40 flex justify-between items-center">
              <h3 className="font-sans text-xl font-bold">{(t.crm.timeline as any).modals?.logTitle}</h3>
              <button 
                onClick={() => setShowLogModal(false)}
                className="text-foreground/40 hover:text-foreground transition-colors"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleLogActivity} className="p-6 space-y-6">
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{(t.crm.timeline as any).modals?.activityType ?? "Activity Type"}</label>
                <div className="grid grid-cols-3 gap-2">
                  {["CALL", "EMAIL", "TEXT", "MEETING", "SHOWING", "NOTE"].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setLogForm({...logForm, type})}
                      className={`py-2 px-3 border rounded-xl text-xs font-bold tracking-widest transition-all ${logForm.type === type ? 'bg-primary border-primary text-background shadow-md' : 'border-border/40 text-foreground/50 hover:border-foreground/40'}`}
                    >
                      {(X.detail as any)[type] || type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{(t.crm.timeline as any).modals?.subject ?? "Subject"}</label>
                <input 
                  type="text" 
                  value={logForm.subject} 
                  onChange={e => setLogForm({...logForm, subject: e.target.value})}
                  placeholder="Summarize the interaction..."
                  className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all placeholder:text-foreground/20"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{(t.crm.timeline as any).modals?.details ?? "Details"}</label>
                <textarea 
                  value={logForm.content} 
                  onChange={e => setLogForm({...logForm, content: e.target.value})}
                  rows={4}
                  placeholder="Record key takeaways or next steps..."
                  className="w-full bg-background ring-1 ring-border/50 px-4 py-3 rounded-xl text-base outline-none focus:ring-primary/50 transition-all resize-none placeholder:text-foreground/20"
                />
              </div>
              <div>
                <label className="block text-xs uppercase tracking-widest text-foreground/40 font-bold mb-2">{X.detail.followUpDate} ({X.common.optional})</label>
                <input
                  type="date"
                  value={logForm.followUpDate}
                  onChange={e => setLogForm({...logForm, followUpDate: e.target.value})}
                  className="w-full bg-background ring-1 ring-border/50 px-4 py-2.5 rounded-xl text-base outline-none focus:ring-primary/50 transition-all"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="flex-1 py-3 ring-1 ring-border/50 rounded-xl text-base font-semibold hover:bg-background transition-colors"
                >
                  {(t.crm.timeline as any).modals?.cancel ?? "Cancel"}
                </button>
                <button
                  type="submit"
                  disabled={saving || !logForm.subject}
                  className="flex-1 py-3 bg-primary text-background rounded-xl text-base font-semibold hover:bg-primary-hover transition-colors disabled:opacity-50"
                >
                  {saving ? ((t.crm.timeline as any).modals?.saving ?? "Saving...") : ((t.crm.timeline as any).modals?.logActivityBtn ?? "Log Activity")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
