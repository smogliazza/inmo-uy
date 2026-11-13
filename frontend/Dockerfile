# Web image (spec 12): Next.js "standalone" output, non-root. The NEXT_PUBLIC_* values are baked in at build
# time (Next.js inlines them), so they are build arguments.
#   docker build -t inmo-uy-web --build-arg NEXT_PUBLIC_API_URL=https://app.example.uy frontend
# Optional: --secret id=extra_ca,src=/path/ca.pem behind a TLS-intercepting proxy.

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

FROM base AS build
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca NPM_CONFIG_CAFILE=/run/secrets/extra_ca; fi; \
    npm ci
COPY . .
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_PLATFORM_NAME
ARG NEXT_PUBLIC_SUPPORTED_LOCALES=es,en
ARG NEXT_PUBLIC_DEFAULT_LOCALE=es
ARG NEXT_PUBLIC_MAP_STYLE_URL
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_CSP_ENFORCE=false
ARG NEXT_PUBLIC_AI_ASSISTANT_ENABLED=false
ENV NEXT_OUTPUT=standalone
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NODE_OPTIONS=--max-old-space-size=300
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
