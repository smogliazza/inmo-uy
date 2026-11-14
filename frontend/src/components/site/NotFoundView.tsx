"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/languages";

type T = { title: string; text: string; home: string };

export default function NotFoundView({ texts, pathMode }: { texts: Record<string, T>; pathMode: boolean }) {
  const params = useParams<{ orgSlug?: string; lang?: string }>();
  const t = texts[params?.lang || ""] || texts[DEFAULT_LANGUAGE] || Object.values(texts)[0];
  const home = pathMode && params?.orgSlug ? `/sites/${params.orgSlug}` : "/";
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="text-7xl font-bold text-slate-200">404</p>
      <h1 className="mt-4 text-2xl font-bold">{t.title}</h1>
      <p className="mt-2 text-slate-700">{t.text}</p>
      <Link href={home} className="mt-8 inline-block rounded-full bg-brand px-6 py-3 font-semibold text-brand-fg">{t.home}</Link>
    </div>
  );
}
