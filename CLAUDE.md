# Notas del proyecto para Claude

Plataforma inmobiliaria multi-inmobiliaria para Uruguay, forkeada de
`David-rider/Real-estate-Agency-CRM` (commit `d2f0f9e`, licencia MIT). El remoto
`upstream` apunta al repo original y se usa solo para cherry-picks puntuales.

`backend/` = Express 5 + Prisma + PostgreSQL. `frontend/` = Next.js 16 + React 19 + Tailwind 4.
Hoy se puede desplegar en Render (`render.yaml`, se conserva) + Vercel; el destino es un Droplet de
DigitalOcean con Docker Compose + Caddy (fase F4 de la especificación).

La especificación técnica v1.0 ("Plataforma inmobiliaria multi-inmobiliaria para Uruguay") manda sobre
el alcance de cada fase. Si algo de este archivo la contradice, avisá en el PR.

## Idioma

- Registros del proyecto (`CHANGELOG.md`, `guides/`, descripciones de PR) y respuestas al dueño: **en español**
  (Uruguay). Ya no hace falta la versión en chino ni en inglés.
- Código, comentarios de código y mensajes de commit: **en inglés**.
- Comandos, rutas y nombres de archivo se escriben una sola vez, sin traducir.
- Los registros existentes en chino/inglés no se reescriben de una vez; si se edita una entrada vieja, se
  puede pasar a español en ese momento.

## Reglas innegociables (sección 0 de la especificación)

1. **No borrar funcionalidades.** Lo que no se usa se apaga con el sistema de módulos. Solo se borra código
   muerto comprobado (sin referencias) y se explica en el PR.
2. **No borrar columnas ni tablas.** Cambios de base aditivos: agregar columnas/tablas/valores de enum o quitar
   un NOT NULL. Una columna que deja de usarse se marca *deprecated* con un comentario en `schema.prisma`.
3. **Campos de módulos apagables no pueden ser obligatorios en la base**: nullable o con default. La
   obligatoriedad se valida en la API según módulos y políticas de la organización.
4. **Migraciones idempotentes** (`IF NOT EXISTS`, `ADD VALUE IF NOT EXISTS`, constraints protegidos). Nunca
   editar una migración ya publicada.
5. **Aislamiento por inmobiliaria.** Toda consulta se filtra por `orgId`; los IDs referenciados se validan con
   `checkRefs` y se usan `clientScope` / `isManager` de `backend/src/lib/access.ts`. Cada endpoint nuevo lleva
   una prueba de aislamiento en `backend/tests/smoke.ts`.
6. **Traducir, no reescribir.** Todo texto visible va a `frontend/src/lib/i18n/`. Español (es-UY) es el idioma
   por defecto; los otros idiomas existentes se conservan.
7. **Un PR por tarea**, chico, con CI en verde (typecheck, migraciones, smoke tests, `next build`).
8. **Sin secretos en el repo**, sin datos de prueba en producción, sin contraseñas fijas.
9. **Dinero con Decimal.** Toda columna nueva de importes es `Decimal(14,2)` con su moneda al lado. Nunca se
   suman monedas distintas. Las columnas Float existentes se dejan como están.
10. **Ante una duda de negocio** (alquileres, impuestos, contratos) no se inventan reglas: se dejan
    configurables por inmobiliaria y se anotan en el PR como pregunta abierta.

### Definición de terminado (cada tarea)

- CI en verde y smoke tests nuevos para lo agregado.
- Funciona con el módulo encendido **y** apagado. Apagado: no aparece en la interfaz, la API responde
  404 `module_disabled` y no corre ningún job del módulo.
- Textos en es-UY sin inglés visible.
- `CHANGELOG.md` actualizado y `guides/testing-checklist.md` ampliado si hay algo visible para el cliente.

## Registros a mantener al día en cada cambio

1. `CHANGELOG.md`: agregar una entrada corta bajo **[未发布]** (sin publicar), en la categoría que corresponda
   (Agregado / Corregido / Seguridad / Cambiado / Eliminado). Describe lo que nota el usuario, no detalles de
   implementación. En español.
2. `guides/roadmap.md`: actualizar la tabla de seguimiento cuando un ítem del roadmap empieza o termina.
3. Variable de entorno nueva: sincronizar `backend/.env.example` / `frontend/.env.example` / `.env.example`
   (raíz, para Docker Compose), `render.yaml` y la tabla de variables de entorno de `CHANGELOG.md`.
4. Funcionalidad nueva visible para el cliente: agregarla a `guides/testing-checklist.md`.
5. Las versiones siguen `guides/release-process.md` (versión de 4 segmentos `X.Y.Z.W`, ej. `1.0.1.0`; subir
   la versión en los dos `package.json`; mover [未发布] a `## [X.Y.Z.W] — fecha`; después del deploy verificar
   el `version` de `GET /api/health`; agregar una fila a la tabla de historial de versiones). Los tags los
   empuja el dueño.

## Convenciones

- Cambios de esquema: editar `backend/prisma/schema.prisma` y agregar una migración **idempotente** nueva.
  En producción las migraciones se aplican al arrancar vía `backend/src/release.ts`.
- El backend en producción corre **compilado**: `npm run build` (prisma generate + tsc) y `npm start`
  (`node dist/server.js`). `ts-node` es solo para desarrollo (`npm run dev`, `npm run start:ts`).
