# Persona AI Agent Creator (EAFIT Step 3 MVP)

This project implements a full vertical slice for the EAFIT challenge Step 3:

- User auth (email/password)
- Bot CRUD with ownership checks
- Bot configuration (persona, service, prompt, MCP selection, optional RAG URLs)
- Publish/unpublish flow with generated Kubernetes artifacts
- Public URL generation for Hologram usage

## Tech Stack

- Node.js + Express + EJS
- SQLite persistence (`users`, `bots`, `bot_versions`, `publish_runs`)
- `js-yaml` for artifact generation
- JSON-based i18n locale files in `locales/`

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Start app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

- `PORT`: app port
- `JWT_SECRET`: auth signing secret
- `DATABASE_PATH`: sqlite db path
- `UPLOAD_DIR`: uploaded photo directory
- `GENERATED_DIR`: generated artifacts root
- `TEAM_NAMESPACE`: Kubernetes namespace (default `team-f`)
- `BASE_DOMAIN`: domain suffix used for bot URLs
- `KUBECONFIG_PATH`: path to kubeconfig file
- `KUBECTL_BIN`: kubectl executable path (useful for local install under `$HOME/.local/bin`)
- `ENABLE_K8S_APPLY`: `true` to execute `kubectl apply/delete`, `false` to only generate manifests
- `AGENT_IMAGE`: container image for bot deployment manifest

## Internationalization (i18n)

- Locales are stored in:
  - `locales/en.json`
  - `locales/es.json`
- Language selection:
  - query param `?lang=en|es`
  - `lang` cookie
  - browser `Accept-Language` fallback
- To add a new language:
  1. Create a new locale file (for example `locales/pt.json`)
  2. Copy key structure from `en.json`
  3. Translate values; app auto-loads all locale JSON files

## Publish / Unpublish Behavior

- On publish:
  - Validates bot configuration
  - Generates `agent-pack.yaml`, `config.env`, and `k8s-manifest.yaml`
  - Saves artifacts under `generated/<bot-slug>/<timestamp>/`
  - Records publish run status in DB
  - If `ENABLE_K8S_APPLY=true`, runs `kubectl apply` and waits for rollout

- On unpublish:
  - If `ENABLE_K8S_APPLY=true`, executes delete for deployment/service/ingress
  - Records run in DB and returns bot to `draft` state

## MCP Integrations Included

- `github`
- `weather`
- `wikipedia`

Selected MCP IDs are persisted per bot and injected into generated `agent-pack.yaml`.

## Limitations (MVP)

- No OAuth provider yet (email/password only)
- RAG currently stores URL metadata; does not ingest files into vector DB yet
- Kubernetes apply requires local `kubectl` installation and cluster connectivity

## Deployment

### Docker
The project includes a multi-stage `Dockerfile` for minimal production images.
```bash
docker build -t persona-creator .
docker run -p 3000:3000 persona-creator
```

### Kubernetes
Manifests are provided in the `k8s/` directory. They include:
- **Deployment**: Single replica webapp.
- **Service**: Internal ClusterIP service.
- **PVCs**: Persistent storage for SQLite, uploads, and generated files.

To deploy manually:
```bash
kubectl apply -k k8s/
```

### CI/CD
A GitHub Actions workflow is available in `.github/workflows/deploy-webapp.yml`. It automates:
1. Building the Docker image.
2. Pushing to Docker Hub.
3. Updating the K8s manifests and applying them.

**Required GitHub Secrets:**
- `DOCKERHUB_USERNAME`: Your Docker Hub username.
- `DOCKERHUB_TOKEN`: Your Docker Hub personal access token.
- `KUBECONFIG`: Your cluster's kubeconfig file.

## Suggested Demo Flow

1. Register and login
2. Create a bot with persona/service/prompt, choose 2+ MCP integrations
3. Save bot and open detail page
4. Publish bot (artifact generation + status)
5. Open generated public URL
6. Unpublish bot
