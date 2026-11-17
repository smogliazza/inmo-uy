// HTML parsers for inmobiliariaya sites (spec 11.1). Pure functions over the raw HTML, tested on the fixtures
// in ../fixtures: no network and no database here.
import * as cheerio from "cheerio";

export interface Account {
  u: string; iup: string; total: number; pageSize: number;
  /** "Ver más" endpoint and its fixed parameters (the theme script builds the same URL) */
  itemsUrl: string; params: string; tl: string;
}

export interface SourceCard {
  idprop: string;
  code: string | null;          // text after "COD." (sometimes free text, e.g. "Casa con terreno")
  featured: boolean;
  title: string | null;
  label: string | null;         // "Casas en Venta en Centro, Salto, Salto" (link text / ?prop=)
  address: string | null;       // "Dirección: …" line of the location
  photo: string | null;
  features: string[];           // "2 Dormitorio/s", "1 BAÑO", "130 m2 const.", "PATIO"…
  prices: string[];             // "Venta US$ 450.000", "Alquiler $ 80.000 /mes", "Venta Consulte Personalmente"
}

export interface SourceDetail {
  idprop: string;
  title: string | null;
  label: string | null;
  cityId: string | null;        // the source's own city id (breadcrumb link), the authority over the label
  code: string | null;
  typeName: string | null;
  location: string | null;      // "Uruguay 888, Centro, Salto, Uruguay"
  prices: string[];
  points: string[];             // "2 Dormitorio/s", "4.230 M2 Superficie total", "14,39 HECTAREAS Superficie total"
  description: string | null;   // plain text, paragraphs separated by a blank line
  photos: string[];             // full-size originals, in gallery order (the first is the cover)
  lat: number | null;
  lng: number | null;
}

export interface OrgInfo {
  name: string | null;
  logoUrl: string | null;
  address: string | null;
  hours: string | null;
  email: string | null;
  phones: string[];
  whatsapp: string | null;
  social: Record<string, string>;
  /** Counters of the source's own menus: they validate the import totals (spec 11.3). */
  counts: { types: Record<string, number>; cities: Record<string, number>; operations: Record<string, number> };
  /** idciudad → city name, from the same menu */
  cityIds: Record<string, string>;
}

