// Browser helpers of the brokerage sites: contact-click events, favourites and WhatsApp links.

/** Records a contact click (spec 8.4). Fire-and-forget: it never blocks the visitor. */
export function track(api: string, slug: string, type: "whatsapp_click" | "phone_click" | "email_click" | "share", propertyId?: string) {
  try {
    void fetch(`${api}/api/public/events?site=${encodeURIComponent(slug)}`, {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...(propertyId ? { propertyId } : {}) }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

/** wa.me link with the message already written ("+59899991525" → 59899991525) */
export const waLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

// Favourites live in the browser (spec 8.1), one list per site. localStorage can be missing or full: never throw.
const KEY = (slug: string) => `fav:${slug}`;
const EVENT = "site-favorites";

export function readFavorites(slug: string): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY(slug)) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

export function toggleFavorite(slug: string, id: string): boolean {
  const list = readFavorites(slug);
  const on = !list.includes(id);
  const next = on ? [id, ...list] : list.filter(x => x !== id);
  try { window.localStorage.setItem(KEY(slug), JSON.stringify(next)); } catch { /* private mode or full */ }
  window.dispatchEvent(new Event(EVENT));
  return on;
}

export function onFavoritesChange(fn: () => void): () => void {
  const h = () => fn();
  window.addEventListener(EVENT, h);
  window.addEventListener("storage", h);
  return () => { window.removeEventListener(EVENT, h); window.removeEventListener("storage", h); };
}
