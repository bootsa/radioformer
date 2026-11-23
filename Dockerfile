# syntax=docker/dockerfile:1.7
# Radioformer: one small Node process serving the radio protocol, the API and the static web app.

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.21.0

# ---- build: runs on the build machine's own architecture (the output is plain JavaScript) ----
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/stream/package.json packages/stream/
COPY packages/protocol-xml/package.json packages/protocol-xml/
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm -r --filter "./packages/*" build \
 && pnpm --filter web build

# ---- runtime ----
FROM node:${NODE_VERSION}-alpine AS runtime
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/stream/package.json packages/stream/
COPY packages/protocol-xml/package.json packages/protocol-xml/
COPY packages/server/package.json packages/server/
RUN pnpm install --prod --frozen-lockfile --filter @radioformer/server... \
 && pnpm store prune
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/stream/dist packages/stream/dist
COPY --from=build /app/packages/protocol-xml/dist packages/protocol-xml/dist
COPY --from=build /app/packages/server/dist packages/server/dist
COPY packages/server/assets packages/server/assets
COPY --from=build /app/apps/web/build apps/web/build
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    WEB_DIR=/app/apps/web/build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/index.js"]
