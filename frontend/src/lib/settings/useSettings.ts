"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { PROPERTY_TYPES_UY, AMENITIES_UY } from "@/lib/catalogs";

/**
 * Brokerage policies and personal preferences, as served by the API.
 *
 * The API is the source of truth (it validates and enforces every value). The defaults below only
 * cover the moment before the first response arrives; they match the server defaults, which
 * reproduce how the app behaved before these settings existed.
 */

export interface OrgPolicies {
  crm: {
    requiredFields: string[];
    maxClientsPerAgent: number;
    clientVisibility: "own" | "all";
    duplicateCheck: boolean;
    leadSources: string[];
  };
  properties: {
    whoCanCreate: "ALL_STAFF" | "MANAGERS";
    requiredFields: string[];
    photosRequiredToActivate: number;
    maxPhotosPerListing: number;
    descriptionMaxChars: number;
    propertyTypes: string[];
    amenities: string[];
    /** Show New York deal concepts (board package, MLS #, StreetEasy/Zillow). Off in Uruguay. */
    usStyleDeal: boolean;
  };
  finance: { showAgentGross: boolean; fiscalYearStartMonth: number };
  appointments: { workdayStart: string; workdayEnd: string; showWeekends: boolean; preventDoubleBooking: boolean; bufferMinutes: number };
  documents: { allowedFormats: string[]; maxFileSizeMb: number };
}

export interface UserPreferences {
  crm: { defaultClientType: string; defaultFunnelStage: string; showBudget: boolean; compactList: boolean };
  properties: { defaultStatus: string };
  finance: { showLeaderboard: boolean; showIncomeOnDashboard: boolean };
  appointments: { defaultDurationMin: number; reminderLeadHours: number; autoConfirm: boolean };
}

export const DEFAULT_LEAD_SOURCES = [
  "Sitio web", "WhatsApp", "InfoCasas", "Mercado Libre", "Gallito", "Instagram", "Facebook", "Cartel", "Referido", "Oficina",
];

export const DEFAULT_POLICIES: OrgPolicies = {
  crm: { requiredFields: [], maxClientsPerAgent: 0, clientVisibility: "own", duplicateCheck: true, leadSources: DEFAULT_LEAD_SOURCES },
  properties: {
    whoCanCreate: "ALL_STAFF", requiredFields: [], photosRequiredToActivate: 0, maxPhotosPerListing: 0, descriptionMaxChars: 0,
    propertyTypes: [...PROPERTY_TYPES_UY], amenities: [...AMENITIES_UY], usStyleDeal: false,
  },
  finance: { showAgentGross: true, fiscalYearStartMonth: 1 },
  appointments: { workdayStart: "09:00", workdayEnd: "18:00", showWeekends: true, preventDoubleBooking: false, bufferMinutes: 0 },
  documents: { allowedFormats: ["pdf", "word", "image"], maxFileSizeMb: 20 },
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  crm: { defaultClientType: "BUYER", defaultFunnelStage: "LEAD", showBudget: true, compactList: false },
  properties: { defaultStatus: "ACTIVE" },
  finance: { showLeaderboard: true, showIncomeOnDashboard: true },
  appointments: { defaultDurationMin: 60, reminderLeadHours: 24, autoConfirm: false },
};

// ─── A tiny shared store, so every page sees the same values and a save shows up everywhere at once ───

interface Snapshot { policies: OrgPolicies; preferences: UserPreferences; loaded: boolean }

let snapshot: Snapshot = { policies: DEFAULT_POLICIES, preferences: DEFAULT_PREFERENCES, loaded: false };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const STALE_MS = 30 * 1000;

const emit = () => listeners.forEach(l => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => snapshot;

async function load(force = false): Promise<void> {
  if (!force && snapshot.loaded && Date.now() - fetchedAt < STALE_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [p, u] = await Promise.all([api("/api/settings/policies"), api("/api/settings/preferences")]);
      snapshot = { policies: p.policies, preferences: u.preferences, loaded: true };
      fetchedAt = Date.now();
      emit();
    } catch {
      // Not signed in, or the API is unreachable: keep whatever we have (the defaults)
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Forget everything (called when someone signs in or out, so one person's settings never show for another). */
export function resetSettingsCache() {
  snapshot = { policies: DEFAULT_POLICIES, preferences: DEFAULT_PREFERENCES, loaded: false };
  fetchedAt = 0;
  inflight = null;
  emit();
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

export function useSettings() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { void load(); }, []);

  /** Saves part of the brokerage policies (firm admins only). Throws ApiError with the server's message. */
  const savePolicies = useCallback(async (patch: DeepPartial<OrgPolicies>) => {
    const r = await api("/api/settings/policies", { method: "PATCH", body: patch });
    snapshot = { ...snapshot, policies: r.policies, loaded: true };
    fetchedAt = Date.now();
    emit();
    return r.policies as OrgPolicies;
  }, []);

  /** Saves part of the signed-in person's preferences. */
  const savePreferences = useCallback(async (patch: DeepPartial<UserPreferences>) => {
    const r = await api("/api/settings/preferences", { method: "PATCH", body: patch });
    snapshot = { ...snapshot, preferences: r.preferences, loaded: true };
    fetchedAt = Date.now();
    emit();
    return r.preferences as UserPreferences;
  }, []);

  const reload = useCallback(() => load(true), []);

  return { policies: state.policies, preferences: state.preferences, loaded: state.loaded, savePolicies, savePreferences, reload };
}
