"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useAuth } from "@/lib/auth/AuthContext";
import { useTheme, ThemeName } from "@/lib/theme/ThemeContext";
import { useToast } from "@/components/ui/Toast";
import { useExtra } from "@/lib/i18n/extra";
import { uploadFile } from "@/lib/api";

// ─── Role hierarchy ─────────────────────────────────────────────────────────────
const ROLE_WEIGHT: Record<string, number> = {
  SUPERADMIN: 6, FIRMADMIN: 5, MANAGER: 4, AGENT: 3,
  MARKETING: 2, OFFICE_SUPPORT: 2, ATTORNEY: 1, LENDER: 1, TITLECO: 1,
};

import { INPUT_CLS, SELECT_CLS, TEXTAREA_CLS, LOCKED_BADGE, Toggle, SectionHeader, SettingRow, LockedRow, SubTabs } from "./ui";
import { CrmSettings, PropertiesSettings, FinanceSettings, AppointmentsSettings, DocumentsSettings } from "./PolicySections";
import ModulesSettings from "./ModulesSettings";
import WebsiteSettings from "./WebsiteSettings";
import { useSettings } from "@/lib/settings/useSettings";
import { useModules, ModuleKey } from "@/lib/modules";
import { fmtLocale } from "@/lib/format";

// ─── Permission level types ─────────────────────────────────────────────────────
type PermLevel = "full" | "team" | "own" | "read" | "none";
const MATRIX_ROLES = ["MANAGER", "AGENT", "OFFICE_SUPPORT", "MARKETING", "ATTORNEY", "LENDER", "TITLECO"];

const DEFAULT_ACCESS: Record<string, Record<string, PermLevel>> = {
  crm:          { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "read", MARKETING: "read", ATTORNEY: "read", LENDER: "none", TITLECO: "none" },
  properties:   { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "read", MARKETING: "full", ATTORNEY: "read", LENDER: "none", TITLECO: "none" },
  transactions: { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "read", MARKETING: "none", ATTORNEY: "read", LENDER: "read", TITLECO: "read" },
  finance:      { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "none", MARKETING: "none", ATTORNEY: "none", LENDER: "none", TITLECO: "none" },
  appointments: { MANAGER: "full", AGENT: "own",  OFFICE_SUPPORT: "full", MARKETING: "own",  ATTORNEY: "read", LENDER: "none", TITLECO: "none" },
  documents:    { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "full", MARKETING: "own",  ATTORNEY: "full", LENDER: "read", TITLECO: "full" },
  marketing:    { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "read", MARKETING: "full", ATTORNEY: "none", LENDER: "none", TITLECO: "none" },
  reports:      { MANAGER: "team", AGENT: "own",  OFFICE_SUPPORT: "none", MARKETING: "read", ATTORNEY: "none", LENDER: "none", TITLECO: "none" },
};

// ─── Default state ───────────────────────────────────────────────────────────────
const DEFAULT_PROFILE    = { name: "", phone: "", title: "", timezone: "America/New_York", bio: "", licenseNumber: "", linkedIn: "" };
const DEFAULT_NOTIF      = { emailNewClient: true, emailAppointmentReminder: true, emailTransactionUpdate: true, emailOfferReceived: true, emailCommissionPaid: true, emailTaskOverdue: true, emailWeeklyReport: true, inAppAll: true, inAppMentions: true, smsUrgent: false, digestFrequency: "daily" };
const DEFAULT_MKT_ORG    = { aiContentEnabled: true, allowedChannels: "email,instagram,facebook", brandVoice: "Professional, sophisticated, and trustworthy.", requireManagerApproval: false, autoCloseCampaignDays: "30", defaultHashtags: "#NYCRealEstate #LuxuryHomes" };
const DEFAULT_MKT_PREF   = { emailSignature: "", defaultListingTemplate: "", preferredChannel: "email", autoScheduleEnabled: false };

