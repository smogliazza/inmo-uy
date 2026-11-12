"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { AI_ASSISTANT_ENABLED } from "@/lib/features";

/**
 * Module system, frontend side. Types mirror backend/src/lib/modules.ts; the API is the source of truth
 * (GET /api/settings/modules resolves env + brokerage overrides + dependencies).
 *
 * While the first response has not arrived, modules count as ON so that nothing flickers out of the menu
 * for brokerages using the defaults; route guards wait for `loaded` before showing a 404.
 */

export const MODULE_KEYS = [
  "publicSite", "publicMap", "crmLeads", "leadRouting", "tasks", "appointments", "documents", "rentals",
  "deals", "commissions", "marketing", "referrals", "gifts", "aiAssistant", "billing", "googleOAuth", "migrator",
] as const;

export type ModuleKey = typeof MODULE_KEYS[number];

export interface ModuleState {
  key: ModuleKey;
  label: string;
  enabled: boolean;
  source: "forced_off" | "organization" | "installation" | "default";
  override: boolean | null;
  requires: ModuleKey[];
  blockedBy: ModuleKey[];
  superadminOnly: boolean;
  installationDefault: boolean;
  canEdit: boolean;
}

/**
 * Panel routes that belong to a module (first match wins). A route not listed here is always available.
 * `any: true` means the page is available when at least one of its modules is on (default: all of them).
 */
export const ROUTE_MODULES: { prefix: string; modules: ModuleKey[]; any?: boolean }[] = [
  { prefix: "/crm",          modules: ["crmLeads"] },
  { prefix: "/pipeline",     modules: ["deals"] },
  { prefix: "/transactions", modules: ["deals"] },
  { prefix: "/reports",      modules: ["deals"] },
  { prefix: "/finance",      modules: ["commissions"] },
  { prefix: "/appointments", modules: ["appointments"] },
  { prefix: "/tasks",        modules: ["tasks"] },
  { prefix: "/documents",    modules: ["documents"] },
  { prefix: "/marketing",    modules: ["marketing"] },
  { prefix: "/upgrade",      modules: ["billing"] },
  { prefix: "/services",     modules: ["gifts", "referrals"], any: true },
];

/** Whether a panel route is available, given which modules are on. */
export function routeAvailable(pathname: string, isOn: (k: ModuleKey) => boolean): boolean {
  const hit = ROUTE_MODULES.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  if (!hit) return true;
  return hit.any ? hit.modules.some(isOn) : hit.modules.every(isOn);
}

// ─── Shared store (same pattern as useSettings) ─────────────────────────────────

interface Snapshot { modules: ModuleState[]; byKey: Partial<Record<ModuleKey, ModuleState>>; loaded: boolean }

const EMPTY: Snapshot = { modules: [], byKey: {}, loaded: false };
let snapshot: Snapshot = EMPTY;
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const STALE_MS = 30 * 1000;

const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snapshot;

function setModules(list: ModuleState[]) {
  snapshot = { modules: list, byKey: Object.fromEntries(list.map(m => [m.key, m])), loaded: true };
  fetchedAt = Date.now();
  emit();
}

async function load(force = false): Promise<void> {
  if (!force && snapshot.loaded && Date.now() - fetchedAt < STALE_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await api("/api/settings/modules");
      setModules(r.modules || []);
    } catch {
      // Not signed in, or the API is unreachable: keep what we have
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget everything (sign-in / sign-out), so one brokerage's modules never show for another. */
export function resetModulesCache() {
  snapshot = EMPTY;
  fetchedAt = 0;
  inflight = null;
  emit();
}

export function useModules() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  useEffect(() => { void load(); }, []);

  /** True when the module is on (or while the first response is still loading). */
  const isOn = useCallback((key: ModuleKey) => {
    const m = state.byKey[key];
    return m ? m.enabled : !state.loaded;
  }, [state]);

  /** Saves overrides: true / false, or null to go back to the installation default. */
  const save = useCallback(async (changes: Partial<Record<ModuleKey, boolean | null>>) => {
    const r = await api("/api/settings/modules", { method: "PUT", body: { modules: changes } });
    setModules(r.modules || []);
    return r.modules as ModuleState[];
  }, []);

  const reload = useCallback(() => load(true), []);

  return { modules: state.modules, loaded: state.loaded, isOn, save, reload };
}

/**
 * The AI assistant needs both the legacy build-time switch (NEXT_PUBLIC_AI_ASSISTANT_ENABLED, kept for
 * compatibility) and the aiAssistant module on for the brokerage. Stays false until the modules load.
 */
export function useAiAssistantEnabled(): boolean {
  const { isOn, loaded } = useModules();
  return AI_ASSISTANT_ENABLED && loaded && isOn("aiAssistant");
}

/**
 * Installation-level modules (no brokerage known yet), for public pages such as login and signup.
 * GET /api/modules/installation; null until it answers.
 */
export function useInstallationModules(): Partial<Record<ModuleKey, boolean>> | null {
  const [mods, setMods] = useState<Partial<Record<ModuleKey, boolean>> | null>(null);
  useEffect(() => {
    let alive = true;
    api("/api/modules/installation", { auth: false })
      .then((r) => { if (alive) setMods(r.modules || {}); })
      .catch(() => { if (alive) setMods({}); });
    return () => { alive = false; };
  }, []);
  return mods;
}
