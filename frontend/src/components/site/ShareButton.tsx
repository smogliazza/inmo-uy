"use client";
import { useState } from "react";
import { track } from "@/lib/site/client";
import { IconShare } from "./icons";

export default function ShareButton({ api, slug, propertyId, title, labels }: { api: string; slug: string; propertyId: string; title: string; labels: { share: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        track(api, slug, "share", propertyId);
        const url = window.location.href;
        try {
          if (navigator.share) { await navigator.share({ title, url }); return; }
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch { /* cancelled */ }
      }}
      className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold hover:border-slate-500"
    >
      <IconShare width={16} height={16} /> {copied ? labels.copied : labels.share}
    </button>
  );
}
