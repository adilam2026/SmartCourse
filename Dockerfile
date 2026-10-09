FROM node:22-slim AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-slim AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:22-slim
# pg_dump / pg_restore for backups. Keep PG_MAJOR >= the major version of the Railway Postgres service.
ARG PG_MAJOR=17
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates postgresql-common \
 && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
 && apt-get install -y --no-install-recommends postgresql-client-${PG_MAJOR} \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
COPY --from=web /app/web/dist /app/web/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
