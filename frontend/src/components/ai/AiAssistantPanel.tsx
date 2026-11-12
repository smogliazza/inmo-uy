"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useExtra, fmt, aiLanguage } from "@/lib/i18n/extra";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { useAiAssistantEnabled } from "@/lib/modules";

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  minTier: string;
  uses: ("property" | "client")[];
  inputLabel?: string;
  unlocked: boolean;
}

const INPUT = "w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:border-primary outline-none";

/** Runs the backend's real-estate AI skills against the agent's own listings and clients. */
export default function AiAssistantPanel({ onSaved }: { onSaved?: () => void }) {
  const { language } = useI18n();
  const X = useExtra();
  const toast = useToast();
  const AI_ON = useAiAssistantEnabled();

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [configured, setConfigured] = useState(true);
  const enabled = AI_ON;
  const [skillId, setSkillId] = useState("listing_description");
  const [properties, setProperties] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [clientId, setClientId] = useState("");
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    // Nothing to load while the assistant (or its module) is off: those endpoints answer 404 module_disabled.
    if (!AI_ON) return;
    api("/api/marketing/skills").then((d) => { setSkills(d.skills || []); setConfigured(!!d.configured); }).catch(() => {});
    api("/api/properties?limit=100").then((d) => setProperties(d.data || [])).catch(() => {});
    api("/api/clients?limit=100").then((d) => setClients(d.data || [])).catch(() => {});
    // Deep link from a client page: /marketing?skill=follow_up&clientId=…
    const params = new URLSearchParams(window.location.search);
    if (params.get("skill")) setSkillId(params.get("skill")!);
    if (params.get("clientId")) setClientId(params.get("clientId")!);
    if (params.get("propertyId")) setPropertyId(params.get("propertyId")!);
  }, [AI_ON]);

  const skill = skills.find((s) => s.id === skillId);

  const run = async () => {
    if (!skill) return;
    setRunning(true);
    setResult("");
    try {
      const d = await api("/api/marketing/assist", {
        method: "POST",
        body: {
          skill: skill.id,
          input,
          propertyId: skill.uses.includes("property") ? propertyId || undefined : undefined,
          clientId: skill.uses.includes("client") ? clientId || undefined : undefined,
          language: aiLanguage(language),
        },
      });
      setResult(d.generatedContent);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    try {
      await api("/api/marketing-tasks", { method: "POST", body: { title: `AI: ${skill?.name}`, content: result, status: "COMPLETED" } });
      toast.success(X.common.saved);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : X.common.error);
    }
  };

  return (
    <div className="bg-background border border-border rounded-xl p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          ✨ {X.ai.title}
          {!enabled && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">{X.ai.inDevelopment}</span>
          )}
        </h2>
        <p className="text-sm text-foreground/50 mt-1">{enabled ? X.ai.subtitle : X.ai.inDevelopmentNote}</p>
      </div>
      {enabled && !configured && (
        <div className="text-sm rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-2">{X.ai.notConfigured}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {skills.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => enabled && setSkillId(s.id)}
            disabled={!enabled}
            title={s.description}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
              enabled && skillId === s.id ? "border-primary bg-primary/10 text-primary" : "border-border" + (enabled ? " hover:border-foreground/30" : " cursor-default")
            } ${enabled && s.unlocked ? "" : "opacity-60"}`}
          >
            <div className="font-semibold">{s.name}</div>
            <div className="text-xs text-foreground/50 mt-0.5 line-clamp-2">
              {!enabled || s.unlocked ? s.description : `🔒 ${fmt(X.ai.locked, { tier: s.minTier })}`}
            </div>
          </button>
        ))}
      </div>

      {enabled && skill && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {skill.uses.includes("property") && (
            <div>
              <label className="block text-xs font-semibold text-foreground/60 mb-1">{X.ai.property} ({X.common.optional})</label>
              <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className={INPUT}>
                <option value="">{X.common.none}</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.address}, {p.city}</option>)}
              </select>
            </div>
          )}
          {skill.uses.includes("client") && (
            <div>
              <label className="block text-xs font-semibold text-foreground/60 mb-1">{X.ai.client} ({X.common.optional})</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={INPUT}>
                <option value="">{X.common.none}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
          )}
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-foreground/60 mb-1">{skill.inputLabel || X.ai.input}</label>
            <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} className={`${INPUT} resize-none`} />
          </div>
        </div>
      )}

      {enabled && <button
        onClick={run}
        disabled={running || !skill || !skill.unlocked || !configured}
        className="px-4 py-2 bg-primary text-background hover:opacity-90 transition-opacity rounded-lg text-sm font-semibold shadow-sm disabled:opacity-50"
      >
        {running ? X.ai.running : X.ai.run}
      </button>}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground/60">{X.ai.result}</span>
            <div className="flex gap-3 text-xs">
              <button onClick={() => { navigator.clipboard.writeText(result); toast.success(X.common.copied); }} className="text-primary hover:underline">{X.common.copy}</button>
              <button onClick={save} className="text-primary hover:underline">{X.ai.saveToLibrary}</button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm bg-surface/50 border border-border rounded-lg p-4 text-foreground/90">{result}</pre>
        </div>
      )}
    </div>
  );
}
