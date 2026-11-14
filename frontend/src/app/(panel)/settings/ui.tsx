"use client";

import React from "react";

// Building blocks shared by the Settings page and its policy sections.

// ─── CSS constants ──────────────────────────────────────────────────────────────
export const INPUT_CLS =
  "px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none transition-colors";
export const SELECT_CLS =
  "px-3 py-1.5 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none cursor-pointer";
export const TEXTAREA_CLS =
  "px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none resize-none transition-colors w-full";
export const LOCKED_BADGE =
  "inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-500/80 shrink-0";

// ─── Reusable inline components ─────────────────────────────────────────────────
export function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)} disabled={disabled}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? "bg-primary" : "bg-border"} ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-background rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

export function SectionHeader({ title, description, badge }: { title: string; description: string; badge?: string }) {
  return (
    <div className="mb-6 pb-4 border-b border-border">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {badge && <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-xs text-primary font-medium">{badge}</span>}
      </div>
      <p className="text-sm text-foreground/50 mt-1">{description}</p>
    </div>
  );
}

export function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 border-b border-border/40 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-foreground/50 mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function LockedRow({ label, description, minRoleLabel, canEdit, children }: {
  label: string; description?: string; minRoleLabel: string; canEdit: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`flex items-start justify-between gap-6 py-4 border-b border-border/40 last:border-0 ${!canEdit ? "opacity-75" : ""}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {!canEdit && <span className={LOCKED_BADGE}>🔒 {minRoleLabel}+</span>}
        </div>
        {description && <div className="text-xs text-foreground/50 mt-0.5">{description}</div>}
      </div>
      <div className={`shrink-0 ${!canEdit ? "pointer-events-none opacity-50" : ""}`}>{children}</div>
    </div>
  );
}

export function SubTabs({ tabs, active, onChange }: {
  tabs: { key: string; label: string; locked?: boolean }[]; active: string; onChange: (k: string) => void;
}) {
  return (
    <div className="flex mb-6 border-b border-border">
      {tabs.map((tab) => (
        <button key={tab.key} onClick={() => onChange(tab.key)}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
            active === tab.key ? "border-primary text-primary" : "border-transparent text-foreground/50 hover:text-foreground"
          }`}>
          {tab.label}
          {tab.locked && <span className="text-amber-500/70">🔒</span>}
        </button>
      ))}
    </div>
  );
}
