# ──────────────────────────────────────────
# Stage 1: Builder — compile native modules
# ──────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Build tools needed for better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ──────────────────────────────────────────
# Stage 2: Production — minimal image
# ──────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache libstdc++

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/
COPY locales/ ./locales/
COPY package.json ./

# Create required runtime directories
RUN mkdir -p /app/data /app/uploads /app/generated

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
