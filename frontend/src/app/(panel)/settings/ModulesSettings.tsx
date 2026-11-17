"use client";

import React from "react";
import { useExtra, fmt } from "@/lib/i18n/extra";
import { useToast } from "@/components/ui/Toast";
import { useModules, ModuleKey, ModuleState } from "@/lib/modules";
import { Toggle, SectionHeader } from "./ui";

/**
 * Settings > Modules: one switch per module, saved right away (PUT /api/settings/modules).
 * The switch shows what the brokerage chose (its override, or the platform default); a module can still be
 * off because a module it needs is off, which the row explains.
 */
export default function ModulesSettings() {
  const XE = useExtra();
  const X = XE.modules;
  const toast = useToast();
  const { modules, loaded, save } = useModules();
  const [busy, setBusy] = React.useState<ModuleKey | null>(null);

  const name = (k: ModuleKey) => (X.names as Record<string, string>)[k] ?? k;
  const list = (keys: ModuleKey[]) => keys.map(name).join(", ");

  const change = async (key: ModuleKey, value: boolean | null) => {
    setBusy(key);
    try {
      await save({ [key]: value });
      toast.success(X.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : XE.common.error);
    } finally {
      setBusy(null);
    }
  };

  const status = (m: ModuleState) => {
    if (m.source === "forced_off") return X.forcedOff;
    if (m.superadminOnly && !m.canEdit) return X.superadminOnly;
    if (m.override !== null) return X.customized;
    return fmt(X.usingDefault, { state: m.installationDefault ? X.on : X.off });
  };

  const anyEditable = modules.some(m => m.canEdit);

  return (
    <div>
      <SectionHeader title={X.title} description={X.desc} />
      {loaded && !anyEditable && <p className="text-xs text-foreground/50 mb-4">{X.readOnly}</p>}
      {!loaded && <p className="text-sm text-foreground/50">{XE.common.loading}</p>}
      <div>
        {modules.map((m) => {
          const chosen = m.override ?? m.installationDefault;
          return (
            <div key={m.key} className="flex items-start justify-between gap-6 py-4 border-b border-border/40 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{name(m.key)}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${m.enabled ? "bg-primary/10 text-primary" : "bg-foreground/10 text-foreground/50"}`}>
                    {m.enabled ? X.on : X.off}
                  </span>
                </div>
                <div className="text-xs text-foreground/50 mt-0.5">{(X.descs as Record<string, string>)[m.key]}</div>
                <div className="text-xs text-foreground/40 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{status(m)}</span>
                  {m.requires.length > 0 && <span>{fmt(X.requires, { list: list(m.requires) })}</span>}
                  {m.blockedBy.length > 0 && <span className="text-amber-500/80">{fmt(X.blockedBy, { list: list(m.blockedBy) })}</span>}
                  {m.canEdit && m.override !== null && (
                    <button type="button" className="underline hover:text-foreground" disabled={busy === m.key} onClick={() => change(m.key, null)}>
                      {X.resetDefault}
                    </button>
                  )}
                </div>
              </div>
              <div className="shrink-0 pt-0.5">
                <Toggle checked={m.source === "forced_off" ? false : chosen} disabled={!m.canEdit || busy === m.key} onChange={(v) => change(m.key, v)} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
