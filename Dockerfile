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
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./dist
COPY server/migrations ./migrations
COPY --from=web /app/web/dist /app/web/dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
