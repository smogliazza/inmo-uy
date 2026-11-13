# API image (spec 12): compiled TypeScript, production dependencies only, non-root.
#   docker build -t inmo-uy-api backend
# Optional: behind a TLS-intercepting proxy, pass its CA with
#   --secret id=extra_ca,src=/path/ca.pem   (never needed in GitHub Actions)

# OpenSSL 3 for Prisma's schema engine (migrations run on start), taken from the full image of the same
# Debian release instead of apt, so the build needs no Debian mirror. Images are built for linux/amd64.
FROM node:22-bookworm AS openssl

FROM node:22-bookworm-slim AS base
COPY --from=openssl /usr/bin/openssl /usr/bin/openssl
COPY --from=openssl /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/
COPY --from=openssl /usr/lib/ssl /usr/lib/ssl
COPY --from=openssl /etc/ssl/certs /etc/ssl/certs
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# ── Build: all dependencies, prisma generate, tsc ──
FROM base AS build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca NPM_CONFIG_CAFILE=/run/secrets/extra_ca; fi; \
    npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate && npx tsc --skipLibCheck

# ── Production dependencies only (postinstall runs prisma generate) ──
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca NPM_CONFIG_CAFILE=/run/secrets/extra_ca; fi; \
    npm ci --omit=dev && npm cache clean --force

# ── Runtime ──
FROM base AS runtime
ENV NODE_ENV=production PORT=4000 NODE_OPTIONS=--max-old-space-size=300
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations (and the idempotent data backfills) run on start: RUN_MIGRATIONS_ON_START=false disables them
CMD ["node", "dist/server.js"]