- Las peticiones del frontend pasan todas por `frontend/src/lib/api.ts`; las fechas de inputs se convierten
  con `dateInputToISO`. Los textos nuevos de interfaz van en `frontend/src/lib/i18n/extra.ts`, completando
  los cuatro idiomas (en, zh-CN, zh-TW, es).
- Interruptores de funcionalidades: hoy `frontend/src/lib/features.ts` + variables de entorno del backend.
  El asistente IA está apagado a propósito. Desde la fase F1 todo esto pasa al sistema de módulos
  (`backend/src/lib/modules.ts`), que mapea los flags existentes.
- Priorizar lo que resuelve problemas concretos de inmobiliarias y agentes, sin agregar peso innecesario.
- El repo es **público** y su historial no se puede borrar de verdad: nunca commitear secretos, cadenas de
  conexión ni contraseñas, ni documentos (Word u otros binarios) que los contengan. Los pendientes que
  involucran cuentas, secretos o riesgos abiertos van en documentos locales del dueño, no en el repo.

## Lecciones aprendidas y protecciones operativas (desde `v1.1.0.0`)

1. **Versión de 4 segmentos vs. semver de Prisma CLI.** Prisma 4.16.2 interpreta `"version"` de
   `package.json` con semver estricto de 3 segmentos y falla con `Invalid version` si tiene 4. **Regla**: la
   versión de 4 segmentos va en `"appVersion"` (ej. `"1.1.0.0"`) y `"version"` lleva solo los primeros 3
   (`"1.1.0"`), en los dos `package.json`. `backend/src/server.ts` lee `pkg.appVersion || pkg.version` para
   `/api/health`.
2. **Campos `Bytes` en Prisma 4.** Las columnas `Bytes` (`UploadedFile.data`) reciben un `Buffer` de Node.js,
   no un `Uint8Array`.
3. **En Express, rutas estáticas antes que las de parámetro.** Subrutas como `POST /import` en `clients.ts` y
   `properties.ts` se registran antes que `/:id`; si no, `import` se toma como `:id`.
4. **Typecheck de `backend/tests/smoke.ts`.** Pasarle un archivo a `tsc` ignora `tsconfig.json`. **Regla**:
   `npx tsc --esModuleInterop --skipLibCheck --noEmit tests/smoke.ts`.
5. **Almacenamiento híbrido (Cloudflare R2 + respaldo en PostgreSQL).** Si están las variables `R2_*`,
   `backend/src/lib/storage.ts` usa R2; si no, guarda en `UploadedFile` (`bytea`) para no perder archivos al
   reiniciar el contenedor. Las fotos públicas salen por `/api/uploads/public/:id`; los documentos privados
   usan URLs firmadas HMAC-SHA256 de 10 minutos: `GET /api/documents/:id/view-url` →
   `/api/uploads/private/:id?token=...&exp=...`.
6. **Autenticación dual cookie + CSRF.** `authMiddleware.ts` acepta `Authorization: Bearer` o la cookie
   httpOnly `crm_session`. Las peticiones de escritura (`POST`/`PUT`/`PATCH`/`DELETE`) autenticadas por cookie
   y sin Bearer DEBEN llevar `X-CSRF-Protection: 1` (`api.ts` y `uploadFile()` ya lo agregan).
7. **Actualizar la versión en `package-lock.json` sin romperlo.** Nunca reemplazar `"version"` en todo el
   archivo (rompe versiones de dependencias); cambiar solo `j.version` y `j.packages[""].version` de la raíz.
8. **Grupos de Dependabot y `react` / `react-dom`.** Están con versión exacta en `frontend/package.json`, así que
   `.github/dependabot.yml` DEBE agrupar `react`, `react-dom`, `@types/react` y `@types/react-dom`
   (`react-ecosystem`) e ignorar `version-update:semver-major`; si no, un `react-dom` suelto rompe
   `npm install` con `ERESOLVE`.
9. **Fuente única de verdad y auditoría completa (cero deriva).**
   - No duplicar datos de negocio: precios de planes, funcionalidades por plan, nombre de marca y temas
     (`luxury`, `modern`, `youth`, `chinese`, `cyberpunk`) se leen de `frontend/src/lib/i18n/translations.ts` /
     `extra.ts` y `ThemeContext.tsx`, nunca se escriben a mano en otras páginas.
   - Cada ruta pública y el `Header.tsx` interno muestran el selector de idioma en todos los tamaños de
     pantalla (no ocultarlo con `hidden sm:block`). Desde la fase F2 los idiomas visibles se controlan con
     `SUPPORTED_LOCALES`.
   - Antes de commitear cambios de interfaz, marca o textos: `cd frontend && npm run audit:i18n` (cobertura de
     páginas al 100%) y `git grep` para confirmar que no quedan marcas o precios viejos.

## Entorno local

```bash
cp .env.example .env        # completar las variables marcadas como obligatorias
docker compose up           # db (PostgreSQL 16) + api (:4000) + web (:3000)
```

## Chequeos antes de hacer push

```bash
cd backend && npm run typecheck && npm run compile
API_URL=http://localhost:4000 npm run test:smoke   # API corriendo contra una base descartable
cd ../frontend && npm run audit:i18n && npx tsc --noEmit -p . && npx eslint . --quiet && npx next build
```

Los smoke tests solo se corren contra una base descartable, nunca contra producción. Si no hay una base
descartable disponible, se dice claramente que no se corrieron.