const clean = (s: string | undefined | null) => (s ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const orNull = (s: string) => (s ? s : null);

export function parseAccount(html: string): Account | null {
  const $ = cheerio.load(html);
  const u = $("input#u").attr("value")?.trim();
  const iup = $("input#iup").attr("value")?.trim() || u;
  const total = Number($("input#total_items").attr("value"));
  const pageSize = Number($("input#vt").attr("value")) || 12;
  if (!u || !iup || !Number.isFinite(total)) return null;
  const theme = $("input#srcTheme").attr("value") || "https://www.inmobiliariaya.com/themes/v12/";
  const it = $("input#it").attr("value") || "1";
  const params = $("input#parametros").attr("value") || `u=${u}&iup=${iup}&&editor=&cookie=`;
  return { u, iup, total, pageSize, itemsUrl: `${theme.replace(/\/?$/, "/")}app/components/items/items${it}.php`, params, tl: $("input#tl").attr("value") || "" };
}

/** Page number the next "Ver más" asks for (the home page is page 0 and says 1), or null on the last page. */
export function nextPage(html: string): number | null {
  const v = cheerio.load(html)("input#contadorItems").attr("value");
  return v && /^\d+$/.test(v) ? Number(v) : null;
}

/** URL of one "Ver más" page, exactly as the source's theme script builds it */
export function pageUrl(a: Account, page: number): string {
  return `${a.itemsUrl}?i=undefined&t=undefined&tl=${a.tl}&vt=${a.pageSize}&ti=${a.total}&contadorItems=${page}&${a.params}`;
}

/** Listing cards of the home page or of an items1.php page (12 per page). */
export function parseCards(html: string): SourceCard[] {
  const $ = cheerio.load(html);
  const out: SourceCard[] = [];
  $("article.items1__item").each((_, el) => {
    const card = $(el);
    const link = card.find("a.items1__title").first();
    const href = link.attr("href") || card.find("a[href*='idprop=']").first().attr("href") || "";
    const idprop = card.find("[data-idprop]").first().attr("data-idprop") || /idprop=(\d+)/.exec(href)?.[1];
    if (!idprop) return;
    const codeText = clean(card.find(".items1__code").first().text());
    const code = clean(codeText.replace(/^COD\.?\s*/i, ""));
    const locHtml = card.find("a.items1__location").first().html() || "";
    const [first, second] = locHtml.split(/<br\s*\/?>/i).map(part => clean(cheerio.load(`<p>${part}</p>`)("p").text()));
    const hasAddress = /^Direcci[oó]n:/i.test(first || "");
    out.push({
      idprop,
      code: orNull(code),
      featured: card.find(".items1__star").length > 0,
      title: orNull(clean(link.text())),
      label: orNull(clean(hasAddress ? second : first) || clean(new URLSearchParams(href.replace(/^.*?\?/, "")).get("prop"))),
      address: hasAddress ? orNull(clean(first.replace(/^Direcci[oó]n:\s*/i, ""))) : null,
      photo: card.find("img.items1__img").first().attr("src") || null,
      features: card.find("ul.items1__ul li").map((_, li) => clean($(li).text())).get().filter(Boolean),
      prices: card.find(".items1__price").map((_, p) => clean($(p).text())).get().filter(Boolean),
    });
  });
  return out;
}

/** Rich text of the description → plain paragraphs (the platform never shows HTML from imported data). */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  $("br").replaceWith("\n");
  $("p, h1, h2, h3, h4, h5, h6, div").each((_, el) => { $(el).prepend("\n\n").append("\n\n"); });
  $("li").each((_, el) => { $(el).prepend("\n\n• ").append("\n\n"); });
  return $("#root").text()
    .replace(/\u00a0/g, " ")
    .split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Listing page (?idprop=): gallery, description and coordinates (spec 11.1, "Ficha"). */
export function parseDetail(html: string, idprop: string): SourceDetail {
  const $ = cheerio.load(html);
  const points = $(".item2__point").map((_, el) => clean($(el).text())).get().filter(Boolean);
  const byIcon = (icon: string) => clean($(`.item2__point:has(i.${icon})`).first().text()) || null;
  const codeRaw = points.find(p => /^C[OÓ]DIGO:/i.test(p));
  const prices = $(".item2__price").map((_, el) => clean($(el).text())).get().filter(Boolean);

  // Photos: originals live at /fotos/1/{u}/{idprop}/{file}.jpg; "-gde" folders hold resized copies.
  // Some photos exist as JPEG and WebP, newer ones only as WebP: keep the files the page really lists.
  const found = new Map<string, string[]>(); // base URL (no extension) → extensions seen, in order
  const re = new RegExp(`https?://[^"'\\s)]+/fotos/1/\\d+/${idprop}/[^"'\\s)/]+\\.(?:jpe?g|png|webp)`, "gi");
  for (const m of html.matchAll(re)) {
    const ext = /\.(\w+)$/.exec(m[0])![1].toLowerCase();
    const base = m[0].slice(0, -(ext.length + 1));
    const list = found.get(base) ?? [];
    if (!list.includes(ext)) list.push(ext);
    found.set(base, list);
  }
  const photos = [...found.entries()].map(([base, exts]) => `${base}.${["jpg", "jpeg", "png", "webp"].find(e => exts.includes(e))}`);

  // Coordinates: the map embed searches "lat,lng" (the Street View embed points at the camera, not the property)
  let lat: number | null = null, lng: number | null = null;
  $("iframe[src*='maps']").each((_, el) => {
    if (lat != null) return;
    const src = $(el).attr("src") || "";
    if (/streetview/i.test(src)) return;
    const q = /[?&](?:q|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(src);
    if (q) { lat = Number(q[1]); lng = Number(q[2]); }
  });

  // Breadcrumb: "Casas en Venta en Centro, Salto" links to ?pag=propiedades&idtipo2=…&op=…&idciudad=…
  const crumb = $("a.title1__link[href*='idciudad=']").first();
  const descHtml = $(".item2__feature--description").first().html();
  return {
    idprop,
    title: orNull(clean($("h1.title1__title").first().text())),
    label: orNull(clean(crumb.text())),
    cityId: /idciudad=(\d+)/.exec(crumb.attr("href") || "")?.[1] ?? null,
    code: codeRaw ? orNull(clean(codeRaw.replace(/^C[OÓ]DIGO:\s*/i, ""))) : null,
    typeName: byIcon("fa-home"),
    location: byIcon("fa-map-marker"),
    prices,
    points: points.filter(p => /\d/.test(p) && !/^C[OÓ]DIGO:/i.test(p) && p !== byIcon("fa-map-marker")),
    description: descHtml ? orNull(htmlToText(descHtml)) : null,
    photos,
    lat, lng,
  };
}

/** Brokerage data from the header and footer (imported into Organization / siteConfig). */
export function parseOrgInfo(html: string): OrgInfo {
  const $ = cheerio.load(html);
  const footer = $("[class*='footer2']").first();
  const footerText = clean(footer.text());
  const social: Record<string, string> = {};
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") || "";
    const m = /^https?:\/\/(?:www\.)?(facebook|instagram|youtube|tiktok|linkedin|twitter|x)\.com\/[^\s"']+/i.exec(href);
    if (m) social[m[1].toLowerCase() === "twitter" ? "x" : m[1].toLowerCase()] ??= href;
  });
  const wa = $("a[href*='wa.me/']").first().attr("href");
  const counts: OrgInfo["counts"] = { types: {}, cities: {}, operations: {} };
  const cityIds: Record<string, string> = {};
  // Footer menus: "Apartamentos (57)", "Salto (255)", "Venta (247)": the links carry idtipo2 / idciudad / op
  footer.find("a").each((_, a) => {
    const text = clean($(a).text());
    const m = /^(.+?)\s*\((\d+)\)$/.exec(text);
    if (!m) return;
    const href = $(a).attr("href") || "";
    const bucket = /idtipo2=/.test(href) ? counts.types : /idciudad=/.test(href) ? counts.cities : /[?&]op=/.test(href) ? counts.operations : null;
    if (bucket) bucket[m[1]] = Number(m[2]);
    const cid = /idciudad=(\d+)/.exec(href)?.[1];
    if (cid) cityIds[cid] = m[1];
  });
  return {
    name: orNull(clean($("meta[property='og:title']").attr("content")) || clean($("title").first().text())),
    logoUrl: $("meta[property='og:image']").attr("content") || null,
    address: orNull(clean($("[class*='__address']").first().text())),
    hours: /(\d{1,2}[:.]\d{2}\s*a\s*\d{1,2}[:.]\d{2}[^|]*?(?:hs)?)(?=\s+Email|\s+\d{3}|$)/i.exec(footerText)?.[1]?.trim() ?? null,
    email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(footerText)?.[0] ?? null,
    phones: [...new Set($("a[href^='tel:']").map((_, a) => clean(($(a).attr("href") || "").slice(4))).get().filter(Boolean))],
    whatsapp: wa ? (/wa\.me\/(\d+)/.exec(wa)?.[1] ?? null) : null,
    social,
    counts,
    cityIds,
  };
}
