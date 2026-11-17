// Walks an inmobiliariaya site: home page (page 0) → "Ver más" pages → each listing page, all through the
// polite Fetcher (1 request per second, cached). Produces the drafts to import and their warnings.
import { Fetcher } from "./fetcher";
import { nextPage, pageUrl, parseAccount, parseCards, parseDetail, parseOrgInfo, type Account, type OrgInfo, type SourceCard } from "./parse";
import { toDraft, type Draft } from "./rules";

export interface CrawlResult {
  origin: string;
  host: string;
  account: Account;
  org: OrgInfo;
  cards: SourceCard[];
  drafts: Draft[];
}

export function originOf(url: string): { origin: string; host: string } {
  const u = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`);
  return { origin: `${u.protocol}//${u.host}`, host: u.host.replace(/^www\./, "") };
}

export async function crawl(url: string, f: Fetcher, opts: { details?: boolean; limit?: number; log?: (m: string) => void } = {}): Promise<CrawlResult> {
  const log = opts.log ?? (() => {});
  const { origin, host } = originOf(url);
  const home = await f.text(`${origin}/`);
  if (!home) throw new Error(`${origin} did not answer`);
  const account = parseAccount(home);
  if (!account) throw new Error(`${origin} does not look like an inmobiliariaya site (no #u / #total_items)`);
  const org = parseOrgInfo(home);
  log(`${org.name ?? host}: account ${account.u}, ${account.total} listings announced`);

  // Cards: page 0 is the home page; each page says which one comes next
  const cards = new Map<string, SourceCard>();
  for (const c of parseCards(home)) cards.set(c.idprop, c);
  let page = nextPage(home);
  const maxPages = Math.ceil(account.total / 10) + 3;
  for (let n = 0; page != null && n < maxPages && cards.size < account.total; n++) {
    if (opts.limit && cards.size >= opts.limit) break;
    const html = await f.text(pageUrl(account, page), `${origin}/`);
    if (!html) break;
    const before = cards.size;
    for (const c of parseCards(html)) if (!cards.has(c.idprop)) cards.set(c.idprop, c);
    log(`  page ${page}: ${cards.size}/${account.total}`);
    if (cards.size === before) break;
    page = nextPage(html);
  }
  let list = [...cards.values()];
  if (opts.limit) list = list.slice(0, opts.limit);

  // Listing pages: gallery, description, coordinates
  const knownCities = Object.keys(org.counts.cities);
  const usedCodes = new Set<string>();
  const drafts: Draft[] = [];
  let i = 0;
  for (const card of list) {
    i++;
    let detail = null;
    if (opts.details !== false) {
      const html = await f.text(`${origin}/?idprop=${card.idprop}`, `${origin}/`);
      if (html) detail = parseDetail(html, card.idprop);
      if (i % 20 === 0) log(`  listing pages: ${i}/${list.length}`);
    }
    const d = toDraft(card, detail, { origin, knownCities, cityIds: org.cityIds, usedCodes });
    if (opts.details !== false && !detail) d.warnings.push("La ficha no respondió: se importa con los datos de la tarjeta");
    drafts.push(d);
  }

  // A coordinate shared by several listings is the brokerage's default pin, not the property's location
  const seen = new Map<string, number>();
  for (const d of drafts) if (d.lat != null) seen.set(`${d.lat},${d.lng}`, (seen.get(`${d.lat},${d.lng}`) ?? 0) + 1);
  for (const d of drafts) {
    if (d.lat != null && (seen.get(`${d.lat},${d.lng}`) ?? 0) >= 3) {
      d.warnings.push(`Coordenadas compartidas por ${seen.get(`${d.lat},${d.lng}`)} propiedades (marca por defecto): se geocodifica la dirección`);
      d.lat = d.lng = null;
      d.geoPrecision = "APPROX";
    }
  }
  return { origin, host, account, org, cards: list, drafts };
}
