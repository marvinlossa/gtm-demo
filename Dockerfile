# Railway-friendly multi-stage build with native better-sqlite3 toolchain.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
  && apt-get install -y python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Mount Railway volume at /data and set SQLITE_PATH=/data/gtm-demo.sqlite
ENV SQLITE_PATH=/data/gtm-demo.sqlite
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data
EXPOSE 3000
CMD ["npm", "start"]
