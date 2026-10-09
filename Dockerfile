# No "# syntax=docker/dockerfile:1" line on purpose: it makes every build download the Dockerfile frontend from Docker Hub
# (one more request that can fail with 429/504). Nothing below needs it: only multi-stage builds, ARG before FROM and
# plain COPY --from, all handled by the builder's built-in frontend.
# pg_dump/pg_restore must have EXACTLY the major version of the database server (a newer client writes
# dumps that an older server cannot restore). The image therefore carries the clients for PostgreSQL
# 16, 17 and 18 and the app picks the one matching the server at backup time (see server/src/backup.ts).
# Add a version: add a stage below, a COPY line in the final stage, and its number to PG_MAJORS_DOC.
ARG NODE_IMAGE=node:22-slim
ARG PG_IMAGE_16=postgres:16-bookworm
ARG PG_IMAGE_17=postgres:17-bookworm
ARG PG_IMAGE_18=postgres:18-bookworm

# --- PostgreSQL clients taken from the official images (same Debian release as node:22-slim; no apt)
FROM ${PG_IMAGE_16} AS pg16
RUN mkdir -p /out/usr/lib/postgresql/16/bin && cp /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore /out/usr/lib/postgresql/16/bin/
FROM ${PG_IMAGE_17} AS pg17
RUN mkdir -p /out/usr/lib/postgresql/17/bin && cp /usr/lib/postgresql/17/bin/pg_dump /usr/lib/postgresql/17/bin/pg_restore /out/usr/lib/postgresql/17/bin/
FROM ${PG_IMAGE_18} AS pg18
# libpq (and the few libraries node:22-slim lacks) come from the newest client; libpq is backward compatible.
RUN set -eux; \
    mkdir -p /out/usr/lib/postgresql/18/bin; \
    cp /usr/lib/postgresql/18/bin/pg_dump /usr/lib/postgresql/18/bin/pg_restore /out/usr/lib/postgresql/18/bin/; \
    for b in pg_dump pg_restore; do ldd /usr/lib/postgresql/18/bin/$b | awk '/=> \//{print $3}'; done \
      | sort -u | grep -Ev '/(libc|libm|libresolv|libpthread|libdl|librt)\.so' \
      | while read -r lib; do \
          dest="/out$(echo "$lib" | sed 's|^/lib/|/usr/lib/|')"; \
          mkdir -p "$(dirname "$dest")"; cp -L "$lib" "$dest"; \
        done

FROM ${NODE_IMAGE} AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app/server
ENV NODE_ENV=production
COPY --from=pg18 /out/ /
COPY --from=pg17 /out/ /
COPY --from=pg16 /out/ /
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
COPY server/catalog-photos ./catalog-photos
COPY --from=web /app/web/dist /app/web/dist
# Run as the unprivileged "node" user; ./data is only used in development (production uses the bucket).
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
