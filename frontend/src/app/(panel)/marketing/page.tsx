"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/I18nContext";
import { useAuth } from "@/lib/auth/AuthContext";
import AiAssistantPanel from "@/components/ai/AiAssistantPanel";
import { aiLanguage, useExtra } from "@/lib/i18n/extra";
import { useAiAssistantEnabled } from "@/lib/modules";
import { fmtLocale } from "@/lib/format";

interface MarketingTask {
  id: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
}

export default function MarketingPage() {
  const { t, language } = useI18n();
  const X = useExtra();
  const AI_ON = useAiAssistantEnabled();

  const [audience, setAudience] = useState("Luxury & Elegant");
  const [features, setFeatures] = useState("");
  const [generating, setGenerating] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [fullContent, setFullContent] = useState("");
  const [displayedContent, setDisplayedContent] = useState("");
  const [contentType, setContentType] = useState("LISTING");
  const [tone, setTone] = useState("professional");
  const [tasks, setTasks] = useState<MarketingTask[]>([]);
  const { user } = useAuth();

  const isCore = user?.tier === "CORE";
  const isPro = user?.tier === "PRO";
  const isElite = user?.tier === "ELITE";
  
  const canSocialEmail = !isCore;
  const canTone = isElite;

  const fetchTasks = async () => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/marketing-tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (error) {
      console.error("Failed to fetch tasks", error);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // Typewriter effect
  useEffect(() => {
    if (!isStreaming || !fullContent) return;

    let currentIndex = 0;
    const speed = 15; // ms per character - fast but visible

    const interval = setInterval(() => {
      if (currentIndex <= fullContent.length) {
        setDisplayedContent(fullContent.slice(0, currentIndex));
        currentIndex++;
      } else {
        clearInterval(interval);
        setIsStreaming(false);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [fullContent, isStreaming]);

  const handleGenerate = async () => {
    setGenerating(true);
    setDisplayedContent("");
    setFullContent("");
    setIsStreaming(false);
    const token = localStorage.getItem("token");
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/marketing/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 
          audience,
          features,
          language: aiLanguage(language),
          type: contentType,
          tone: canTone ? tone : undefined
        }),
      });
      
      if (res.status === 403) {
        const errorData = await res.json();
        setDisplayedContent(errorData.error);
        setFullContent(errorData.error);
        setGenerating(false);
        return;
      }
      
      if (!res.ok) throw new Error("API Error");
      const data = await res.json();

      setFullContent(data.generatedContent);
      setIsStreaming(true);

      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/marketing-tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: `AI ${contentType} - ${audience}`,
          content: data.generatedContent,
          status: "COMPLETED",
        }),
      });
      fetchTasks();
    } catch (error) {
      console.error("Failed to generate content", error);
      setDisplayedContent(t.marketing.failedGenerate);
      setFullContent(t.marketing.failedGenerate);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out text-foreground">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 pb-6 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t.marketing.title}
          </h1>
          <p className="text-foreground/50 mt-1 text-sm">
            {t.marketing.subtitle}
          </p>
        </div>
      </div>

      <AiAssistantPanel onSaved={fetchTasks} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* AI Content Generator (Span 5 for asymmetric look) */}
        <div className="lg:col-span-5 bg-surface border border-border p-8 flex flex-col">
          <h2 className="font-serif text-2xl font-light text-foreground mb-8 flex items-center gap-3">
            <span className="text-primary font-sans text-base tracking-widest uppercase">
              Copilot
            </span>{" "}
            {t.marketing.copilot}
            {!AI_ON && (
              <span className="text-xs font-sans font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">{X.ai.inDevelopment}</span>
            )}
          </h2>

          <div className="space-y-8 flex-1">
            <div>
              <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-3">
                {t.marketing.selectProperty}
              </label>
              <select className="w-full px-4 py-3 bg-background border border-border rounded-none text-base text-foreground focus:border-primary outline-none transition-colors appearance-none cursor-pointer">
                <option>—</option>
              </select>
            </div>

            <div>
              <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-3">
                {t.marketing.contentType}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "LISTING", label: t.marketing.types?.listing, locked: false },
                  { id: "SOCIAL", label: t.marketing.types?.social, locked: !canSocialEmail },
                  { id: "EMAIL", label: t.marketing.types?.email, locked: !canSocialEmail },
                ].map((type) => (
                  <button
                    key={type.id}
                    onClick={() => !type.locked && setContentType(type.id)}
                    className={`px-2 py-2 border text-xs uppercase tracking-tighter font-bold transition-all duration-300 relative ${contentType === type.id
                      ? "bg-primary text-background border-primary"
                      : "bg-background text-foreground/50 border-border hover:border-foreground/80"
                      } ${type.locked ? "opacity-50 cursor-not-allowed grayscale" : ""}`}
                  >
                    {type.label}
                    {type.locked && (
                      <span className="absolute -top-1 -right-1 bg-surface ring-1 ring-border text-[8px] px-1 rounded shadow-sm text-foreground/40">
                        PRO
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-3 flex justify-between items-center">
                {t.marketing.tone}
                {!canTone && (
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-bold tracking-tighter">
                    ELITE
                  </span>
                )}
              </label>
              <div className={`grid grid-cols-3 gap-2 ${!canTone ? "opacity-40 grayscale pointer-events-none" : ""}`}>
                {[
                  { id: "professional", label: t.marketing.tonesElite?.professional },
                  { id: "casual", label: t.marketing.tonesElite?.casual },
                  { id: "enthusiastic", label: t.marketing.tonesElite?.enthusiastic },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    className={`px-2 py-2 border text-xs uppercase tracking-tighter font-bold transition-all duration-300 ${tone === t.id
                      ? "bg-primary text-background border-primary"
                      : "bg-background text-foreground/50 border-border hover:border-foreground/80"
                      }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {!canTone && (
                <p className="text-xs text-primary mt-2 font-medium italic">
                  {t.marketing.upgradeElite}
                </p>
              )}
            </div>

            <div>
              <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-3">
                {t.marketing.toneAudience}
              </label>
              <div className="flex flex-wrap gap-3">
                {[
                  t.marketing.tones.luxury,
                  t.marketing.tones.young,
                  t.marketing.tones.family,
                ].map((aud) => (
                  <button
                    key={aud}
                    onClick={() => setAudience(aud)}
                    className={`px-4 py-2 border rounded-none text-sm uppercase tracking-widest font-medium transition-colors duration-300 ${audience === aud
                      ? "bg-primary/10 text-primary border-primary"
                      : "bg-background text-foreground/70 border-border hover:border-foreground/50"
                      }`}
                  >
                    {aud}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 flex flex-col">
              <label className="block font-sans text-sm uppercase tracking-widest text-foreground/50 mb-3">
                {t.marketing.features}
              </label>
              <textarea
                value={features}
                onChange={(e) => setFeatures(e.target.value)}
                className="flex-1 w-full min-h-[120px] px-4 py-3 bg-background border border-border rounded-none text-base text-foreground focus:border-primary outline-none resize-none transition-colors placeholder:text-foreground/20 leading-relaxed"
                placeholder={t.marketing.featuresPlaceholder}
              />
            </div>
          </div>

          <div className="pt-8 mt-auto">
            <button
              onClick={handleGenerate}
              disabled={generating || !AI_ON}
              className="w-full py-4 bg-primary text-background rounded-none text-base uppercase tracking-widest font-medium transition-colors hover:bg-primary-hover flex items-center justify-center gap-3 disabled:opacity-50 group"
            >
              {generating ? (
                <>
                  <div className="w-4 h-4 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  {t.marketing.generating}
                </>
              ) : (
                <>
                  {t.marketing.generateAi}
                  <span className="transform group-hover:translate-x-1 transition-transform">
                    &rarr;
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Media Tasks & Output (Span 7) */}
        <div className="lg:col-span-7 flex flex-col gap-8">
          {/* Output Area */}
          <div
            className={`flex-1 border border-border p-8 flex flex-col relative transition-colors duration-500 min-h-[300px] ${fullContent || generating ? "bg-background" : "bg-surface/30 items-center justify-center"}`}
          >
            {fullContent || generating ? (
              <>
                <div className="flex justify-between items-start mb-6 pb-6 border-b border-border">
                  <h3 className="font-serif text-2xl font-light text-foreground flex items-center gap-3">
                    {t.marketing.generatedOutput}
                    {(generating || isStreaming) && (
                      <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    )}
                  </h3>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => {
                        const link = `/public-listings#listing-${Date.now().toString().slice(-6)}`;
                        navigator.clipboard.writeText(`${link}\n\n${fullContent}`);
                      }}
                      className="text-sm uppercase tracking-widest text-primary hover:text-primary-hover font-bold transition-colors disabled:opacity-50 ring-1 ring-primary/30 px-3 py-1.5 rounded-md bg-primary/5"
                      disabled={generating || isStreaming}
                    >
                      {t.marketing.copyLink}
                    </button>
                    <button
                      onClick={() => navigator.clipboard.writeText(fullContent)}
                      className="text-sm uppercase tracking-widest text-foreground/60 hover:text-foreground font-medium transition-colors disabled:opacity-50 px-3 py-1.5"
                      disabled={generating || isStreaming}
                    >
                      {t.marketing.copy}
                    </button>
                  </div>
                </div>
                <div className="font-sans text-foreground/80 text-base leading-relaxed whitespace-pre-wrap overflow-y-auto pr-4 relative">
                  {displayedContent}
                  {(generating || isStreaming) && (
                    <span className="inline-block w-1.5 h-4 ml-1 bg-primary animate-pulse align-middle" />
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center max-w-sm mx-auto opacity-50">
                {generating ? (
                  <div className="w-12 h-12 border-2 border-primary/20 border-t-primary rounded-full animate-spin mb-6" />
                ) : (
                  <span className="text-4xl font-serif text-primary mb-6 animate-pulse">
                    ✨
                  </span>
                )}
                <p className="font-sans text-base tracking-wide text-foreground leading-relaxed">
                  {generating
                    ? t.marketing.generatingDesc
                    : t.marketing.emptyDesc}
                </p>
              </div>
            )}
          </div>

          {/* Pending Tasks Area */}
          <div className="bg-surface border border-border p-8 flex flex-col h-72">
            <h2 className="font-serif text-2xl font-light text-foreground mb-6">
              {t.marketing.pendingTasks}
            </h2>
            <div className="space-y-4 overflow-y-auto flex-1 pr-4">
              {tasks.length === 0 ? (
                <p className="font-sans text-sm uppercase tracking-widest text-foreground/40 text-center mt-12">
                  {t.marketing.noTasks}
                </p>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-border bg-background hover:border-primary/50 transition-colors group gap-4 sm:gap-0"
                  >
                    <div className="flex items-start sm:items-center gap-4">
                      <div className="w-10 h-10 border border-border flex items-center justify-center bg-surface text-foreground/50 text-sm font-serif tracking-widest">
                        AI
                      </div>
                      <div>
                        <p className="font-sans text-base font-medium text-foreground group-hover:text-primary transition-colors">
                          {task.title}
                        </p>
                        <p className="font-sans text-sm text-foreground/50 mt-1">
                          {new Date(task.createdAt).toLocaleDateString(fmtLocale())}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-sm uppercase tracking-widest font-medium ${task.status === "COMPLETED" ? "text-primary" : "text-foreground/50"}`}
                    >
                      {task.status === "COMPLETED"
                        ? t.marketing.done
                        : t.marketing.inProgress}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
