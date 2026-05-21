# ──────────────────────────────────────────
# Stage 1: Builder — compile native modules
# ──────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Build tools needed for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Using npm instead of pnpm to bypass aggressive build script blocks
COPY package.json ./
RUN npm install

# ──────────────────────────────────────────
# Stage 2: Production — minimal image
# ──────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Install kubectl so the app can deploy agents to the cluster
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    && curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && chmod +x kubectl \
    && mv kubectl /usr/local/bin/ \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/
COPY locales/ ./locales/
COPY tailwind.config.js postcss.config.js package.json ./

# Build Tailwind CSS
RUN npx tailwindcss -i public/css/app.css -o public/css/output.css --minify

# Create required runtime directories
RUN mkdir -p /app/data /app/uploads /app/generated

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
