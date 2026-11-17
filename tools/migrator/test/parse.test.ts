// Parsers and rules on the real pages saved in ../fixtures (spec 11: tests before touching the network)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseAccount, parseCards, parseDetail, parseOrgInfo, htmlToText, nextPage, pageUrl } from "../src/parse";
import { parseNumberUY, parsePrice, mapType, parseLabel, parseFeatures, toDraft } from "../src/rules";

const F = (n: string) => readFileSync(join(__dirname, "..", "fixtures", n), "utf8");
const noWarn = () => assert.fail("unexpected warning");

test("account and paging inputs of the home page", () => {
  const a = parseAccount(F("home.html"))!;
  assert.deepEqual([a.u, a.iup, a.total, a.pageSize], ["417", "417", 278, 12]);
  assert.equal(nextPage(F("home.html")), 1, "the home page is page 0");
  assert.equal(nextPage(F("items-page-12.html")), 13);
  assert.match(pageUrl(a, 12), /^https:\/\/www\.inmobiliariaya\.com\/themes\/v12\/app\/components\/items\/items1\.php\?i=undefined&t=undefined&tl=&vt=12&ti=278&contadorItems=12&u=417&iup=417&&editor=&cookie=\d+$/);
});

test("cards of the home page and of an items1.php page", () => {
  const home = parseCards(F("home.html"));
  assert.equal(home.length, 21);
  const c = home.find(x => x.idprop === "64640")!;
  assert.equal(c.featured, true);
  assert.equal(c.code, "Casa con terreno");
  assert.equal(c.address, "Avenida Manuel Oribe");
  assert.equal(c.label, "Casas en Venta en Sobre Avenida Manuel Oribe, Salto");
  assert.deepEqual(c.prices, ["Venta US$ 450.000"]);
  assert.deepEqual(c.features, ["2 Dormitorio/s", "1 BAÑO", "130 m2 const.", "4.230 m2 total", "1 AUTOS"]);
  assert.match(c.photo!, /\/fotos\/1\/417\/64640\/\d+\.jpg$/);
  const page = parseCards(F("items-page-12.html"));
  assert.equal(page.length, 21);
  assert.equal(new Set([...home, ...page].map(x => x.idprop)).size, 42, "pages do not overlap");
});

test("listing page: house with coordinates and full gallery", () => {
  const d = parseDetail(F("ficha-casa-64640.html"), "64640");
  assert.equal(d.title, "Avenida Manuel Oribe ¡Una oportunidad para vivir, invertir y proyectar a futuro!");
  assert.equal(d.typeName, "Casas");
  assert.equal(d.code, "Casa con terreno");
  assert.deepEqual(d.prices, ["Venta US$ 450.000"]);
  assert.equal(d.photos.length, 16);
  assert.ok(d.photos.every(p => /\/fotos\/1\/417\/64640\/\d+\.jpg$/.test(p)), "originals, not the -gde copies");
  assert.equal(d.photos[0], parseCards(F("home.html")).find(x => x.idprop === "64640")!.photo, "the cover comes first");
  assert.equal(d.label, "Casas en Venta en Sobre Avenida Manuel Oribe, Salto");
  assert.equal(d.cityId, "188");
  assert.equal(d.lat, -31.3875688);
  assert.equal(d.lng, -57.9112056);
  assert.match(d.description!, /^PROPIEDAD EN VENTA – SALTO, URUGUAY\n\nPadrón 23\.507/);
  assert.ok(!/<|style=/.test(d.description!), "plain text only");
});

test("listing page: farm in hectares without map, rental per month", () => {
  const campo = parseDetail(F("ficha-campo-58450.html"), "58450");
  assert.equal(campo.typeName, "Campos y Chacras");
  assert.equal(campo.lat, null, "only a Street View embed: no coordinates");
  assert.deepEqual(campo.points, ["14,39 HECTAREAS Superficie total"]);
  assert.equal(campo.photos.length, 5);
  const local = parseDetail(F("ficha-alquiler-62562.html"), "62562");
  assert.deepEqual(local.prices, ["Alquiler $ 80.000 /mes"]);
  assert.equal(local.location, "Uruguay 888, Centro, Salto, Uruguay");
  assert.equal(local.photos.length, 9);
});

test("brokerage data and the source's own counters", () => {
  const o = parseOrgInfo(F("home.html"));
  assert.equal(o.name, "Castro & Meirelles");
  assert.equal(o.whatsapp, "59899991525");
  assert.equal(o.email, "info@castroymeirelles.com.uy");
  assert.equal(o.address, "Zorrilla de San Martin 502, Salto, Uruguay");
  assert.ok(o.social.instagram && o.social.facebook);
  assert.equal(Object.values(o.counts.types).reduce((a, b) => a + b, 0), 278, "types add up to total_items");
  assert.equal(o.counts.cities["Termas del Daymán"], 10);
  assert.equal(o.cityIds["188"], "Salto");
  assert.deepEqual(o.counts.operations, { Venta: 247, Alquiler: 38 });
});

test("numbers the Uruguayan way", () => {
  assert.equal(parseNumberUY("4.230"), 4230);
  assert.equal(parseNumberUY("14,39"), 14.39);
  assert.equal(parseNumberUY("450.000"), 450000);
  assert.equal(parseNumberUY("1.234,5"), 1234.5);
  assert.equal(parseNumberUY("130"), 130);
  assert.equal(parseNumberUY("—"), null);
});

