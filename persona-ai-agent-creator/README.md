# Persona Studio (EAFIT Step 3 MVP)

Persona Studio is a state-of-the-art, high-performance web platform built for EAFIT challenge Step 3. It provides a complete, production-grade toolchain for creating, deploying, and managing decentralized AI persona agents integrated with Model Context Protocol (MCP) servers and RAG capabilities, fully optimized for Lighthouse metrics, security, and progressive web capabilities.

---

## 🚀 Premium Features & Architecture

### 1. 🔑 DID Trust Chain & Hologram Dynamic Sync
* **Decentralized Verification:** Automates the issuance of custom `LinkedVerifiablePresentation` credentials for each agent under the EAFIT trust chain.
* **Smart Avatar & Metadata Cache Sync:** Deep-checks credentials against current agent data (`name`, `description`, `minimumAgeRequired`, `photo/logo`). Upon metadata or avatar updates, it dynamically re-issues the credential to the decentralized register.
* **Seamless Hologram Recognition:** Maps channels and histories through the agent's invariant DID (`did:webvh:<bot-slug>...`), ensuring client apps like Hologram recognize updates immediately *without* creating duplicate bots.

### 2. ⚡ Hybrid Critical-CSS Inlining
* **Production Optimization:** In production (`NODE_ENV=production`), the application pre-reads and caches the minified `output.css` (only 9.6 KiB) and inlines it directly in the HTML `<style>` block. This limits the network round-trip time to **1 RTT** and completely eliminates render-blocking stylesheets.
* **Developer Comfort:** Dynamically falls back to standard `<link rel="stylesheet">` with dynamic timestamps in development/test modes, preserving hot stylesheet updates (via Tailwind CSS CSS `--watch`).

### 3. 🛡️ Production-Grade Security Suite
* **Strict Content Security Policy (CSP):** Directs the browser to load resources only from verified sources, allowing safe script inlining for instant state recovery and Google Fonts loading while blocking XSS vectors.
* **Custom Native Rate Limiter:** An in-memory, highly performant rate limiter protecting authentication endpoints (Login, Register, Password Reset) from brute-force attempts. Limits requests to 20 per 15 minutes, serving compliant RFC headers and dynamic translations.
* **HSTS (HTTP Strict Transport Security):** Enforces SSL/TLS secure channels for 1 year in production mode.

### 4. 📈 Dynamic SEO, Schema.org & Google Sitemap
* **Dynamic XML Sitemap:** Serves a dynamic `/sitemap.xml` generated in real-time from the SQLite database, reflecting only published agents.
* **Showcase Landing Page:** Features a premium, glassmorphism dark-mode landing page (`/public-agents/:id`) with rich Open Graph headers, Twitter Cards, dynamic QR code generators, and inline Schema.org JSON-LD (`SoftwareApplication` / `IntelligentAgent`) metadata.
* **410 Gone De-indexing:** Automatically responds with `HTTP 410 Gone` and a themed archived page for drafted/unpublished bots, forcing search engines to immediately de-index stale agent links.

### 5. 📱 Progressive Web App (PWA) & Offline Resilience
* **Asset Manifest:** Fully compliant `manifest.json` pointing to modern, responsive SVG branding assets.
* **Maskable SVG Icons:** Includes circular-safe maskable icons (`public/icons/icon-maskable.svg`) ensuring clean brand presentation across modern mobile launchers.
* **Smart Service Worker (`sw.js`):** Intercepts network requests using a robust *Cache-First* strategy for static assets/fonts, and *Network-First* for dynamic views, delivering instant sub-second paint times.
* **Bilingual Glassmorphic Offline Fallback:** Serves a premium, blurred glassmorphic page (`offline.html`) with network-status indicators and manual retry triggers, dynamically tailored in Spanish or English based on browser settings.

### 6. ⏱️ 60 FPS Layout Performance (Zero Forced Reflows)
* **Reflow-Free Stepper Scroll:** Uses an advanced **Sentinel Pattern** (`#stepper-sentinel`) inside the creation wizard. It pre-calculates and caches document coordinates on `load` and `resize` events, reducing the progressive scroll listener to a pure mathematical offset calculation with **0 layout reads on scroll**, entirely resolving forced layouts.
* **Direct WOFF2 Preloading:** Preloads the actual `.woff2` font file of the `Material Symbols Outlined` icon set directly from the global CDN cache (`fonts.gstatic.com`) in parallel, bypassing the CSS import wrapper. Natively declares `@font-face` with `font-display: swap` inside the compiled Tailwind bundle.

---

## 🛠️ Tech Stack & Dependencies

* **Core Backend:** Node.js + Express 5.x + EJS Templates
* **Database:** SQLite via `better-sqlite3` (users, bots, versions, publish runs)
* **Styling & CSS:** Vanilla CSS + Tailwind CSS (compiled, minified, and inlined)
* **Security:** `bcryptjs` for salted hashing, `jsonwebtoken` for secure cookie sessions, custom CRSFToken middleware
* **Testing:** `vitest` for fast concurrency + `supertest` for REST/PWA assertion verification
* **Language Support:** JSON i18n locale files under `locales/` with browser header negotiation

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env` and configure the following variables:

```bash
PORT=3000                 # Server port
JWT_SECRET=secure-secret  # Authentication signing secret
DATABASE_PATH=data/db.sqlite  # SQLite database path
UPLOAD_DIR=uploads/       # Uploaded agent photo directory
GENERATED_DIR=generated/   # Generated Kubernetes artifacts path
TEAM_NAMESPACE=team-f     # Target Kubernetes namespace
BASE_DOMAIN=teams.eafit.testnet.verana.network # Domain suffix for published bots
ENABLE_K8S_APPLY=false    # Set true to run kubectl commands on publish/unpublish
```

---

## 🚀 Quick Start & Developer Workflow

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Run Development Server
```bash
pnpm dev
```
Starts node via `nodemon` and watches Tailwind CSS changes synchronously:
* App: `http://localhost:3000`
* Service Worker Offline Fallback: `http://localhost:3000/offline.html`

### 4. Run Automated Test Suite
```bash
pnpm test
```
Executes the comprehensive Vitest integration suite, covering PWA caching, critical CSS inlining, rate limiting, dynamic SEO sitemaps, CSRF forms, and auth controllers.

---

## 📦 Deployment & Containerization

### Docker Production Build
```bash
docker build -t persona-studio .
docker run -d -p 3000:3000 --env-file .env persona-studio
```

### Kubernetes Native Deployment
Kustomization manifests are located under the `k8s/` folder:
* **Deployment**: High-availability, production-configured replica.
* **PersistentVolumeClaims (PVCs)**: Persistent directories for SQLite database, upload files, and generated YAML assets.
* **Service**: LoadBalancer or ClusterIP exposure setups.

Deploy manually:
```bash
kubectl apply -k k8s/
```