// ─── Main component ──────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { t } = useI18n();
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const { isOn: isModuleOn } = useModules();
  const XLB = useExtra().labels;

  const S    = (t as any).settings   ?? {};
  const R    = (t as any).roles      ?? {};
  const Sc   = S.common              ?? {};

  // Sections that are previews only: nothing in the app reads these values yet, so
  // they render read-only and labelled "Coming soon" rather than pretending to save.
  // Remove a key from this set when its backend enforcement ships.
  // (Profile, Notifications, Org Settings, Team & Roles, Lead Routing, Security, CRM, Properties, Finance, Appointments, Documents
  // and the theme picker are real and server-backed.)
  const COMING_SOON = new Set(["access-control", "integrations", "marketing"]);
  const soonLabel = Sc.comingSoon ?? "Coming soon";
  const soonShort = Sc.comingSoonShort ?? "Soon"; // compact form for the narrow sidebar
  const soonBanner = () => (
    <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-lg bg-primary/10 border border-primary/20 text-sm text-primary">
      <span className="px-2 py-0.5 rounded-full bg-primary text-background text-xs font-semibold shrink-0">{soonLabel}</span>
      <span className="text-primary/90">{Sc.comingSoonDesc ?? "This section is a preview. These options aren't active yet and changes won't be saved or applied."}</span>
    </div>
  );
  // `inert` removes the subtree from pointer, keyboard and assistive-tech interaction
  const previewOnly = (content: React.ReactNode) => (
    <div inert aria-disabled="true" className="opacity-50 select-none pointer-events-none">{content}</div>
  );

  // Role helpers
  const userWeight = ROLE_WEIGHT[user?.role || ""] || 0;
  const canEdit    = (minRole: string) => userWeight >= (ROLE_WEIGHT[minRole] || 0);
  const isFirmAdmin = canEdit("FIRMADMIN");
  const isManager   = canEdit("MANAGER");

  // Translated role labels (fall back to key)
  const roleLabel = (role: string) => R[role] ?? role;

  // Translated perm options
  const PERM_OPTIONS: { value: PermLevel; label: string; color: string }[] = [
    { value: "full",  label: S.accessControl?.permFull  ?? "Full",  color: "text-green-500" },
    { value: "team",  label: S.accessControl?.permTeam  ?? "Team",  color: "text-blue-500" },
    { value: "own",   label: S.accessControl?.permOwn   ?? "Own",   color: "text-primary" },
    { value: "read",  label: S.accessControl?.permRead  ?? "Read",  color: "text-foreground/50" },
    { value: "none",  label: S.accessControl?.permNone  ?? "None",  color: "text-red-400" },
  ];

  // Translated module names
  const MATRIX_MODULES = [
    { key: "crm",          label: S.accessControl?.modules?.crm          ?? "CRM / Clients" },
    { key: "properties",   label: S.accessControl?.modules?.properties   ?? "Properties" },
    { key: "transactions", label: S.accessControl?.modules?.transactions ?? "Transactions" },
    { key: "finance",      label: S.accessControl?.modules?.finance      ?? "Finance" },
    { key: "appointments", label: S.accessControl?.modules?.appointments ?? "Appointments" },
    { key: "documents",    label: S.accessControl?.modules?.documents    ?? "Documents" },
    { key: "marketing",    label: S.accessControl?.modules?.marketing    ?? "Marketing" },
    { key: "reports",      label: S.accessControl?.modules?.reports      ?? "Reports" },
  ];

  // ── Nav definition (translated) ─────────────────────────────────────────────
  const NAV = [
    {
      group: S.nav?.groupAccount ?? "Account",
      items: [
        { key: "profile",       label: S.nav?.profile       ?? "Profile",       icon: "👤" },
        { key: "notifications", label: S.nav?.notifications ?? "Notifications", icon: "🔔" },
      ],
    },
    {
      group: S.nav?.groupOrganization ?? "Organization",
      items: [
        { key: "org-settings",   label: S.nav?.orgSettings   ?? "Org Settings",   icon: "🏢", adminOnly: true },
        { key: "access-control", label: S.nav?.accessControl ?? "Access Control", icon: "🛡️", adminOnly: true },
        { key: "users",          label: S.nav?.users         ?? "Team & Roles",   icon: "👥", adminOnly: true },
        { key: "modules",        label: useExtra().modules.navLabel,              icon: "🧩", adminOnly: true },
        { key: "lead-routing",   label: useExtra().leadRouting.navLabel,          icon: "🎯", adminOnly: true, module: "leadRouting" },
        { key: "website",        label: useExtra().siteSettings.title,            icon: "🌐", module: "publicSite" },
        { key: "security",       label: S.nav?.security      ?? "Security",       icon: "🔐" },
        { key: "appearance",     label: S.nav?.appearance    ?? "Appearance",     icon: "🎨" },
        { key: "integrations",   label: S.nav?.integrations  ?? "Integrations",  icon: "🔗" },
      ],
    },
    {
      group: S.nav?.groupFeatures ?? "Features",
      items: [
        { key: "crm",          label: S.nav?.crm          ?? "CRM",          icon: "🧑‍🤝‍🧑", module: "crmLeads" },
        { key: "properties",   label: S.nav?.properties   ?? "Properties",   icon: "🏠" },
        { key: "finance",      label: S.nav?.finance      ?? "Finance",      icon: "💰", module: "commissions" },
        { key: "appointments", label: S.nav?.appointments ?? "Appointments", icon: "📅", module: "appointments" },
        { key: "documents",    label: S.nav?.documents    ?? "Documents",    icon: "📄", module: "documents" },
        { key: "marketing",    label: S.nav?.marketing    ?? "Marketing",    icon: "📣", module: "marketing" },
      ],
    },
  ];

  const [activeSection, setActiveSection] = React.useState("profile");

  // ── Sub-tab state ────────────────────────────────────────────────────────────
  const [mktTab,  setMktTab]  = React.useState<"org"|"personal">("org");

  // ── Users & Lead Routing ─────────────────────────────────────────────────────
  const [users, setUsers]               = React.useState<any[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [inviteEmail, setInviteEmail]   = React.useState("");
  const [inviteRole,  setInviteRole]    = React.useState("AGENT");
  const [routingRules, setRoutingRules] = React.useState<any[]>([]);
  const [newRule, setNewRule]           = React.useState({ name: "", source: "", city: "", minPrice: "", maxPrice: "", strategy: "ROUND_ROBIN", targetAgentId: "" });
  const [simInput, setSimInput]         = React.useState({ source: "Sitio web", city: "", price: "" });
  // Inquiries from the website come in as "Sitio web" / "Puertas abiertas"; the rest are the brokerage's lead sources
  const { policies: orgPolicies } = useSettings();
  const routingSources = Array.from(new Set(["Sitio web", "Puertas abiertas", ...orgPolicies.crm.leadSources]));
  const [simResult, setSimResult]       = React.useState<any>(null);

  // ── Access matrix ────────────────────────────────────────────────────────────
  const loadMatrix = () => { try { return JSON.parse(localStorage.getItem("settings_access_matrix") || "null") || DEFAULT_ACCESS; } catch { return DEFAULT_ACCESS; } };
  const [accessMatrix, setAccessMatrix] = React.useState<Record<string, Record<string, PermLevel>>>(loadMatrix);
  const setMatrixCell = (mod: string, role: string, val: PermLevel) => setAccessMatrix((prev) => ({ ...prev, [mod]: { ...prev[mod], [role]: val } }));

  // ── Feature state ────────────────────────────────────────────────────────────
  const ls = <T,>(key: string, def: T): T => { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return def; } };
  // Profile and org details are server-backed (loaded below), not localStorage
  const [profile,     setProfile]     = React.useState(DEFAULT_PROFILE);
  const [orgSettings, setOrgSettings] = React.useState({ companyName: "", website: "", address: "", licenseNumber: "", phone: "", logoUrl: "", brandColor: "", slug: "", customDomain: "" });
  const XE = useExtra();
  const XS = XE.settings;
  const [orgPlan,     setOrgPlan]     = React.useState<{ subscription: string; seats: { limit: number | null; used: number; pendingInvites: number } } | null>(null);
  const [saving,      setSaving]      = React.useState(false);
  const [notif,       setNotif]       = React.useState(() => ls("settings_notif",         DEFAULT_NOTIF));
  const [mktOrg,      setMktOrg]      = React.useState(() => ls("settings_mkt_org",       DEFAULT_MKT_ORG));
  const [mktPersonal, setMktPersonal] = React.useState(() => ls("settings_mkt_personal",  DEFAULT_MKT_PREF));
  // Organization security policy; every field here is saved by the backend and enforced there.
  const [security,    setSecurity]    = React.useState({ sessionTimeoutMinutes: 1440, minPasswordLength: 8, requirePasswordSpecialChar: false, passwordExpiryDays: 0, logoutOnPasswordChange: true });
  const [integrations,setIntegrations]= React.useState({ stripeConnected: false, googleCalendarConnected: false, mlsConnected: false, docusignConnected: false, mailchimpConnected: false, zapierConnected: false, mapboxKey: "", openaiKey: "" });

  // ── Load team & lead routing ──────────────────────────────────────────────────
  React.useEffect(() => {
    if (activeSection !== "users" && activeSection !== "lead-routing") return;
    setUsersLoading(true);
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/settings/users`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, credentials: "include" })
      .then((r) => r.json()).then((d) => setUsers(Array.isArray(d) ? d : [])).catch(() => setUsers([])).finally(() => setUsersLoading(false));
    if (activeSection === "lead-routing") {
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/settings/lead-routing`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }, credentials: "include" })
        .then((r) => r.json()).then((d) => setRoutingRules(Array.isArray(d) ? d : [])).catch(() => setRoutingRules([]));
    }
  }, [activeSection]);

  // ── Load server-backed profile & organization ────────────────────────────────
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const authHeaders = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` });

  React.useEffect(() => {
    fetch(`${API_BASE}/api/settings/profile`, { headers: authHeaders(), credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) return;
        setProfile({
          name: p.name ?? "", title: p.title ?? "", phone: p.phone ?? "", licenseNumber: p.licenseNumber ?? "",
          linkedIn: p.linkedIn ?? "", bio: p.bio ?? "", timezone: p.timezone ?? "America/New_York",
        });
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/settings/notifications`, { headers: authHeaders(), credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((n) => {
        if (n) setNotif({ ...DEFAULT_NOTIF, ...n });
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/settings/security`, { headers: authHeaders(), credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p) setSecurity((prev) => ({ ...prev, ...p }));
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/settings/organization`, { headers: authHeaders(), credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => {
        if (!o) return;
        setOrgSettings({
          companyName: o.name ?? "", website: o.website ?? "", address: o.address ?? "",
          licenseNumber: o.licenseNumber ?? "", phone: o.phone ?? "", logoUrl: o.logoUrl ?? "",
          slug: o.slug ?? "", brandColor: o.brandColor ?? "", customDomain: o.customDomain ?? "",
        });
        setOrgPlan({ subscription: o.subscription, seats: o.seats });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/profile`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify(profile) });
      const d = await res.json();
      if (res.ok) {
        toast.success(Sc.saveChanges ?? XE.common.saved);
        // Keep the header/sidebar name in sync with the saved value
        if (user && d.name && d.name !== user.name) updateUser({ ...user, name: d.name });
      } else toast.error(d.error || XS.saveProfileFailed);
    } catch { toast.error(t.login.serverError); } finally { setSaving(false); }
  };

  const saveNotifications = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/notifications`, {
        method: "PATCH",
        headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
        credentials: "include",
        body: JSON.stringify(notif),
      });
      const d = await res.json();
      if (res.ok) {
        setNotif({ ...DEFAULT_NOTIF, ...d });
        toast.success(Sc.saveChanges ?? XE.common.saved);
      } else {
        toast.error(d.error || XE.common.error);
      }
    } catch {
      toast.error(t.login.serverError);
    } finally {
      setSaving(false);
    }
  };

  const saveSecurity = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/security`, {
        method: "PATCH",
        headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
        credentials: "include",
        body: JSON.stringify(security),
      });
      const d = await res.json();
      if (res.ok) {
        setSecurity((prev) => ({ ...prev, ...d }));
        toast.success(XS.secSaved);
      } else {
        toast.error(d.error || XS.secSaveFailed);
      }
    } catch {
      toast.error(t.login.serverError);
    } finally {
      setSaving(false);
    }
  };

  const sendPasswordResetLink = async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Protection": "1" },
        body: JSON.stringify({ email: user.email }),
      });
      if (res.ok) toast.success(XS.secResetSent);
      else toast.error(XS.secResetFailed);
    } catch {
      toast.error(t.login.serverError);
    }
  };

  const saveOrg = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/settings/organization`, {
        method: "PATCH", headers: authHeaders(),
        body: JSON.stringify({ name: orgSettings.companyName, website: orgSettings.website, address: orgSettings.address,
          phone: orgSettings.phone, licenseNumber: orgSettings.licenseNumber, logoUrl: orgSettings.logoUrl, slug: orgSettings.slug, brandColor: orgSettings.brandColor,
          customDomain: orgSettings.customDomain }),
      });
      const d = await res.json();
      if (res.ok) { if (d.slug) setOrgSettings((prev) => ({ ...prev, slug: d.slug, brandColor: d.brandColor ?? "", customDomain: d.customDomain ?? "" })); toast.success(Sc.saveChanges ?? XE.common.saved); }
      else toast.error(d.error || XS.saveOrgFailed);
    } catch { toast.error(t.login.serverError); } finally { setSaving(false); }
  };

  // Downloads a JSON export from an authenticated endpoint
  const downloadJson = async (path: string, fallbackName: string) => {
    try {
      const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || XS.exportFailed); return; }
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || fallbackName;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error(t.login.serverError); }
  };

  // ── Save helper (device-local personal preferences) ──────────────────────────
  const save = (key: string, data: any) => { localStorage.setItem(key, JSON.stringify(data)); toast.success(Sc.saveChanges ?? XE.common.saved); };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/settings/users/${userId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) { setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))); toast.success(XS.roleUpdated); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || XE.common.error); }
    } catch { toast.error(t.login.serverError); }
  };

  const handleDeactivate = async (userId: string, userName: string) => {
    if (!window.confirm(XS.deactivateConfirm.replace("{name}", userName))) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/settings/users/${userId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (res.ok) { setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive: false } : u))); toast.success(XS.userDeactivated); }
      else { const d = await res.json(); toast.error(d.error || XE.common.error); }
    } catch { toast.error(t.login.serverError); }
  };

  const handleReactivate = async (userId: string) => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/settings/users/${userId}/reactivate`, {
        method: "PATCH", headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (res.ok) { setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isActive: true } : u))); toast.success(XS.userReactivated); }
      else { const d = await res.json(); toast.error(d.error || XE.common.error); }
    } catch { toast.error(t.login.serverError); }
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/settings/invite`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (res.ok) { toast.success(XS.inviteSent.replace("{email}", inviteEmail)); setInviteEmail(""); }
      else { const d = await res.json(); toast.error(d.error || XE.common.error); }
    } catch { toast.error(t.login.serverError); }
  };

  // ── PolicyLockNotice ─────────────────────────────────────────────────────────
  const PolicyLockNotice = ({ minRole }: { minRole: string }) => (
    <div className="flex items-start gap-3 p-4 bg-amber-500/5 border border-amber-500/20 rounded-lg mb-6">
      <span className="text-lg">🔒</span>
      <div>
        <div className="text-sm font-medium text-amber-500/90">{Sc.policyLockTitle ?? "Org Policy — View Only"}</div>
        <div className="text-xs text-foreground/50 mt-0.5">
          {(Sc.policyLockDesc ?? "These settings are controlled by your firm administrator. You need {role} access or higher to change them.").replace("{role}", roleLabel(minRole))}
        </div>
      </div>
    </div>
  );

  // ── Save button ──────────────────────────────────────────────────────────────
  const SaveBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <div className="mt-6">
      <button className="px-4 py-2 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors" onClick={onClick}>{label}</button>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Section renderers
  // ─────────────────────────────────────────────────────────────────────────────

  const renderProfile = () => {
    const P = S.profile ?? {};
    return (
      <div>
        <SectionHeader title={P.title ?? "Profile"} description={P.desc ?? "Your personal information visible to teammates"} />
        <SettingRow label={P.fullName ?? "Full Name"} description={P.fullNameDesc}>
          <input className={INPUT_CLS} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="Jane Smith" />
        </SettingRow>
        <SettingRow label={P.professionalTitle ?? "Professional Title"} description={P.professionalTitleDesc}>
          <input className={INPUT_CLS} value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} placeholder="Senior Broker Associate" />
        </SettingRow>
        <SettingRow label={P.phone ?? "Phone"} description={P.phoneDesc}>
          <input className={INPUT_CLS} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} placeholder={XLB.phonePlaceholder} />
        </SettingRow>
        <SettingRow label={P.licenseNumber ?? "License Number"} description={P.licenseNumberDesc}>
          <input className={INPUT_CLS} value={profile.licenseNumber} onChange={(e) => setProfile({ ...profile, licenseNumber: e.target.value })} placeholder="10491234567" />
        </SettingRow>
        <SettingRow label={P.linkedIn ?? "LinkedIn Profile"}>
          <input className={INPUT_CLS} value={profile.linkedIn} onChange={(e) => setProfile({ ...profile, linkedIn: e.target.value })} placeholder="https://linkedin.com/in/..." />
        </SettingRow>
        <SettingRow label={P.timezone ?? "Timezone"}>
          <select className={SELECT_CLS} value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}>
            <option value="America/New_York">Eastern (ET)</option>
            <option value="America/Chicago">Central (CT)</option>
            <option value="America/Denver">Mountain (MT)</option>
            <option value="America/Los_Angeles">Pacific (PT)</option>
          </select>
        </SettingRow>
        <SettingRow label={P.bio ?? "Bio"} description={P.bioDesc}>
          <textarea className={TEXTAREA_CLS} style={{ width: 280 }} rows={3} value={profile.bio} onChange={(e) => setProfile({ ...profile, bio: e.target.value })} placeholder="NYC specialist with 10+ years..." />
        </SettingRow>
        <SaveBtn label={saving ? "…" : (P.save ?? "Save Profile")} onClick={saveProfile} />
      </div>
    );
  };

  const renderNotifications = () => {
    const N = S.notifications ?? {};
    return (
      <div>
        <SectionHeader title={N.title ?? "Notifications"} description={N.desc ?? "Choose when and how you receive alerts"} />
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-2">{N.emailAlerts ?? "Email Alerts"}</div>
          <div className="space-y-0">
            <SettingRow label={N.newClient ?? "New client assigned"} description={N.newClientDesc}><Toggle checked={notif.emailNewClient} onChange={(v) => setNotif({ ...notif, emailNewClient: v })} /></SettingRow>
            <SettingRow label={N.appointmentReminder ?? "Appointment reminder"} description={N.appointmentReminderDesc}><Toggle checked={notif.emailAppointmentReminder} onChange={(v) => setNotif({ ...notif, emailAppointmentReminder: v })} /></SettingRow>
            <SettingRow label={N.transactionUpdate ?? "Transaction status update"}><Toggle checked={notif.emailTransactionUpdate} onChange={(v) => setNotif({ ...notif, emailTransactionUpdate: v })} /></SettingRow>
            <SettingRow label={N.offerReceived ?? "Offer received on listing"}><Toggle checked={notif.emailOfferReceived} onChange={(v) => setNotif({ ...notif, emailOfferReceived: v })} /></SettingRow>
            <SettingRow label={N.commissionPaid ?? "Commission payment processed"}><Toggle checked={notif.emailCommissionPaid} onChange={(v) => setNotif({ ...notif, emailCommissionPaid: v })} /></SettingRow>
            <SettingRow label={XS.taskOverdueEmail} description={XS.taskOverdueEmailDesc}><Toggle checked={notif.emailTaskOverdue !== false} onChange={(v) => setNotif({ ...notif, emailTaskOverdue: v })} /></SettingRow>
            <SettingRow label={N.weeklyReport ?? "Weekly performance digest"}><Toggle checked={notif.emailWeeklyReport} onChange={(v) => setNotif({ ...notif, emailWeeklyReport: v })} /></SettingRow>
          </div>
        </div>
        <div className="mb-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-2">{N.inAppSms ?? "In-App & SMS"}</div>
          <div className="space-y-0">
            <SettingRow label={N.inAppAll ?? "In-app notifications (all)"}><Toggle checked={notif.inAppAll} onChange={(v) => setNotif({ ...notif, inAppAll: v })} /></SettingRow>
            <SettingRow label={N.mentions ?? "Mention & @tag alerts"}><Toggle checked={notif.inAppMentions} onChange={(v) => setNotif({ ...notif, inAppMentions: v })} /></SettingRow>
            <SettingRow label={N.smsUrgent ?? "Urgent SMS alerts"} description={N.smsUrgentDesc}><Toggle checked={notif.smsUrgent} onChange={(v) => setNotif({ ...notif, smsUrgent: v })} /></SettingRow>
          </div>
        </div>
        <SettingRow label={N.digestFrequency ?? "Digest Frequency"}>
          <select className={SELECT_CLS} value={notif.digestFrequency} onChange={(e) => setNotif({ ...notif, digestFrequency: e.target.value })}>
            <option value="realtime">{N.digestRealtime ?? "Real-time"}</option>
            <option value="daily">{N.digestDaily ?? "Daily"}</option>
            <option value="weekly">{N.digestWeekly ?? "Weekly"}</option>
            <option value="none">{N.digestOff ?? "Off"}</option>
          </select>
        </SettingRow>
        <SaveBtn label={saving ? "…" : (N.save ?? "Save Preferences")} onClick={saveNotifications} />
      </div>
    );
  };

  const renderOrgSettings = () => {
    const O = S.orgSettings ?? {};
    return (
      <div>
        <SectionHeader title={O.title ?? "Org Settings"} description={O.desc ?? "Firm-wide configuration. Changes affect all team members."} badge={Sc.firmAdminBadge} />
        {!isFirmAdmin && <PolicyLockNotice minRole="FIRMADMIN" />}
        <LockedRow label={O.companyName ?? "Company Name"} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} value={orgSettings.companyName} onChange={(e) => setOrgSettings({ ...orgSettings, companyName: e.target.value })} />
        </LockedRow>
        <LockedRow label={O.website ?? "Website"} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} value={orgSettings.website} onChange={(e) => setOrgSettings({ ...orgSettings, website: e.target.value })} />
        </LockedRow>
        <LockedRow label={O.officeAddress ?? "Office Address"} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} style={{ width: 280 }} value={orgSettings.address} onChange={(e) => setOrgSettings({ ...orgSettings, address: e.target.value })} />
        </LockedRow>
        <LockedRow label={O.officePhone ?? "Office Phone"} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} value={orgSettings.phone} onChange={(e) => setOrgSettings({ ...orgSettings, phone: e.target.value })} />
        </LockedRow>
        <LockedRow label={O.brokerageLicense ?? "NY State Brokerage License"} description={O.brokerageLicenseDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} value={orgSettings.licenseNumber} onChange={(e) => setOrgSettings({ ...orgSettings, licenseNumber: e.target.value })} />
        </LockedRow>
        <LockedRow label={O.logoUrl ?? "Logo URL"} description={O.logoUrlDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <div className="flex items-center gap-2 flex-wrap">
            {orgSettings.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={orgSettings.logoUrl} alt="Logo" className="w-8 h-8 object-contain rounded border border-border bg-surface" />
            )}
            <input className={INPUT_CLS} style={{ width: 220 }} value={orgSettings.logoUrl} onChange={(e) => setOrgSettings({ ...orgSettings, logoUrl: e.target.value })} placeholder="https://cdn.example.com/logo.png" />
            {isFirmAdmin && (
              <label className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-foreground hover:bg-background cursor-pointer transition-colors">
                {XS.uploadLogoBtn}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const uploaded = await uploadFile(file, "PUBLIC");
                      setOrgSettings((prev) => ({ ...prev, logoUrl: uploaded.url }));
                      toast.success(XS.logoUploaded);
                    } catch (err: any) {
                      toast.error(err?.message || XE.common.error);
                    } finally {
                      e.target.value = "";
                    }
                  }}
                />
              </label>
            )}
          </div>
        </LockedRow>
        <LockedRow label={XS.customSlugLabel} description={XS.customSlugHelp} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} style={{ width: 220 }} value={orgSettings.slug} onChange={(e) => setOrgSettings({ ...orgSettings, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="premier-nyc-realty" />
        </LockedRow>
        <LockedRow label={XE.domain.label} description={XE.domain.help} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <input className={INPUT_CLS} style={{ width: 240 }} value={orgSettings.customDomain} placeholder={XE.domain.placeholder}
            onChange={(e) => setOrgSettings({ ...orgSettings, customDomain: e.target.value.trim().toLowerCase() })} />
        </LockedRow>
        <LockedRow label={XS.brandColorLabel} description={XS.brandColorHelp} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
          <div className="flex items-center gap-2">
            <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(orgSettings.brandColor) ? orgSettings.brandColor : "#C5A059"} onChange={(e) => setOrgSettings({ ...orgSettings, brandColor: e.target.value })} disabled={!isFirmAdmin} className="w-8 h-8 rounded border border-border cursor-pointer bg-transparent" />
            <input className={INPUT_CLS} style={{ width: 120 }} value={orgSettings.brandColor} onChange={(e) => setOrgSettings({ ...orgSettings, brandColor: e.target.value })} placeholder="#C5A059" />
          </div>
        </LockedRow>
        {orgSettings.slug && (
          <div className="mt-6 p-4 bg-surface rounded-lg border border-border">
            <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40">{XS.publicPage}</div>
            <p className="text-xs text-foreground/50 mt-1">{XS.publicPageHelp}</p>
            <div className="flex flex-wrap items-center gap-3 mt-2">
              <a href={`/public-listings?b=${orgSettings.slug}`} target="_blank" rel="noopener noreferrer" className="text-sm text-primary break-all hover:underline">
                {typeof window !== "undefined" ? window.location.origin : ""}/public-listings?b={orgSettings.slug}
              </a>
              <button
                className="px-3 py-1 text-xs border border-border rounded-md hover:bg-background"
                onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/public-listings?b=${orgSettings.slug}`); toast.success(XE.common.copied); }}
              >
                {XE.common.copy}
              </button>
            </div>
          </div>
        )}
        <div className="mt-6 pb-6 border-b border-border">
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-4">{O.subscription ?? "Subscription"}</div>
          <div className="flex items-center justify-between p-4 bg-surface rounded-lg border border-border">
            <div>
              <div className="text-sm font-semibold text-foreground">{user?.tier || "CORE"} Plan</div>
              {orgPlan && (
                <div className="text-xs text-foreground/50 mt-0.5">
                  {orgPlan.seats.limit === null
                    ? `${orgPlan.seats.used} members · unlimited seats`
                    : `${orgPlan.seats.used} / ${orgPlan.seats.limit} seats used${orgPlan.seats.pendingInvites ? ` · ${orgPlan.seats.pendingInvites} pending invite(s)` : ""}`}
                </div>
              )}
            </div>
            <a href="/upgrade" className="px-3 py-1.5 bg-primary text-background rounded-lg text-xs font-medium hover:bg-primary/90">{O.upgrade ?? "Upgrade"}</a>
          </div>
        </div>
        {isFirmAdmin && (
          <div className="mt-6">
            <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-4">{O.dataCompliance ?? "Data & Compliance"}</div>
            <div className="flex flex-wrap gap-3">
              <button className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-foreground hover:bg-background transition-colors" onClick={() => downloadJson("/api/settings/organization/export", "org-export.json")}>{O.exportGdpr ?? "Export All Data (GDPR)"}</button>
              <button className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-foreground hover:bg-background transition-colors" onClick={() => downloadJson("/api/settings/organization/audit-log", "audit-log.json")}>{O.downloadAudit ?? "Download Audit Log"}</button>
            </div>
          </div>
        )}
        {isFirmAdmin && <SaveBtn label={saving ? "…" : (O.save ?? "Save Org Settings")} onClick={saveOrg} />}
      </div>
    );
  };

  const renderAccessControl = () => {
    const AC = S.accessControl ?? {};
    return (
      <div>
        <SectionHeader title={AC.title ?? "Access Control"} description={AC.desc ?? "Define what each role can see and do in each module."} badge={Sc.firmAdminBadge} />
        {!isFirmAdmin && <PolicyLockNotice minRole="FIRMADMIN" />}
        <div className="text-xs text-foreground/50 mb-4">
          {AC.permNote ?? "Permission levels:"}{" "}
          <strong className="text-green-500">{AC.permFull}</strong> = {AC.permFullDesc} ·{" "}
          <strong className="text-blue-500">{AC.permTeam}</strong> = {AC.permTeamDesc} ·{" "}
          <strong className="text-primary">{AC.permOwn}</strong> = {AC.permOwnDesc} ·{" "}
          <strong className="text-foreground/50">{AC.permRead}</strong> = {AC.permReadDesc} ·{" "}
          <strong className="text-red-400">{AC.permNone}</strong> = {AC.permNoneDesc}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40 w-36">{AC.moduleHeader ?? "Module"}</th>
                {MATRIX_ROLES.map((role) => (
                  <th key={role} className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">{roleLabel(role)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX_MODULES.map((mod, idx) => (
                <tr key={mod.key} className={`border-b border-border/50 ${idx % 2 === 0 ? "" : "bg-surface/40"}`}>
                  <td className="px-4 py-3 text-sm font-medium text-foreground whitespace-nowrap">{mod.label}</td>
                  {MATRIX_ROLES.map((role) => {
                    const val = accessMatrix[mod.key]?.[role] ?? "none";
                    const opt = PERM_OPTIONS.find((o) => o.value === val);
                    return (
                      <td key={role} className="px-2 py-3 text-center">
                        <select value={val} disabled={!isFirmAdmin} onChange={(e) => setMatrixCell(mod.key, role, e.target.value as PermLevel)}
                          className={`text-xs px-1.5 py-1 rounded border border-border bg-background outline-none cursor-pointer disabled:cursor-default ${opt?.color ?? ""}`}>
                          {PERM_OPTIONS.map((o) => <option key={o.value} value={o.value} className={o.color}>{o.label}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 p-3 bg-surface rounded-lg border border-border/60 text-xs text-foreground/50">
          <strong>{AC.noteTitle ?? "Note:"}</strong> {AC.noteDesc ?? "SUPERADMIN and FIRMADMIN always have full access to all modules."}
        </div>
        {isFirmAdmin && (
          <div className="mt-6 flex gap-3">
            <button className="px-4 py-2 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90"
              onClick={() => { localStorage.setItem("settings_access_matrix", JSON.stringify(accessMatrix)); toast.success(Sc.saveChanges ?? "Saved"); }}>
              {AC.saveMatrix ?? "Save Access Matrix"}
            </button>
            <button className="px-4 py-2 bg-surface border border-border rounded-lg text-sm text-foreground hover:bg-background"
              onClick={() => { setAccessMatrix(DEFAULT_ACCESS); toast.info(Sc.resetToDefaults ?? "Reset to defaults"); }}>
              {AC.resetDefaults ?? "Reset to Defaults"}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderUsers = () => {
    const U = S.users ?? {};
    return (
      <div>
        <SectionHeader title={U.title ?? "Team & Roles"} description={U.desc ?? "Manage team members, roles and access levels"} badge={isManager ? (Sc.managerBadge ?? "Manager+") : undefined} />
        {!isManager && <PolicyLockNotice minRole="MANAGER" />}
        {isManager && (
          <div className="mb-6 p-4 bg-surface border border-border rounded-lg">
            <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-3">{U.inviteTitle ?? "Invite Team Member"}</div>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-48">
                <label className="block text-xs text-foreground/50 mb-1">{U.inviteEmail ?? "Email Address"}</label>
                <input className={`${INPUT_CLS} w-full`} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@xyz.com" type="email" />
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{U.inviteRole ?? "Role"}</label>
                <select className={SELECT_CLS} value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  {Object.keys(ROLE_WEIGHT).filter((k) => k !== "SUPERADMIN" && (!isFirmAdmin ? k !== "FIRMADMIN" : true)).map((k) => (
                    <option key={k} value={k}>{roleLabel(k)}</option>
                  ))}
                </select>
              </div>
              <button className="px-4 py-1.5 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90" onClick={handleInvite}>{U.sendInvite ?? "Send Invite"}</button>
            </div>
          </div>
        )}
        {usersLoading ? (
          <div className="flex items-center gap-3 py-8 text-foreground/50 text-sm"><div className="w-4 h-4 border-2 border-border border-t-primary rounded-full animate-spin" /> {U.loadingTeam ?? "Loading team..."}</div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">{U.memberHeader ?? "Member"}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">{U.roleHeader ?? "Role"}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">{XE.leadRouting.acceptingHeader}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">{XE.leadRouting.maxLeadsHeader}</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-widest text-foreground/40">{U.actionsHeader ?? "Actions"}</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-foreground/40 text-sm">{U.noMembers ?? "No team members found."}</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id} className={`border-b border-border/40 last:border-0 hover:bg-surface/50 ${u.isActive === false ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground flex items-center gap-2">
                        {u.name}
                        {u.isActive === false && (
                          <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded text-[10px] font-semibold uppercase tracking-wider">
                            {U.inactive ?? "Inactive"}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-foreground/50">{u.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {isManager && u.id !== user?.id ? (
                        <select className={SELECT_CLS} value={u.role} onChange={(e) => handleRoleChange(u.id, e.target.value)} disabled={!canEdit("FIRMADMIN") && u.role === "FIRMADMIN"}>
                          {Object.keys(ROLE_WEIGHT).filter((k) => k !== "SUPERADMIN").map((k) => <option key={k} value={k}>{roleLabel(k)}</option>)}
                        </select>
                      ) : (
                        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">{roleLabel(u.role)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={u.acceptingLeads !== false}
                        disabled={!isManager}
                        onChange={async (val) => {
                          try {
                            const res = await fetch(`${API_BASE}/api/settings/users/${u.id}/lead-availability`, {
                              method: "PATCH",
                              headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
                              credentials: "include",
                              body: JSON.stringify({ acceptingLeads: val }),
                            });
                            if (res.ok) {
                              setUsers((prev) => prev.map((m) => (m.id === u.id ? { ...m, acceptingLeads: val } : m)));
                              toast.success(XE.leadRouting.availabilityUpdated);
                            }
                          } catch { toast.error(XE.common.error); }
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        placeholder={XE.leadRouting.unlimited}
                        disabled={!isManager}
                        className={`${INPUT_CLS} w-24`}
                        value={u.maxActiveLeads ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setUsers((prev) => prev.map((m) => (m.id === u.id ? { ...m, maxActiveLeads: val === "" ? null : Number(val) } : m)));
                        }}
                        onBlur={async (e) => {
                          const val = e.target.value === "" ? null : Number(e.target.value);
                          try {
                            await fetch(`${API_BASE}/api/settings/users/${u.id}/lead-availability`, {
                              method: "PATCH",
                              headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
                              credentials: "include",
                              body: JSON.stringify({ maxActiveLeads: val }),
                            });
                          } catch { /* ignore */ }
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {isManager && u.id !== user?.id && (
                        u.isActive === false ? (
                          <button className="text-xs text-primary hover:text-primary/80 transition-colors" onClick={() => handleReactivate(u.id)}>
                            {U.reactivate ?? "Reactivate"}
                          </button>
                        ) : (
                          <button className="text-xs text-red-400 hover:text-red-300 transition-colors" onClick={() => handleDeactivate(u.id, u.name)}>
                            {U.deactivate ?? "Deactivate"}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderSecurity = () => {
    const SC = S.security ?? {};
    const timeoutOptions: Array<[number, string]> = [
      [15, `15 ${XS.secMinutes}`], [30, `30 ${XS.secMinutes}`], [60, `60 ${XS.secMinutes}`],
      [120, `2 ${XS.secHours}`], [480, `8 ${XS.secHours}`], [1440, `24 ${XS.secHours}`],
    ];
    const soonBadge = <span className="px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs">{soonLabel}</span>;
    return (
      <div>
        <SectionHeader title={SC.title ?? "Security"} description={SC.desc ?? "Authentication and session security settings"} />
        <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-2">{SC.personal ?? "Personal Security"}</div>
        <div className="space-y-0 mb-6">
          <SettingRow label={SC.changePassword ?? "Change Password"}>
            <button className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs text-foreground hover:bg-background" onClick={sendPasswordResetLink}>{SC.sendResetLink ?? "Send Reset Link"}</button>
          </SettingRow>
          <SettingRow label={SC.twoFA ?? "Two-Factor Authentication"} description={XS.secNotYet}>{soonBadge}</SettingRow>
          <SettingRow label={SC.loginAlerts ?? "Login Alerts"} description={XS.secNotYet}>{soonBadge}</SettingRow>
        </div>
        <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40 mb-1">{SC.orgPolicy ?? "Org Security Policy"}</div>
        <div className="text-xs text-foreground/50 mb-2">{XS.secRulesNote}</div>
        <div className="space-y-0 mb-6">
          <LockedRow label={SC.sessionTimeout ?? "Session Timeout"} description={XS.secSessionDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <select className={SELECT_CLS} value={security.sessionTimeoutMinutes} onChange={(e) => setSecurity({ ...security, sessionTimeoutMinutes: Number(e.target.value) })}>
              {timeoutOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </LockedRow>
          <LockedRow label={SC.minPasswordLength ?? "Minimum Password Length"} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <select className={SELECT_CLS} value={security.minPasswordLength} onChange={(e) => setSecurity({ ...security, minPasswordLength: Number(e.target.value) })}>
              {[8, 10, 12, 14, 16].map((n) => <option key={n} value={n}>{n} {SC.characters ?? "characters"}</option>)}
            </select>
          </LockedRow>
          <LockedRow label={SC.requireSpecialChar ?? "Require Special Character"} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <Toggle checked={security.requirePasswordSpecialChar} onChange={(v) => setSecurity({ ...security, requirePasswordSpecialChar: v })} disabled={!isFirmAdmin} />
          </LockedRow>
          <LockedRow label={SC.passwordExpiry ?? "Password Expiry (days)"} description={XS.secExpiryDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <select className={SELECT_CLS} value={security.passwordExpiryDays} onChange={(e) => setSecurity({ ...security, passwordExpiryDays: Number(e.target.value) })}>
              <option value={0}>{XS.secNever}</option>
              {[30, 60, 90, 180, 365].map((n) => <option key={n} value={n}>{n} {XS.secDays}</option>)}
            </select>
          </LockedRow>
          <LockedRow label={SC.forceLogout ?? "Force Logout on Password Change"} description={XS.secForceLogoutDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <Toggle checked={security.logoutOnPasswordChange} onChange={(v) => setSecurity({ ...security, logoutOnPasswordChange: v })} disabled={!isFirmAdmin} />
          </LockedRow>
          <LockedRow label={SC.ipWhitelist ?? "IP Whitelist"} description={XS.secNotYet} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            {soonBadge}
          </LockedRow>
        </div>
        {isFirmAdmin && <SaveBtn label={saving ? "…" : (SC.save ?? "Save Security Settings")} onClick={saveSecurity} />}
      </div>
    );
  };

  const renderAppearance = () => {
    const AP = S.appearance ?? {};
    return (
      <div>
        <SectionHeader title={AP.title ?? "Appearance"} description={AP.desc ?? "Customize how the platform looks for you"} />
        <SettingRow label={AP.theme ?? "Theme"} description={AP.themeDesc}>
          <div className="flex gap-2 flex-wrap">
            {(["luxury","modern","youth","chinese","cyberpunk"] as ThemeName[]).map((th) => (
              <button key={th} onClick={() => setTheme(th)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${theme === th ? "bg-primary text-background border-primary" : "bg-surface border-border text-foreground/60 hover:border-primary/50"}`}>
                {(AP.themeNames as any)?.[th] ?? th}
              </button>
            ))}
          </div>
        </SettingRow>
        {/* Only the theme picker above is wired up; the rest are not connected to anything yet */}
        <div className="mt-6">
          {soonBanner()}
          {previewOnly(
            <>
              <SettingRow label={AP.sidebarPosition ?? "Sidebar Position"} description={AP.sidebarPositionDesc}>
                <select className={SELECT_CLS}>
                  <option>{AP.sidebarLeft ?? "Left (default)"}</option>
                  <option>{AP.sidebarCollapsed ?? "Collapsed"}</option>
                </select>
              </SettingRow>
              <SettingRow label={AP.density ?? "Density"} description={AP.densityDesc}>
                <select className={SELECT_CLS}>
                  <option value="comfortable">{AP.densityComfortable ?? "Comfortable"}</option>
                  <option value="compact">{AP.densityCompact ?? "Compact"}</option>
                  <option value="spacious">{AP.densitySpacious ?? "Spacious"}</option>
                </select>
              </SettingRow>
              <SettingRow label={AP.dateFormat ?? "Date Format"}>
                <select className={SELECT_CLS}>
                  <option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY (EU)</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option>
                </select>
              </SettingRow>
              <SettingRow label={AP.numberFormat ?? "Number Format"}>
                <select className={SELECT_CLS}>
                  <option value="1,234,567">1,234,567 (US)</option>
                  <option value="1.234.567">1.234.567 (EU)</option>
                </select>
              </SettingRow>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderIntegrations = () => {
    const I = S.integrations ?? {};
    const apps = I.apps ?? {};
    const appList = [
      { key: "stripeConnected",          ...apps.stripe         ?? { label: "Stripe Payments",   desc: "Accept commission splits" },         icon: "💳", adminOnly: true },
      { key: "googleCalendarConnected",  ...apps.googleCalendar ?? { label: "Google Calendar",   desc: "Sync appointments bi-directionally" }, icon: "📆", adminOnly: false },
      { key: "mlsConnected",             ...apps.mls            ?? { label: "NYC MLS / RLS",     desc: "Auto-import listings from MLS" },     icon: "🏙️", adminOnly: true },
      { key: "docusignConnected",        ...apps.docusign       ?? { label: "DocuSign",           desc: "Send contracts for e-signature" },    icon: "✍️", adminOnly: false },
      { key: "mailchimpConnected",       ...apps.mailchimp      ?? { label: "Mailchimp",           desc: "Sync contacts and run campaigns" },  icon: "✉️", adminOnly: false },
      { key: "zapierConnected",          ...apps.zapier         ?? { label: "Zapier",              desc: "Automate workflows with 5000+ apps" },icon: "⚡", adminOnly: false },
    ];
    return (
      <div>
        <SectionHeader title={I.title ?? "Integrations"} description={I.desc ?? "Connect third-party services and APIs"} />
        {appList.map(({ key, label, desc, icon, adminOnly }) => {
          const connected = integrations[key as keyof typeof integrations] as boolean;
          const editable = !adminOnly || isFirmAdmin;
          return (
            <div key={key} className="flex items-center justify-between py-4 border-b border-border/40 last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xl w-8 text-center">{icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    {adminOnly && !isFirmAdmin && <span className={LOCKED_BADGE}>🔒 {Sc.firmAdminOnly ?? "Firm Admin+"}</span>}
                    {connected && <span className="px-1.5 py-0.5 bg-green-500/10 border border-green-500/20 rounded text-xs text-green-500">{Sc.connected ?? "Connected"}</span>}
                  </div>
                  <div className="text-xs text-foreground/50">{desc}</div>
                </div>
              </div>
              <button disabled={!editable}
                onClick={() => { if (!editable) return; setIntegrations({ ...integrations, [key]: !connected }); toast.info(connected ? `${label} disconnected` : `${label} connection flow coming soon`); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${connected ? "bg-surface border-border text-foreground/60 hover:border-red-400 hover:text-red-400" : "bg-primary/10 border-primary/30 text-primary hover:bg-primary hover:text-background"} ${!editable ? "opacity-40 cursor-not-allowed" : ""}`}>
                {connected ? (Sc.disconnect ?? "Disconnect") : (Sc.connect ?? "Connect")}
              </button>
            </div>
          );
        })}
        <div className="mt-6 space-y-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40">{I.apiKeys ?? "API Keys"}</div>
          <LockedRow label={I.mapboxKey ?? "Mapbox Public Token"} description={I.mapboxKeyDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <input className={INPUT_CLS} style={{ width: 260 }} type="password" value={integrations.mapboxKey} onChange={(e) => setIntegrations({ ...integrations, mapboxKey: e.target.value })} placeholder="pk.eyJ1..." />
          </LockedRow>
          <LockedRow label={I.openaiKey ?? "OpenAI API Key"} description={I.openaiKeyDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
            <input className={INPUT_CLS} style={{ width: 260 }} type="password" value={integrations.openaiKey} onChange={(e) => setIntegrations({ ...integrations, openaiKey: e.target.value })} placeholder="sk-..." />
          </LockedRow>
        </div>
      </div>
    );
  };






  const renderMarketing = () => {
    const M = S.marketing ?? {};
    const tabs = [{ key: "org", label: Sc.orgPolicy ?? "Org Policy", locked: !isManager }, { key: "personal", label: Sc.myPreferences ?? "My Preferences" }];
    return (
      <div>
        <SectionHeader title={M.title ?? "Marketing"} description={M.desc ?? "Campaign management, AI content, and brand guidelines"} />
        <SubTabs tabs={tabs} active={mktTab} onChange={(k) => setMktTab(k as any)} />
        {mktTab === "org" && (
          <div>
            {!isManager && <PolicyLockNotice minRole="MANAGER" />}
            <LockedRow label={M.aiContent ?? "AI Content Generation"} description={M.aiContentDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
              <Toggle checked={mktOrg.aiContentEnabled} onChange={(v) => setMktOrg({ ...mktOrg, aiContentEnabled: v })} disabled={!isFirmAdmin} />
            </LockedRow>
            <LockedRow label={M.allowedChannels ?? "Allowed Channels"} description={M.allowedChannelsDesc} minRoleLabel={roleLabel("MANAGER")} canEdit={isManager}>
              <input className={INPUT_CLS} style={{ width: 280 }} value={mktOrg.allowedChannels} onChange={(e) => setMktOrg({ ...mktOrg, allowedChannels: e.target.value })} />
            </LockedRow>
            <LockedRow label={M.brandVoice ?? "Brand Voice Guidelines"} description={M.brandVoiceDesc} minRoleLabel={roleLabel("MANAGER")} canEdit={isManager}>
              <textarea className={TEXTAREA_CLS} style={{ width: 320 }} rows={3} value={mktOrg.brandVoice} onChange={(e) => setMktOrg({ ...mktOrg, brandVoice: e.target.value })} />
            </LockedRow>
            <LockedRow label={M.requireApproval ?? "Require Manager Approval"} description={M.requireApprovalDesc} minRoleLabel={roleLabel("FIRMADMIN")} canEdit={isFirmAdmin}>
              <Toggle checked={mktOrg.requireManagerApproval} onChange={(v) => setMktOrg({ ...mktOrg, requireManagerApproval: v })} disabled={!isFirmAdmin} />
            </LockedRow>
            <LockedRow label={M.defaultHashtags ?? "Default Hashtags"} description={M.defaultHashtagsDesc} minRoleLabel={roleLabel("MANAGER")} canEdit={isManager}>
              <input className={INPUT_CLS} style={{ width: 280 }} value={mktOrg.defaultHashtags} onChange={(e) => setMktOrg({ ...mktOrg, defaultHashtags: e.target.value })} />
            </LockedRow>
            <LockedRow label={M.autoClose ?? "Auto-Close Campaigns After (days)"} description={M.autoCloseDesc} minRoleLabel={roleLabel("MANAGER")} canEdit={isManager}>
              <input className={INPUT_CLS} style={{ width: 80 }} type="number" value={mktOrg.autoCloseCampaignDays} onChange={(e) => setMktOrg({ ...mktOrg, autoCloseCampaignDays: e.target.value })} />
            </LockedRow>
            {isManager && <SaveBtn label={Sc.saveOrgPolicy ?? "Save Org Policy"} onClick={() => save("settings_mkt_org", mktOrg)} />}
          </div>
        )}
        {mktTab === "personal" && (
          <div>
            <SettingRow label={M.emailSignature ?? "Email Signature"} description={M.emailSignatureDesc}>
              <textarea className={TEXTAREA_CLS} style={{ width: 300 }} rows={4} value={mktPersonal.emailSignature} onChange={(e) => setMktPersonal({ ...mktPersonal, emailSignature: e.target.value })} placeholder="Jane Smith | Senior Broker | +1 (212) 555-0101" />
            </SettingRow>
            <SettingRow label={M.defaultTemplate ?? "Default Listing Template"}>
              <select className={SELECT_CLS} value={mktPersonal.defaultListingTemplate} onChange={(e) => setMktPersonal({ ...mktPersonal, defaultListingTemplate: e.target.value })}>
                <option value="">{M.templateNone ?? "None (blank)"}</option>
                <option value="luxury">{M.templateLuxury ?? "Luxury Residential"}</option>
                <option value="commercial">{M.templateCommercial ?? "Commercial"}</option>
                <option value="rental">{M.templateRental ?? "Rental"}</option>
                <option value="newdev">{M.templateNewDev ?? "New Development"}</option>
              </select>
            </SettingRow>
            <SettingRow label={M.preferredChannel ?? "Preferred Channel"}>
              <select className={SELECT_CLS} value={mktPersonal.preferredChannel} onChange={(e) => setMktPersonal({ ...mktPersonal, preferredChannel: e.target.value })}>
                <option value="email">Email</option><option value="instagram">Instagram</option>
                <option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option><option value="twitter">Twitter / X</option>
              </select>
            </SettingRow>
            <SettingRow label={M.autoSchedule ?? "Auto-Schedule Posts"} description={M.autoScheduleDesc}><Toggle checked={mktPersonal.autoScheduleEnabled} onChange={(v) => setMktPersonal({ ...mktPersonal, autoScheduleEnabled: v })} /></SettingRow>
            <SaveBtn label={Sc.saveMyPreferences ?? "Save My Preferences"} onClick={() => save("settings_mkt_personal", mktPersonal)} />
          </div>
        )}
      </div>
    );
  };

  const renderLeadRouting = () => {
    const LR = XE.leadRouting;
    const strategyLabel = (st: string) => {
      if (st === "ROUND_ROBIN") return LR.strategyRoundRobin;
      if (st === "LEAST_LOADED") return LR.strategyLeastLoaded;
      if (st === "LISTING_AGENT") return LR.strategyListingAgent;
      if (st === "SPECIFIC_AGENT") return LR.strategySpecificAgent;
      return st;
    };

    const handleAddRule = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newRule.name.trim()) return;
      try {
        const res = await fetch(`${API_BASE}/api/settings/lead-routing`, {
          method: "POST",
          headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
          credentials: "include",
          body: JSON.stringify({
            name: newRule.name.trim(),
            source: newRule.source || null,
            city: newRule.city.trim() || null,
            minPrice: newRule.minPrice !== "" ? Number(newRule.minPrice) : null,
            maxPrice: newRule.maxPrice !== "" ? Number(newRule.maxPrice) : null,
            strategy: newRule.strategy,
            targetAgentId: newRule.strategy === "SPECIFIC_AGENT" ? newRule.targetAgentId : null,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setRoutingRules((prev) => [...prev, data]);
          setNewRule({ name: "", source: "", city: "", minPrice: "", maxPrice: "", strategy: "ROUND_ROBIN", targetAgentId: "" });
          toast.success(LR.ruleCreated);
        } else {
          toast.error(data.error || XE.common.error);
        }
      } catch {
        toast.error(XE.common.error);
      }
    };

    const handleToggleRule = async (ruleId: string, enabled: boolean) => {
      try {
        const res = await fetch(`${API_BASE}/api/settings/lead-routing/${ruleId}`, {
          method: "PATCH",
          headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
          credentials: "include",
          body: JSON.stringify({ enabled }),
        });
        if (res.ok) {
          setRoutingRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, enabled } : r)));
        }
      } catch { /* ignore */ }
    };

    const handleDeleteRule = async (ruleId: string) => {
      if (!window.confirm(XE.common.confirmDelete)) return;
      try {
        const res = await fetch(`${API_BASE}/api/settings/lead-routing/${ruleId}`, {
          method: "DELETE",
          headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
          credentials: "include",
        });
        if (res.ok) {
          setRoutingRules((prev) => prev.filter((r) => r.id !== ruleId));
          toast.success(LR.ruleDeleted);
        }
      } catch {
        toast.error(XE.common.error);
      }
    };

    const handleSimulate = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/settings/lead-routing/test`, {
          method: "POST",
          headers: { ...authHeaders(), "X-CSRF-Protection": "1" },
          credentials: "include",
          body: JSON.stringify({
            source: simInput.source || null,
            city: simInput.city.trim() || null,
            price: simInput.price !== "" ? Number(simInput.price) : null,
          }),
        });
        if (res.ok) {
          setSimResult(await res.json());
        }
      } catch {
        toast.error(XE.common.error);
      }
    };

    return (
      <div className="space-y-8">
        <SectionHeader title={LR.title} description={LR.desc} badge={isManager ? (Sc.managerBadge ?? "Manager+") : undefined} />
        {!isManager && <PolicyLockNotice minRole="MANAGER" />}

        {/* Existing Rules List */}
        <div className="space-y-3">
          {routingRules.length === 0 ? (
            <div className="p-6 border border-dashed border-border rounded-lg text-center text-sm text-foreground/50 bg-surface/40">
              {LR.noRules}
            </div>
          ) : (
            routingRules.map((rule, idx) => {
              const targetName = users.find((u) => u.id === rule.targetAgentId)?.name;
              return (
                <div key={rule.id} className="p-4 border border-border rounded-lg bg-surface flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-bold">#{idx + 1}</span>
                      <span className="text-sm font-semibold text-foreground">{rule.name}</span>
                      <span className="px-2 py-0.5 bg-background border border-border rounded text-xs text-foreground/70">
                        {strategyLabel(rule.strategy)}
                        {rule.strategy === "SPECIFIC_AGENT" && targetName ? `: ${targetName}` : ""}
                      </span>
                    </div>
                    <div className="text-xs text-foreground/50 flex flex-wrap gap-3">
                      <span>{LR.sourceLabel}: <strong>{rule.source || LR.anySource}</strong></span>
                      {rule.city && <span>{LR.cityLabel}: <strong>{rule.city}</strong></span>}
                      {(rule.minPrice !== null || rule.maxPrice !== null) && (
                        <span>
                          ${rule.minPrice?.toLocaleString(fmtLocale()) || "0"} – {rule.maxPrice ? `$${rule.maxPrice.toLocaleString(fmtLocale())}` : "∞"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Toggle checked={rule.enabled !== false} disabled={!isManager} onChange={(v) => handleToggleRule(rule.id, v)} />
                    {isManager && (
                      <button type="button" onClick={() => handleDeleteRule(rule.id)} className="text-xs text-red-400 hover:text-red-300">
                        {XE.common.delete}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Create Rule Form */}
        {isManager && (
          <form onSubmit={handleAddRule} className="p-5 bg-surface border border-border rounded-lg space-y-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40">{LR.addRuleTitle}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.ruleName}</label>
                <input required className={`${INPUT_CLS} w-full`} value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} placeholder={LR.ruleNamePlaceholder} />
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.sourceLabel}</label>
                <select className={`${SELECT_CLS} w-full`} value={newRule.source} onChange={(e) => setNewRule({ ...newRule, source: e.target.value })}>
                  <option value="">{LR.anySource}</option>
                  {routingSources.map((src) => <option key={src} value={src}>{src}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.cityLabel}</label>
                <input className={`${INPUT_CLS} w-full`} value={newRule.city} onChange={(e) => setNewRule({ ...newRule, city: e.target.value })} placeholder={LR.cityPlaceholder} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-foreground/50 mb-1">{LR.minPriceLabel}</label>
                  <input type="number" min="0" className={`${INPUT_CLS} w-full`} value={newRule.minPrice} onChange={(e) => setNewRule({ ...newRule, minPrice: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <label className="block text-xs text-foreground/50 mb-1">{LR.maxPriceLabel}</label>
                  <input type="number" min="0" className={`${INPUT_CLS} w-full`} value={newRule.maxPrice} onChange={(e) => setNewRule({ ...newRule, maxPrice: e.target.value })} placeholder="∞" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.strategyLabel}</label>
                <select className={`${SELECT_CLS} w-full`} value={newRule.strategy} onChange={(e) => setNewRule({ ...newRule, strategy: e.target.value })}>
                  <option value="ROUND_ROBIN">{LR.strategyRoundRobin}</option>
                  <option value="LEAST_LOADED">{LR.strategyLeastLoaded}</option>
                  <option value="LISTING_AGENT">{LR.strategyListingAgent}</option>
                  <option value="SPECIFIC_AGENT">{LR.strategySpecificAgent}</option>
                </select>
              </div>
              {newRule.strategy === "SPECIFIC_AGENT" && (
                <div>
                  <label className="block text-xs text-foreground/50 mb-1">{LR.targetAgentLabel}</label>
                  <select required className={`${SELECT_CLS} w-full`} value={newRule.targetAgentId} onChange={(e) => setNewRule({ ...newRule, targetAgentId: e.target.value })}>
                    <option value="">—</option>
                    {users.filter((u) => u.isActive !== false).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <button type="submit" className="px-4 py-2 bg-primary text-background rounded-lg text-sm font-medium hover:bg-primary/90">
              {LR.addRuleBtn}
            </button>
          </form>
        )}

        {/* Dry-run Routing Simulator */}
        {isManager && (
          <div className="p-5 bg-surface/60 border border-border rounded-lg space-y-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest text-foreground/40">{LR.simulatorTitle}</div>
              <p className="text-xs text-foreground/50 mt-1">{LR.simulatorDesc}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.sourceLabel}</label>
                <select className={`${SELECT_CLS} w-full`} value={simInput.source} onChange={(e) => setSimInput({ ...simInput, source: e.target.value })}>
                  {routingSources.map((src) => <option key={src} value={src}>{src}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.cityLabel}</label>
                <input className={`${INPUT_CLS} w-full`} value={simInput.city} onChange={(e) => setSimInput({ ...simInput, city: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-foreground/50 mb-1">{LR.priceLabel}</label>
                <input type="number" className={`${INPUT_CLS} w-full`} value={simInput.price} onChange={(e) => setSimInput({ ...simInput, price: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button type="button" onClick={handleSimulate} className="px-4 py-1.5 bg-background border border-primary text-primary rounded-lg text-xs font-semibold hover:bg-primary hover:text-background transition-colors">
                {LR.runTestBtn}
              </button>
              {simResult && (
                <div className="text-xs text-foreground">
                  {LR.simResultPrefix} <strong className="text-primary">{simResult.agentName}</strong> ·{" "}
                  {LR.simRuleMatched} <strong>{simResult.matchedRuleName || LR.simDefaultFallback}</strong>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Section router ────────────────────────────────────────────────────────────
  const renderSectionContent = () => {
    switch (activeSection) {
      case "profile":        return renderProfile();
      case "notifications":  return renderNotifications();
      case "org-settings":   return renderOrgSettings();
      case "access-control": return renderAccessControl();
      case "users":          return renderUsers();
      case "modules":        return <ModulesSettings />;
      case "lead-routing":   return renderLeadRouting();
      case "website":        return <WebsiteSettings />;
      case "security":       return renderSecurity();
      case "appearance":     return renderAppearance();
      case "integrations":   return renderIntegrations();
      case "crm":            return <CrmSettings />;
      case "properties":     return <PropertiesSettings />;
      case "finance":        return <FinanceSettings />;
      case "appointments":   return <AppointmentsSettings />;
      case "documents":      return <DocumentsSettings />;
      case "marketing":      return renderMarketing();
      default:               return null;
    }
  };

  const renderSection = () => {
    const content = renderSectionContent();
    if (!COMING_SOON.has(activeSection)) return content;
    return (
      <div>
        {soonBanner()}
        {previewOnly(content)}
      </div>
    );
  };

  // ── Layout ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-surface overflow-y-auto flex flex-col gap-1 py-4 px-2">
        {NAV.map((group) => {
          const visibleItems = group.items.filter((item: any) => (!(item as any).adminOnly || isManager) && (!item.module || isModuleOn(item.module as ModuleKey)));
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.group} className="mb-4">
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-widest text-foreground/30 mb-1">{group.group}</div>
              {visibleItems.map((item: any) => (
                <button key={item.key} onClick={() => setActiveSection(item.key)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    activeSection === item.key ? "bg-primary/10 text-primary font-medium" : "text-foreground/60 hover:text-foreground hover:bg-background"
                  }`}>
                  <span className="text-base">{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                  {COMING_SOON.has(item.key) && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-foreground/10 text-[10px] leading-none font-medium text-foreground/50" title={soonLabel}>{soonShort}</span>
                  )}
                  {(item as any).adminOnly && !isFirmAdmin && !COMING_SOON.has(item.key) && <span className="text-xs text-foreground/30">🔒</span>}
                </button>
              ))}
            </div>
          );
        })}
        {/* Signed-in user */}
        <div className="mt-auto px-3 pt-4 border-t border-border">
          <div className="text-xs text-foreground/40 mb-1">{S.signedInAs ?? "Signed in as"}</div>
          <div className="text-xs font-medium text-foreground truncate">{user?.name || user?.email}</div>
          <div className="mt-1 inline-flex items-center px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-xs text-primary font-medium">
            {roleLabel(user?.role || "")}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8 max-w-3xl">
        {renderSection()}
      </main>
    </div>
  );
}
