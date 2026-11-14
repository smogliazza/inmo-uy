"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useExtra } from "@/lib/i18n/extra";
import { useAuth } from "@/lib/auth/AuthContext";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useSettings, OrgPolicies } from "@/lib/settings/useSettings";
import { INPUT_CLS, SELECT_CLS, TEXTAREA_CLS, Toggle, SectionHeader, SettingRow, SubTabs } from "./ui";
import { PROPERTY_TYPES_UY, PROPERTY_TYPES_LEGACY, AMENITIES_UY } from "@/lib/catalogs";

/**
 * Settings > CRM, Properties, Finance, Appointments and Documents.
 *
 * Every option on these screens is saved by the API and enforced there (see backend/src/lib/policies.ts).
 * "Brokerage rules" are shared by the whole brokerage and only a firm admin can change them;
 * "My preferences" belong to the signed-in person.
 */

const ADMIN_ROLES = ["SUPERADMIN", "FIRMADMIN"];

// ─── Building blocks ────────────────────────────────────────────────────────────

/** Keeps edits in a draft until Save. Re-mount it (with a new `key`) whenever the saved values change. */
function DraftForm<T extends object>({ initial, canEdit, saveLabel, onSave, children }: {
  initial: T;
  canEdit: boolean;
  saveLabel: string;
  onSave: (draft: T) => Promise<void>;
  children: (draft: T, set: (patch: Partial<T>) => void) => React.ReactNode;
}) {
  const XE = useExtra();
  const X = XE.policy;
  const toast = useToast();
  const [draft, setDraft] = React.useState<T>(initial);
  const [saving, setSaving] = React.useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = (patch: Partial<T>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success(X.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : XE.common.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {children(draft, set)}
      {canEdit && (
        <div className="pt-5">
          <button
            type="button"
            onClick={submit}
            disabled={!dirty || saving}
            className="px-5 py-2 bg-primary text-background rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? X.saving : saveLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function CheckList({ options, labels, value, onChange, disabled }: {
  options: string[]; labels: Record<string, string>; value: string[]; onChange: (v: string[]) => void; disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 justify-end max-w-sm">
      {options.map((o) => (
        <label key={o} className={`flex items-center gap-1.5 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
          <input
            type="checkbox"
            className="accent-primary"
            disabled={disabled}
            checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))}
          />
          {labels[o] ?? o}
        </label>
      ))}
    </div>
  );
}

function NumberInput({ value, onChange, width = 90, min, max, disabled }: {
  value: string; onChange: (v: string) => void; width?: number; min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <input className={INPUT_CLS} style={{ width }} type="number" inputMode="numeric" min={min} max={max} disabled={disabled}
      value={value} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Brokerage rules / My preferences tabs, with the "firm admin only" notice on the first one. */
function PolicyFrame({ title, description, orgTab, mineTab, hasMine = true }: {
  title: string; description: string;
  orgTab: (canEdit: boolean) => React.ReactNode;
  mineTab?: React.ReactNode;
  hasMine?: boolean;
}) {
  const X = useExtra().policy;
  const { user } = useAuth();
  const { loaded } = useSettings();
  const canEdit = ADMIN_ROLES.includes(user?.role || "");
  const [tab, setTab] = React.useState<"org" | "mine">("org");
  return (
    <div>
      <SectionHeader title={title} description={description} />
      {hasMine && (
        <SubTabs
          tabs={[{ key: "org", label: X.tabOrg, locked: !canEdit }, { key: "mine", label: X.tabMine }]}
          active={tab}
          onChange={(k) => setTab(k as "org" | "mine")}
        />
      )}
      {!loaded && <p className="text-sm text-foreground/50 pb-3">…</p>}
      {(tab === "org" || !hasMine) ? (
        <div>
          <p className="text-xs text-foreground/50 mb-2">{canEdit ? X.applyNow : X.adminOnly}</p>
          {orgTab(canEdit)}
        </div>
      ) : mineTab}
    </div>
  );
}

const str = (n: number) => String(n);
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));

// ─── CRM ─────────────────────────────────────────────────────────────────────────

export function CrmSettings() {
  const X = useExtra().policy;
  const C = X.crm;
  const { policies, preferences, savePolicies, savePreferences } = useSettings();
  const p = policies.crm, u = preferences.crm;

  return (
    <PolicyFrame
      title={C.title}
      description={C.description}
      orgTab={(canEdit) => (
        <DraftForm
          key={JSON.stringify(p)}
          initial={{ requiredFields: p.requiredFields, maxClients: str(p.maxClientsPerAgent), visibility: p.clientVisibility, duplicateCheck: p.duplicateCheck, sources: p.leadSources.join("\n") }}
          canEdit={canEdit}
          saveLabel={X.save}
          onSave={async (d) => {
            await savePolicies({ crm: {
              requiredFields: d.requiredFields,
              maxClientsPerAgent: num(d.maxClients),
              clientVisibility: d.visibility as "own" | "all",
              duplicateCheck: d.duplicateCheck,
              leadSources: d.sources.split("\n").map((s) => s.trim()).filter(Boolean),
            } });
          }}
        >
          {(d, set) => (
            <>
              <SettingRow label={C.requiredFields} description={C.requiredFieldsDesc}>
                <CheckList options={["phone", "email", "budget", "source"]} labels={C.field} value={d.requiredFields} onChange={(v) => set({ requiredFields: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={C.maxClients} description={`${C.maxClientsDesc} (${X.noLimit})`}>
                <NumberInput value={d.maxClients} onChange={(v) => set({ maxClients: v })} min={0} max={10000} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={C.visibility} description={C.visibilityDesc}>
                <select className={SELECT_CLS} value={d.visibility} disabled={!canEdit} onChange={(e) => set({ visibility: e.target.value as "own" | "all" })}>
                  <option value="own">{C.visibilityOwn}</option>
                  <option value="all">{C.visibilityAll}</option>
                </select>
              </SettingRow>
              <SettingRow label={C.duplicateCheck} description={C.duplicateCheckDesc}>
                <Toggle checked={d.duplicateCheck} onChange={(v) => set({ duplicateCheck: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={C.leadSources} description={C.leadSourcesDesc}>
                <textarea className={TEXTAREA_CLS} style={{ width: 240 }} rows={5} disabled={!canEdit} value={d.sources} onChange={(e) => set({ sources: e.target.value })} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
      mineTab={(
        <DraftForm
          key={JSON.stringify(u)}
          initial={u}
          canEdit
          saveLabel={X.saveMine}
          onSave={async (d) => { await savePreferences({ crm: d }); }}
        >
          {(d, set) => (
            <>
              <SettingRow label={C.defaultType}>
                <select className={SELECT_CLS} value={d.defaultClientType} onChange={(e) => set({ defaultClientType: e.target.value })}>
                  {Object.entries(C.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </SettingRow>
              <SettingRow label={C.defaultStage}>
                <select className={SELECT_CLS} value={d.defaultFunnelStage} onChange={(e) => set({ defaultFunnelStage: e.target.value })}>
                  {Object.entries(C.stages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </SettingRow>
              <SettingRow label={C.showBudget} description={C.showBudgetDesc}>
                <Toggle checked={d.showBudget} onChange={(v) => set({ showBudget: v })} />
              </SettingRow>
              <SettingRow label={C.compactList} description={C.compactListDesc}>
                <Toggle checked={d.compactList} onChange={(v) => set({ compactList: v })} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
    />
  );
}

// ─── Properties ──────────────────────────────────────────────────────────────────

export function PropertiesSettings() {
  const XE = useExtra();
  const X = XE.policy;
  const P = X.properties;
  const U = XE.policyUy;
  const { policies, preferences, savePolicies, savePreferences } = useSettings();
  const p = policies.properties, u = preferences.properties;

  return (
    <PolicyFrame
      title={P.title}
      description={P.description}
      orgTab={(canEdit) => (
        <DraftForm
          key={JSON.stringify(p)}
          initial={{ whoCanCreate: p.whoCanCreate, requiredFields: p.requiredFields, photosRequired: str(p.photosRequiredToActivate), maxPhotos: str(p.maxPhotosPerListing), descMax: str(p.descriptionMaxChars),
            propertyTypes: p.propertyTypes, amenities: p.amenities, usStyleDeal: p.usStyleDeal }}
          canEdit={canEdit}
          saveLabel={X.save}
          onSave={async (d) => {
            await savePolicies({ properties: {
              whoCanCreate: d.whoCanCreate as OrgPolicies["properties"]["whoCanCreate"],
              requiredFields: d.requiredFields,
              photosRequiredToActivate: num(d.photosRequired),
              maxPhotosPerListing: num(d.maxPhotos),
              descriptionMaxChars: num(d.descMax),
              propertyTypes: d.propertyTypes,
              amenities: d.amenities,
              usStyleDeal: d.usStyleDeal,
            } });
          }}
        >
          {(d, set) => (
            <>
              <SettingRow label={P.whoCanCreate} description={P.whoCanCreateDesc}>
                <select className={SELECT_CLS} value={d.whoCanCreate} disabled={!canEdit} onChange={(e) => set({ whoCanCreate: e.target.value as "ALL_STAFF" | "MANAGERS" })}>
                  <option value="ALL_STAFF">{P.creatorAll}</option>
                  <option value="MANAGERS">{P.creatorManagers}</option>
                </select>
              </SettingRow>
              <SettingRow label={P.requiredFields} description={P.requiredFieldsDesc}>
                {/* The type is always required now; the New York fields only show with the New York setting */}
                <CheckList
                  options={["beds", "baths", "builtAreaM2", "landArea", "locality", "state", "code", "padron", "description", "yearBuilt", ...(d.usStyleDeal ? ["sqft", "neighborhood"] : [])]}
                  labels={{ ...P.field, ...U.field }} value={d.requiredFields} onChange={(v) => set({ requiredFields: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={U.propertyTypes} description={U.propertyTypesDesc}>
                <CheckList options={[...PROPERTY_TYPES_UY, ...(d.usStyleDeal ? PROPERTY_TYPES_LEGACY : PROPERTY_TYPES_LEGACY.filter(tp => d.propertyTypes.includes(tp)))]}
                  labels={XE.catalog.propertyTypes} value={d.propertyTypes} onChange={(v) => set({ propertyTypes: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={U.amenities} description={U.amenitiesDesc}>
                <CheckList options={[...AMENITIES_UY, ...d.amenities.filter(a => !(AMENITIES_UY as readonly string[]).includes(a))]}
                  labels={XE.catalog.amenities} value={d.amenities} onChange={(v) => set({ amenities: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={U.usStyleDeal} description={U.usStyleDealDesc}>
                <Toggle checked={d.usStyleDeal} onChange={(v) => set({ usStyleDeal: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={P.photosRequired} description={`${P.photosRequiredDesc} (${X.noLimit})`}>
                <NumberInput value={d.photosRequired} onChange={(v) => set({ photosRequired: v })} min={0} max={30} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={P.maxPhotos} description={`${P.maxPhotosDesc} (${X.noLimit})`}>
                <NumberInput value={d.maxPhotos} onChange={(v) => set({ maxPhotos: v })} min={0} max={200} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={P.descMax} description={`${P.descMaxDesc} (${X.noLimit})`}>
                <NumberInput value={d.descMax} onChange={(v) => set({ descMax: v })} width={110} min={0} max={10000} disabled={!canEdit} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
      mineTab={(
        <DraftForm
          key={JSON.stringify(u)}
          initial={u}
          canEdit
          saveLabel={X.saveMine}
          onSave={async (d) => { await savePreferences({ properties: d }); }}
        >
          {(d, set) => (
            <SettingRow label={P.defaultStatus} description={P.defaultStatusDesc}>
              <select className={SELECT_CLS} value={d.defaultStatus} onChange={(e) => set({ defaultStatus: e.target.value })}>
                <option value="ACTIVE">{P.statusActive}</option>
                <option value="COMING_SOON">{P.statusComingSoon}</option>
              </select>
            </SettingRow>
          )}
        </DraftForm>
      )}
    />
  );
}

// ─── Finance ─────────────────────────────────────────────────────────────────────

export function FinanceSettings() {
  const X = useExtra().policy;
  const F = X.finance;
  const { language } = useI18n();
  const { policies, preferences, savePolicies, savePreferences } = useSettings();
  const p = policies.finance, u = preferences.finance;

  // Commission defaults live on the organization record (also used when a deal closes)
  const [commission, setCommission] = React.useState<{ rate: number; split: number } | null>(null);
  const loadCommission = React.useCallback(() => {
    api("/api/settings/organization")
      .then((o) => setCommission({ rate: o.defaultCommissionRate, split: o.defaultFirmSplit }))
      .catch(() => {});
  }, []);
  React.useEffect(() => { loadCommission(); }, [loadCommission]);

  const monthName = (m: number) => new Intl.DateTimeFormat(language, { month: "long" }).format(new Date(2000, m - 1, 1));

  return (
    <PolicyFrame
      title={F.title}
      description={F.description}
      orgTab={(canEdit) => commission === null ? <p className="text-sm text-foreground/50">…</p> : (
        <DraftForm
          key={JSON.stringify([p, commission])}
          initial={{ rate: String(commission.rate), split: String(commission.split), month: str(p.fiscalYearStartMonth), showGross: p.showAgentGross }}
          canEdit={canEdit}
          saveLabel={X.save}
          onSave={async (d) => {
            const rate = Number(d.rate), split = Number(d.split);
            if (rate !== commission.rate || split !== commission.split) {
              await api("/api/settings/organization", { method: "PATCH", body: { defaultCommissionRate: rate, defaultFirmSplit: split } });
              setCommission({ rate, split });
            }
            await savePolicies({ finance: { fiscalYearStartMonth: Number(d.month), showAgentGross: d.showGross } });
          }}
        >
          {(d, set) => (
            <>
              <SettingRow label={F.commissionRate} description={F.commissionRateDesc}>
                <NumberInput value={d.rate} onChange={(v) => set({ rate: v })} min={0} max={100} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={F.firmSplit} description={F.firmSplitDesc}>
                <NumberInput value={d.split} onChange={(v) => set({ split: v })} min={0} max={100} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={F.fiscalYear} description={F.fiscalYearDesc}>
                <select className={SELECT_CLS} value={d.month} disabled={!canEdit} onChange={(e) => set({ month: e.target.value })}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
                </select>
              </SettingRow>
              <SettingRow label={F.showGross} description={F.showGrossDesc}>
                <Toggle checked={d.showGross} onChange={(v) => set({ showGross: v })} disabled={!canEdit} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
      mineTab={(
        <DraftForm
          key={JSON.stringify(u)}
          initial={u}
          canEdit
          saveLabel={X.saveMine}
          onSave={async (d) => { await savePreferences({ finance: d }); }}
        >
          {(d, set) => (
            <>
              <SettingRow label={F.showLeaderboard} description={F.showLeaderboardDesc}>
                <Toggle checked={d.showLeaderboard} onChange={(v) => set({ showLeaderboard: v })} />
              </SettingRow>
              <SettingRow label={F.showIncome} description={F.showIncomeDesc}>
                <Toggle checked={d.showIncomeOnDashboard} onChange={(v) => set({ showIncomeOnDashboard: v })} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
    />
  );
}

// ─── Appointments ────────────────────────────────────────────────────────────────

const BUFFERS = [0, 10, 15, 30, 60];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const LEADS = [1, 2, 4, 12, 24];

export function AppointmentsSettings() {
  const X = useExtra().policy;
  const A = X.appointments;
  const { policies, preferences, savePolicies, savePreferences } = useSettings();
  const p = policies.appointments, u = preferences.appointments;
  const fill = (tpl: string, n: number) => tpl.replace("{n}", String(n));

  return (
    <PolicyFrame
      title={A.title}
      description={A.description}
      orgTab={(canEdit) => (
        <DraftForm
          key={JSON.stringify(p)}
          initial={{ start: p.workdayStart, end: p.workdayEnd, weekends: p.showWeekends, prevent: p.preventDoubleBooking, buffer: str(p.bufferMinutes) }}
          canEdit={canEdit}
          saveLabel={X.save}
          onSave={async (d) => {
            await savePolicies({ appointments: {
              workdayStart: d.start, workdayEnd: d.end, showWeekends: d.weekends,
              preventDoubleBooking: d.prevent, bufferMinutes: Number(d.buffer),
            } });
          }}
        >
          {(d, set) => (
            <>
              <SettingRow label={A.workday} description={A.workdayDesc}>
                <div className="flex items-center gap-2">
                  <input className={INPUT_CLS} type="time" value={d.start} disabled={!canEdit} onChange={(e) => set({ start: e.target.value })} />
                  <span className="text-foreground/40">–</span>
                  <input className={INPUT_CLS} type="time" value={d.end} disabled={!canEdit} onChange={(e) => set({ end: e.target.value })} />
                </div>
              </SettingRow>
              <SettingRow label={A.showWeekends} description={A.showWeekendsDesc}>
                <Toggle checked={d.weekends} onChange={(v) => set({ weekends: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={A.preventDouble} description={A.preventDoubleDesc}>
                <Toggle checked={d.prevent} onChange={(v) => set({ prevent: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={A.buffer} description={A.bufferDesc}>
                <select className={SELECT_CLS} value={d.buffer} disabled={!canEdit || !d.prevent} onChange={(e) => set({ buffer: e.target.value })}>
                  {BUFFERS.map((m) => <option key={m} value={m}>{m === 0 ? A.none : fill(A.minutes, m)}</option>)}
                </select>
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
      mineTab={(
        <DraftForm
          key={JSON.stringify(u)}
          initial={{ duration: str(u.defaultDurationMin), lead: str(u.reminderLeadHours), autoConfirm: u.autoConfirm }}
          canEdit
          saveLabel={X.saveMine}
          onSave={async (d) => {
            await savePreferences({ appointments: { defaultDurationMin: Number(d.duration), reminderLeadHours: Number(d.lead), autoConfirm: d.autoConfirm } });
          }}
        >
          {(d, set) => (
            <>
              <SettingRow label={A.defaultDuration} description={A.defaultDurationDesc}>
                <select className={SELECT_CLS} value={d.duration} onChange={(e) => set({ duration: e.target.value })}>
                  {DURATIONS.map((m) => <option key={m} value={m}>{fill(A.minutes, m)}</option>)}
                </select>
              </SettingRow>
              <SettingRow label={A.reminderLead} description={A.reminderLeadDesc}>
                <select className={SELECT_CLS} value={d.lead} onChange={(e) => set({ lead: e.target.value })}>
                  {LEADS.map((h) => <option key={h} value={h}>{fill(A.hoursBefore, h)}</option>)}
                </select>
              </SettingRow>
              <SettingRow label={A.autoConfirm} description={A.autoConfirmDesc}>
                <Toggle checked={d.autoConfirm} onChange={(v) => set({ autoConfirm: v })} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
    />
  );
}

// ─── Documents ───────────────────────────────────────────────────────────────────

export function DocumentsSettings() {
  const X = useExtra().policy;
  const D = X.documents;
  const { policies, savePolicies } = useSettings();
  const p = policies.documents;

  return (
    <PolicyFrame
      title={D.title}
      description={D.description}
      hasMine={false}
      orgTab={(canEdit) => (
        <DraftForm
          key={JSON.stringify(p)}
          initial={{ formats: p.allowedFormats, maxSize: str(p.maxFileSizeMb) }}
          canEdit={canEdit}
          saveLabel={X.save}
          onSave={async (d) => {
            await savePolicies({ documents: { allowedFormats: d.formats as OrgPolicies["documents"]["allowedFormats"], maxFileSizeMb: Number(d.maxSize) } });
          }}
        >
          {(d, set) => (
            <>
              <SettingRow label={D.formats} description={D.formatsDesc}>
                <CheckList options={["pdf", "word", "image"]} labels={D.format} value={d.formats} onChange={(v) => set({ formats: v })} disabled={!canEdit} />
              </SettingRow>
              <SettingRow label={D.maxSize} description={D.maxSizeDesc}>
                <NumberInput value={d.maxSize} onChange={(v) => set({ maxSize: v })} min={1} max={20} disabled={!canEdit} />
              </SettingRow>
            </>
          )}
        </DraftForm>
      )}
    />
  );
}
