# Migrador desde inmobiliariaya

Especificación, sección 11. Trae las propiedades públicas de un sitio hecho con inmobiliariaya (por ejemplo
`www.castroymeirelles.com.uy`) a la plataforma, con fotos, precios por operación, ubicación y los datos de la
inmobiliaria. Código: `tools/migrator/`.

## Dos modos

| Modo | Para qué | Qué hace |
|---|---|---|
| `demo` | Mostrarle a una inmobiliaria cómo se vería su sitio | Crea (o actualiza) una inmobiliaria **de demostración**: `isDemo`, vence a los 30 días, no se indexa y muestra el aviso «Demostración con datos públicos de …». Al vencer se borra sola con todo lo que tiene. |
| `migration` | Pasar a un cliente que ya firmó | Importa en una inmobiliaria existente. Exige `--org`, `--authorized-by "Nombre, fecha"` y `--as` con un usuario SUPERADMIN, y el módulo «Migrador inmobiliariaya» encendido para esa inmobiliaria. Quién autorizó queda en el registro de auditoría. |

En los dos modos, correrlo otra vez **actualiza y nunca duplica** (cada propiedad se identifica por el número de
ficha de origen). Lo que ya no está en el origen pasa a «Retirada»; no se borra nada. Un pin corregido a mano en
el panel no se pisa.

## Antes de correrlo

- Node.js 22.12 o superior y `npm ci` en `backend/` y en `tools/migrator/`.
- `MIGRATOR_USER_AGENT`: identifica a la plataforma con un contacto, por ejemplo
  `inmo-uy-migrator/1.0 (+https://plataforma.uy; ops@plataforma.uy)`. Sin esto no consulta el origen.
- Para escribir en la base: `DATABASE_URL`, `MIGRATOR_PUBLIC_API_URL` (dirección pública de la API, para las URLs
  de las fotos, ej. `https://app.plataforma.uy`), las `R2_*` si las fotos van a R2 y `GEOCODER_USER_AGENT` para
  Nominatim. Son las mismas variables que usa la API (`deploy/api.env.example`).

## Uso

```bash
cd tools/migrator
npm run migrator -- --url https://www.castroymeirelles.com.uy --mode demo --dry-run
```

`--dry-run` no toca la base: deja `out/{host}.json` (todo lo que se importaría) y `out/{host}-warnings.csv`
(advertencias, se abre con Excel) y muestra el informe. Conviene correrlo siempre primero.

```bash
npm run migrator -- --url https://www.castroymeirelles.com.uy --mode demo
```

```bash
npm run migrator -- --url https://www.castroymeirelles.com.uy --mode migration --org <id> --authorized-by "María Castro, 2026-11-20" --as admin@plataforma.uy
```

Otras opciones: `--limit N` (solo las primeras N), `--no-details` (solo tarjetas, rápido, para ver totales),
`--offline` (solo lo que ya está en `.cache/`), `--max-photos N`, `--no-geocode`, `--agent <email>` (a quién se
asignan las propiedades en el modo migración).

## Cómo trabaja

- Una consulta por segundo como máximo, de a una, con reintentos y espera creciente; respeta `robots.txt`.
- Guarda todo lo que baja en `.cache/{host}/`: si se corta, se vuelve a correr y sigue donde estaba sin volver a
  pedir lo que ya tiene.
- Lee la portada y cada «Ver más» (páginas de 21 propiedades), y después la ficha de cada propiedad: galería
  completa, descripción, coordenadas.
- Reglas (sección 11.2): «4.230» = 4230 y «14,39» = 14,39; `US$` = dólares y `$` = pesos; «/mes» = mensual; sin
  precio o «Consulte» = «Consultar»; montos de 10 o menos = «Consultar» con advertencia; los tipos se pasan al
  catálogo de Uruguay y lo que no tiene equivalente queda como «Otro» con advertencia; un código vacío, repetido o
  en texto libre se reemplaza por el número de ficha.
- Ubicación: la del mapa de la ficha (exacta); si no hay, la dirección geocodificada con Nominatim
  (aproximada); si falla, el centro de la ciudad (aproximada). Una coordenada repetida en varias fichas es el pin
  por defecto de la inmobiliaria y se descarta.
- Fotos: se bajan en orden (la primera es la portada), se guardan con sus tres tamaños WebP y la URL de origen.
- Datos de la inmobiliaria: logo, dirección, teléfonos, WhatsApp, email, horario y redes. En el modo migración
  solo completan lo que la inmobiliaria todavía no cargó.

## Informe

Totales por tipo, operación y ciudad comparados con los contadores de los menús del propio sitio de origen. El
total encontrado tiene que coincidir con el anunciado (278 para `castroymeirelles.com.uy` el 2026-11-17; la
especificación hablaba de 276, el sitio sumó propiedades).

## En el servidor de producción

La base no está expuesta fuera de Docker. Se corre en un contenedor descartable en la misma red, con una copia
del repositorio en la versión desplegada y el `.env.api` del servidor:

```bash
cd /opt/inmo-uy && git clone --depth 1 --branch vX.Y.Z.W https://github.com/OWNER/inmo-uy.git migrator-src
```

```bash
docker run --rm -it --network inmo-uy_default --env-file .env.api -e MIGRATOR_USER_AGENT -e MIGRATOR_PUBLIC_API_URL -v /opt/inmo-uy/migrator-src:/src -w /src node:22-bookworm bash -c "cd backend && npm ci && cd ../tools/migrator && npm ci && npm run migrator -- --url https://www.ejemplo.com.uy --mode demo"
```

## Demos vencidas

La API revisa cada 6 horas y borra las inmobiliarias con `isDemo` cuya fecha de vencimiento ya pasó, con
propiedades, fotos (también en R2), consultas y usuarios. Es lo único que la plataforma borra, y nunca toca una
inmobiliaria que no sea de demostración (`backend/src/lib/demoCleanup.ts`).
