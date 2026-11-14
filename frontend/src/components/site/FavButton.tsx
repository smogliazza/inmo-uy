"use client";
import { useEffect, useState } from "react";
import { onFavoritesChange, readFavorites, toggleFavorite } from "@/lib/site/client";
import { IconHeart } from "./icons";

export default function FavButton({ slug, id, labels, className = "" }: { slug: string; id: string; labels: { add: string; remove: string }; className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(readFavorites(slug).includes(id));
    sync();
    return onFavoritesChange(sync);
  }, [slug, id]);
  const label = on ? labels.remove : labels.add;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={e => { e.preventDefault(); e.stopPropagation(); setOn(toggleFavorite(slug, id)); }}
      className={`inline-flex items-center justify-center rounded-full bg-white/90 p-2 shadow-sm hover:bg-white ${on ? "text-rose-600" : "text-slate-700"} ${className}`}
    >
      <IconHeart filled={on} width={18} height={18} />
    </button>
  );
}