test("prices: currency, period, «Consultar» and symbolic amounts", () => {
  assert.deepEqual(parsePrice("Venta US$ 450.000", noWarn), { operation: "SALE", amount: 450000, currency: "USD", period: null, onRequest: false });
  assert.deepEqual(parsePrice("Alquiler $ 80.000 /mes", noWarn), { operation: "RENT", amount: 80000, currency: "UYU", period: "MONTH", onRequest: false });
  assert.deepEqual(parsePrice("Venta Consulte Personalmente", noWarn), { operation: "SALE", amount: null, currency: "USD", period: null, onRequest: true });
  assert.deepEqual(parsePrice("Venta", noWarn), { operation: "SALE", amount: null, currency: "USD", period: null, onRequest: true });
  const w: string[] = [];
  assert.equal(parsePrice("Venta US$ 1", x => w.push(x))!.onRequest, true);
  assert.equal(w.length, 1, "symbolic amount warned");
  assert.equal(parsePrice("Alquiler Temporario US$ 1.500", noWarn)!.operation, "SEASONAL_RENT");
});

test("types, labels and features", () => {
  assert.equal(mapType("Campos y Chacras", noWarn), "CAMPO_CHACRA");
  assert.equal(mapType("Galpón", noWarn), "GALPON");
  assert.equal(mapType("HOTEL", noWarn), "HOTEL");
  const w: string[] = [];
  assert.equal(mapType("Castillos", x => w.push(x)), "OTRO");
  assert.equal(w.length, 1);
  const cities = ["Salto", "Termas del Daymán", "Montevideo"];
  assert.deepEqual(parseLabel("Casas en Venta en Centro, Salto, Salto", cities), { typeName: "Casas", operation: "Venta", locality: "Centro", city: "Salto", department: "Salto" });
  assert.deepEqual(parseLabel("Terrenos en Venta en Salto, Salto", cities), { typeName: "Terrenos", operation: "Venta", locality: null, city: "Salto", department: "Salto" });
  assert.deepEqual(parseLabel("Casas en Venta en Sobre Avenida Manuel Oribe, Salto", cities), { typeName: "Casas", operation: "Venta", locality: "Sobre Avenida Manuel Oribe", city: "Salto", department: "Salto" });
  assert.equal(parseLabel("Locales Comerciales en Venta en Termas del Daymán, Salto", cities).city, "Termas del Daymán");
  assert.deepEqual(parseLabel("Casas en Venta, Alquiler en Zona Cerro, Salto, Salto", cities), { typeName: "Casas", operation: "Venta, Alquiler", locality: "Zona Cerro", city: "Salto", department: "Salto" });
  assert.deepEqual(parseFeatures(["2 Dormitorio/s", "1 BAÑO", "130 m2 const.", "4.230 m2 total", "1 AUTOS", "PATIO", "PARRILLERO", "AMOBLADO"]),
    { beds: 2, baths: 1, builtAreaM2: 130, landArea: 4230, landAreaUnit: "M2", garageSpaces: 1, amenities: ["patio", "parrillero", "amoblado"] });
  assert.deepEqual(parseFeatures(["14,39 HECTAREAS Superficie total"]).landArea, 14.39);
});

test("drafts of the three reference listings", () => {
  const cards = [...parseCards(F("home.html")), ...parseCards(F("items-page-12.html"))];
  const info = parseOrgInfo(F("home.html"));
  const ctx = { origin: "https://www.castroymeirelles.com.uy", knownCities: Object.keys(info.counts.cities), cityIds: info.cityIds, usedCodes: new Set<string>() };
  const casa = toDraft(cards.find(c => c.idprop === "64640")!, parseDetail(F("ficha-casa-64640.html"), "64640"), ctx);
  assert.equal(casa.propertyType, "CASA");
  assert.equal(casa.code, "64640", "free-text code falls back to the idprop");
  assert.ok(casa.warnings.some(w => /texto libre/.test(w)));
  assert.equal(casa.geoPrecision, "EXACT");
  assert.equal(casa.landArea, 4230);
  assert.equal(casa.featured, true);
  assert.equal(casa.city, "Salto");
  const campo = toDraft(cards.find(c => c.idprop === "58450")!, parseDetail(F("ficha-campo-58450.html"), "58450"), ctx);
  assert.equal(campo.propertyType, "CAMPO_CHACRA");
  assert.equal(campo.code, "58450");
  assert.deepEqual([campo.landArea, campo.landAreaUnit], [14.39, "HA"]);
  assert.equal(campo.geoPrecision, "APPROX", "no coordinates: geocoded later");
  assert.deepEqual(campo.prices, [{ operation: "SALE", amount: 330000, currency: "USD", period: null, onRequest: false }]);
  const local = toDraft(cards.find(c => c.idprop === "62562")!, parseDetail(F("ficha-alquiler-62562.html"), "62562"), ctx);
  assert.equal(local.propertyType, "LOCAL_COMERCIAL");
  assert.deepEqual(local.prices, [{ operation: "RENT", amount: 80000, currency: "UYU", period: "MONTH", onRequest: false }]);
  assert.equal(local.locality, "Centro");
  assert.equal(local.photos.length, 9);
});

test("rich text becomes paragraphs", () => {
  assert.equal(htmlToText("<h1>Título</h1><p>Uno <strong>dos</strong></p><p><br></p><ul><li>a</li><li>b</li></ul>"), "Título\n\nUno dos\n\n• a\n\n• b");
});
