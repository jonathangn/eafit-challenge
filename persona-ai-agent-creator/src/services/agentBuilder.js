'use strict';
const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');

const db         = require('../db/sqlite');
const generatedDir = process.env.GENERATED_DIR || './generated';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** MCP catalog shown in the UI (Agent Skills) */
const mcpCatalog = [
  { id: 'memory',    icon: '🧠', nameKey: 'mcp.memory.name', descriptionKey: 'mcp.memory.description' },
  { id: 'weather',   icon: '🌤️', nameKey: 'mcp.weather.name',  descriptionKey: 'mcp.weather.description' },
  { id: 'wikipedia', icon: '📚', nameKey: 'mcp.wikipedia.name', descriptionKey: 'mcp.wikipedia.description' },
  { id: 'time',      icon: '⏰', nameKey: 'mcp.time.name',  descriptionKey: 'mcp.time.description' },
  { id: 'fetch',     icon: '🌐', nameKey: 'mcp.fetch.name',  descriptionKey: 'mcp.fetch.description' },
];

/** Full MCP server config objects (used when generating agent-pack.yaml) */
const mcpConfigMap = {
  memory:    { name: 'memory',    transport: 'stdio', command: 'node', args: ['/app/scripts/memory-server-limited.js'], toolAccess: { default: 'public' } },
  weather:   { name: 'weather',   transport: 'stdio', command: 'npx', args: ['-y', 'open-meteo-mcp-server'], toolAccess: { default: 'public' } },
  wikipedia: { name: 'wikipedia', transport: 'stdio', command: 'npx', args: ['-y', 'wikipedia-mcp-server'], toolAccess: { default: 'public' } },
  time:      { name: 'time',      transport: 'stdio', command: 'npx', args: ['-y', 'mcp-time-server'], toolAccess: { default: 'public' } },
  fetch:     { name: 'fetch',     transport: 'stdio', command: 'npx', args: ['-y', 'mcp-fetch-server'], toolAccess: { default: 'public' } },
};

/** Prompt hints injected per tool so the LLM knows when to use each one */
const mcpPromptInjections = {
  memory:    '- Memory: You have a limited knowledge graph. Store ONLY short personal facts (max 200 chars per observation). NEVER store books, articles, or long text. Format: create_entities with entities array of [name, entityType, observations]. At START of conversation, read memory once. Do NOT re-read unless the user references past info.',
  weather:   '- Weather: Get real-time weather via Open-Meteo. Query ONCE. Limit forecast to 5 days max. Respond with a brief summary.',
  wikipedia: '- Wikipedia: Search ONCE. Read the summary section only. Respond with a 2-3 sentence summary. Do NOT fetch full articles.',
  time:      '- Time: Real-time clock/timezone. Query ONCE for a single time. No ranges or lists.',
  fetch:     '- Web Access: Fetch a URL ONCE. Truncate to first 3000 chars. Summarize in 3-4 sentences. Do NOT fetch the same URL twice.',
};

/** Default free servers always injected regardless of user selection */
const DEFAULT_SERVERS = [];

/**
 * Build the agent-pack.yaml content for a bot and persist it to disk.
 * Returns { agentPack, yamlStr, botDir }.
 */
function buildAgentPack(bot) {
  const finalServers = Array.from(new Set([...(bot.mcp_servers || []), ...DEFAULT_SERVERS]));

  let augmentedPrompt = bot.prompt;

  if (!augmentedPrompt) {
    const name = bot.persona_name || bot.service_name || 'Assistant';
    const role = bot.persona_profession || bot.service_description || 'Digital Assistant';
    const bio = bot.persona_description || 'A helpful, intelligent assistant.';

    let toneInstructions = '';
    const tones = Array.isArray(bot.tones) ? bot.tones : (typeof bot.tones === 'string' ? bot.tones.split(',').filter(Boolean) : []);

    if (tones.includes('friendly')) {
      toneInstructions += '- Warm, enthusiastic, and empathetic. Use friendly conversational markers and sound highly approachable.\n';
    }
    if (tones.includes('professional')) {
      toneInstructions += '- Highly professional, formal, and authoritative. Use refined language and maintain a respectful, polished demeanor.\n';
    }
    if (tones.includes('concise')) {
      toneInstructions += '- Exceptionally brief, direct, and to-the-point. Avoid fluff or filler words.\n';
    }
    if (tones.includes('creative')) {
      toneInstructions += '- Imaginative, expressive, and engaging. Feel free to use rich descriptions and vivid analogies.\n';
    }
    if (!toneInstructions) {
      toneInstructions += '- Friendly, helpful, balanced, and conversational.\n';
    }

    augmentedPrompt = `You are ${name}, working as a ${role}.\nYou are a helpful assistant.\n\n### Personality Bio\n${bio}\n\n### Communication Style & Guidelines\nAlways align your responses with the following tones:\n${toneInstructions}`;
  }

  // Plain-text rule — Hologram does not render markdown
  augmentedPrompt += '\n\nIMPORTANT: Always respond in plain text. Do NOT use markdown formatting (no **, no #, no bullet hyphens, no backticks, no tables). Write naturally as if speaking, using simple line breaks when needed.';

  const toolInstructions = finalServers
    .map(id => mcpPromptInjections[id])
    .filter(Boolean)
    .join('\n');

  if (toolInstructions) {
    augmentedPrompt += `\n\n### Agent Tools & Capabilities\nALWAYS use your available tools when relevant:\n${toolInstructions}`;
  }

  // Safety: tell the LLM to stop calling tools after getting results
  augmentedPrompt += '\n\nCRITICAL: After calling a tool and receiving its result, use the result to answer the user immediately. Do NOT call additional tools unless the first result was clearly insufficient. Keep tool calls to a minimum. If a tool returns empty results, answer based on your existing knowledge rather than calling another tool.';

  // Response length guardrail
  augmentedPrompt += '\n\nCONCISENESS: Keep all responses brief. For weather: 1-2 sentences. For Wikipedia: 2-3 sentence summary. For fetched pages: 3-4 sentence summary. For memory: single sentence. Never output raw tool data verbatim. If a tool returns a large result, summarize it rather than repeating it.';

  const agentPack = {
    metadata: {
      id:              bot.slug,
      displayName:     bot.persona_name || bot.service_name,
      description:     bot.persona_description || bot.service_description,
      defaultLanguage: bot.language || 'es',
      tags: ['eafit', 'persona', 'agent'],
    },
    languages: {
      en: {
        greetingMessage: `Hello! I'm ${bot.persona_name || bot.service_name}, ready to help you. How can I assist you today?`,
        systemPrompt: augmentedPrompt,
        strings: {
          ROOT_TITLE: bot.persona_name || bot.service_name,
          LOGOUT: 'Logout',
          CREDENTIAL: 'Authenticate',
          WELCOME: `Welcome! I am ${bot.persona_name || bot.service_name}, ready to help you.`,
          AUTH_REQUIRED: 'Authentication is required to access this feature.',
          AUTH_SUCCESS: 'Authentication completed successfully. You can now access all features.',
          AUTH_SUCCESS_NAME: 'Authentication successful. Welcome, {name}! You can now access all features.',
          WAITING_CREDENTIAL: 'Waiting for you to complete the credential process...',
          AUTH_PROCESS_STARTED: 'Authentication process has started. Please respond to the credential request.',
          STATS_ERROR: 'Sorry, we could not retrieve your statistics at the moment.',
          ERROR_MESSAGES: 'The service is not available at the moment. Please try again later.',
          LOGOUT_CONFIRMATION: 'You have been logged out successfully.',
          MCP_CONFIG_MENU: 'MCP Server Config',
          MCP_CONFIG_ABORT: 'Abort Configuration',
          MCP_CONFIG_SELECT_SERVER: 'Select the MCP server you want to configure:',
          MCP_CONFIG_SAVED: 'Configuration for "{server}" saved and verified successfully.',
          MCP_CONFIG_INVALID: 'Connection test failed for "{server}". Please try configuring again.',
          MCP_CONFIG_ERROR: 'An error occurred while saving configuration. Please try again.',
          MCP_CONFIG_ABORTED: 'Configuration cancelled.',
        },
      },
      es: {
        greetingMessage: `¡Hola! Soy ${bot.persona_name || bot.service_name}, listo para ayudarte. ¿En qué puedo ayudarte hoy?`,
        systemPrompt: augmentedPrompt,
        strings: {
          ROOT_TITLE: bot.persona_name || bot.service_name,
          LOGOUT: 'Cerrar sesión',
          CREDENTIAL: 'Autenticar',
          WELCOME: `¡Bienvenido! Soy ${bot.persona_name || bot.service_name}, listo para ayudarte.`,
          AUTH_REQUIRED: 'Se requiere autenticación para acceder a esta función.',
          AUTH_SUCCESS: 'Autenticación completada con éxito. Ahora puedes acceder a todas las funciones.',
          AUTH_SUCCESS_NAME: 'Autenticación completada con éxito. ¡Bienvenido, {name}! Ahora puedes acceder a todas las funciones.',
          WAITING_CREDENTIAL: 'Esperando que completes el proceso de credencial...',
          AUTH_PROCESS_STARTED: 'El proceso de autenticación ha comenzado. Por favor, responde a la solicitud de credencial.',
          STATS_ERROR: 'Lo sentimos, no pudimos obtener tus estadísticas en este momento.',
          ERROR_MESSAGES: 'El servicio no está disponible en este momento. Por favor, intenta de nuevo más tarde.',
          LOGOUT_CONFIRMATION: 'Has cerrado sesión exitosamente.',
          MCP_CONFIG_MENU: 'Configurar Servidor MCP',
          MCP_CONFIG_ABORT: 'Cancelar Configuración',
          MCP_CONFIG_SELECT_SERVER: 'Selecciona el servidor MCP que deseas configurar:',
          MCP_CONFIG_SAVED: 'Configuración de "{server}" guardada y verificada correctamente.',
          MCP_CONFIG_INVALID: 'La prueba de conexión falló para "{server}". Por favor, intenta configurar de nuevo.',
          MCP_CONFIG_ERROR: 'Ocurrió un error al guardar la configuración. Por favor, inténtalo de nuevo.',
          MCP_CONFIG_ABORTED: 'Configuración cancelada.',
        },
      },
    },
    llm: {
      provider:    'openai',
      model:       'deepseek-chat',
      baseUrl:     'https://api.deepseek.com/v1',
      temperature: 0.2,
      maxIterations: 8,
      agentPrompt: augmentedPrompt,
    },
    rag: {
      provider: 'langchain',
      docsPath: '/app/rag/docs',
      remoteUrls: bot.rag_urls || [],
      vectorStore: {
        type: 'redis',
        indexName: bot.slug,
      },
    },
    memory: {
      backend: 'redis',
      window: 20,
      redisUrl: 'redis://personal-aissistant-redis:6379',
    },
    flows: {
      welcome: {
        enabled: true,
        sendOnProfile: true,
        templateKey: 'greetingMessage',
      },
      authentication: {
        enabled: true,
        credentialDefinitionId: '${CREDENTIAL_DEFINITION_ID}',
        adminAvatars: [],
      },
      menu: {
        items: [
          { id: 'authenticate', labelKey: 'CREDENTIAL', action: 'authenticate', visibleWhen: 'unauthenticated' },
          { id: 'logout', labelKey: 'LOGOUT', action: 'logout', visibleWhen: 'authenticated' },
          { id: 'mcp-config', labelKey: 'MCP_CONFIG_MENU', action: 'mcp-config', visibleWhen: 'notConfiguring' },
          { id: 'abort-config', labelKey: 'MCP_CONFIG_ABORT', action: 'abort-config', visibleWhen: 'configuring' },
        ],
      },
    },
    mcp: {
      servers: finalServers.map(id => mcpConfigMap[id]).filter(Boolean),
    },
    integrations: {
      vsAgent: {
        adminUrl: 'http://localhost:3000',
      },
      postgres: {
        host: 'personal-aissistant-postgres',
        user: 'personal_aissistant_db',
        password: 'changeme',
        dbName: 'personal-aissistant',
      },
    },
  };

  const yamlStr = yaml.dump(agentPack);
  const botDir  = path.join(generatedDir, bot.slug);
  ensureDir(botDir);
  fs.writeFileSync(path.join(botDir, 'agent-pack.yaml'), yamlStr);

  return { agentPack, yamlStr, botDir };
}

/**
 * Record a publish or unpublish event.
 * Returns the updated bot record.
 */
function recordPublish(bot, { action, publicUrl, status, details }) {
  const now = new Date().toISOString();

  if (action === 'publish') {
    const { yamlStr } = buildAgentPack(bot);
    db.push('bot_versions', {
      version_id:  crypto.randomBytes(16).toString('hex'),
      bot_id:      bot.id,
      created_at:  now,
      yaml_config: yamlStr,
    });
  }

  db.push('publish_runs', {
    id:         crypto.randomBytes(16).toString('hex'),
    bot_id:     bot.id,
    action,
    status,
    details,
    created_at: now,
  });

  db.update('bots', b => b.id === bot.id, {
    public_url:     publicUrl || '',
    publish_status: status === 'unpublished' ? 'draft' : (status === 'applied' ? 'published' : 'pending_apply'),
    updated_at:     now,
  });
}

/**
 * Generate a K8s manifest for the agent and apply it.
 */
async function deployToK8s(bot, namespace, baseDomain) {
  const { botDir } = buildAgentPack(bot);
  const manifestPath = path.join(botDir, 'k8s-manifest.yaml');
  
  const ingressHost = `${bot.slug}.${baseDomain}`;
  const tlsSecret = `${ingressHost}-cert`;

  const manifest = `
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: agent-data-${bot.slug}
  namespace: ${namespace}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: csi-cinder-high-speed
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agent-${bot.slug}
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: agent-${bot.slug}
  template:
    metadata:
      labels:
        app: agent-${bot.slug}
    spec:
      containers:
      - name: chatbot
        image: io2060/hologram-generic-ai-agent-app:v1.11.2
        ports:
        - containerPort: 3003
        env:
        - name: APP_PORT
          value: "3003"
        - name: AGENT_PACK_PATH
          value: "/app/agent-packs/${bot.slug}"
        - name: REDIS_URL
          value: "redis://localhost:6379"
        - name: POSTGRES_HOST
          value: "personal-aissistant-postgres.${namespace}"
        - name: POSTGRES_USER
          value: "personal_aissistant_db"
        - name: POSTGRES_DB
          value: "personal-aissistant"
        - name: POSTGRES_DB_NAME
          value: "personal-aissistant"
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: personal-aissistant-postgres-secret
              key: POSTGRES_PASSWORD
        - name: VECTOR_STORE
          value: "redis"
        - name: VECTOR_INDEX_NAME
          value: "agent-${bot.slug}"
        - name: LLM_PROVIDER
          value: "openai"
        - name: OPENAI_MODEL
          value: "deepseek-chat"
        - name: OPENAI_BASE_URL
          value: "https://api.deepseek.com/v1"
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: personal-aissistant-chatbot-secret
              key: OPENAI_API_KEY
        - name: RAG_PROVIDER
          value: "langchain"
        - name: AGENT_MEMORY_BACKEND
          value: "redis"
        - name: AGENT_MEMORY_WINDOW
          value: "20"
        - name: VS_AGENT_ADMIN_URL
          value: "http://localhost:3000"
        - name: CREDENTIAL_DEFINITION_ID
          value: "did:webvh:QmPZBrmehNXxY4eRL2a9F52sCfkQfToPHM8R427sNS2F1N:avatar.eafit.testnet.verana.network/resources/zQmdzYfqKe6ypc9NbRMHbCFvgnrqCwbWjBK2odKYrRePaTu"
        - name: VS_AGENT_ORG_ADMIN_URL
          value: "https://admin.organization.eafit.testnet.verana.network"
        - name: LOG_LEVEL
          value: "3"
        - name: MEMORY_DATA_FILE
          value: "/app/data/memory.json"
        volumeMounts:
        - name: config
          mountPath: /app/agent-packs/${bot.slug}/agent-pack.yaml
          subPath: agent-pack.yaml
        - name: data
          mountPath: /app/data
        - name: scripts
          mountPath: /app/scripts/memory-server-limited.js
          subPath: memory-server-limited.js
      - name: vs-agent
        image: veranalabs/vs-agent:v1.9.2
        ports:
        - containerPort: 3000
          name: admin
        - containerPort: 3001
          name: public
        env:
        - name: ADMIN_PORT
          value: "3000"
        - name: REDIS_HOST
          value: "localhost"
        - name: AGENT_PUBLIC_DID
          value: "did:webvh:${bot.slug}.${baseDomain}"
        - name: AGENT_WALLET_ID
          value: "agent-${bot.slug}"
        - name: AGENT_WALLET_KEY
          value: "${Buffer.from(bot.id).toString('base64').substring(0, 32)}"
        - name: AGENT_LOG_LEVEL
          value: "3"
        - name: AGENT_LABEL
          value: "${bot.persona_name || bot.service_name}"
        - name: DIDCOMM_LABEL
          value: "${bot.persona_name || bot.service_name}"
        - name: USE_CORS
          value: "true"
        - name: EVENTS_BASE_URL
          value: "http://localhost:3003"
        - name: DIDCOMM_INVITATION_IMAGE_URL
          value: "${bot.photo_url ? 'https://persona.team-f.teams.eafit.testnet.verana.network' + bot.photo_url : 'https://png.klev.club/uploads/posts/2024-04/png-klev-club-l936-p-milii-robot-png-16.png'}"
        - name: AGENT_LOGO_URL
          value: "${bot.photo_url ? 'https://persona.team-f.teams.eafit.testnet.verana.network' + bot.photo_url : 'https://png.klev.club/uploads/posts/2024-04/png-klev-club-l936-p-milii-robot-png-16.png'}"
        - name: VS_AGENT_ORG_ADMIN_URL
          value: "https://admin.organization.eafit.testnet.verana.network"
        volumeMounts:
        - name: data
          mountPath: /root/.afj/data
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        resources:
          requests:
            cpu: '50m'
            memory: '64Mi'
          limits:
            cpu: '200m'
            memory: '128Mi'
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: agent-data-${bot.slug}
      - name: config
        configMap:
          name: agent-config-${bot.slug}
      - name: scripts
        configMap:
          name: agent-scripts-${bot.slug}
---
apiVersion: v1
kind: Service
metadata:
  name: agent-${bot.slug}
  namespace: ${namespace}
spec:
  selector:
    app: agent-${bot.slug}
  ports:
  - name: public
    port: 80
    targetPort: 3001
  - name: admin
    port: 3000
    targetPort: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: agent-${bot.slug}
  namespace: ${namespace}
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - ${ingressHost}
    secretName: ${tlsSecret}
  rules:
  - host: ${ingressHost}
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: agent-${bot.slug}
            port:
              number: 80
`;

  // 1. Create ConfigMap for the agent-pack
  const { yamlStr } = buildAgentPack(bot);
  const { execSync } = require('child_process');
  
  try {
    // Delete old configmap if exists
    try { execSync(`kubectl delete configmap agent-config-${bot.slug} -n ${namespace} --ignore-not-found`); } catch(e){}
    
    // Create new configmap
    const configMapManifest = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-config-${bot.slug}
  namespace: ${namespace}
data:
  agent-pack.yaml: |
${yamlStr.split('\n').map(l => '    ' + l).join('\n')}
`;
    fs.writeFileSync(path.join(botDir, 'configmap.yaml'), configMapManifest);
    execSync(`kubectl apply -f ${path.join(botDir, 'configmap.yaml')} -n ${namespace}`);
    
    // 1b. Create ConfigMap for the memory server script
    const memoryScriptPath = path.join(__dirname, 'memory-server-limited.js');
    const memoryScriptContent = fs.readFileSync(memoryScriptPath, 'utf8');
    const scriptConfigMapManifest = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: agent-scripts-${bot.slug}
  namespace: ${namespace}
data:
  memory-server-limited.js: |
${memoryScriptContent.split('\n').map(l => '    ' + l).join('\n')}
`;
    const scriptCmPath = path.join(botDir, 'scripts-configmap.yaml');
    fs.writeFileSync(scriptCmPath, scriptConfigMapManifest);
    try { execSync(`kubectl delete configmap agent-scripts-${bot.slug} -n ${namespace} --ignore-not-found`); } catch(e){}
    execSync(`kubectl apply -f ${scriptCmPath} -n ${namespace}`);
    
    // 2. Apply main manifest
    fs.writeFileSync(manifestPath, manifest);
    execSync(`kubectl apply -f ${manifestPath} -n ${namespace}`);
    
    console.log(`🚀 Successfully deployed agent ${bot.slug} to K8s`);

    // 3. Set up Verana trust chain asynchronously (don't block the publish response)
    setupTrustChain(bot, namespace, botDir).catch(err => {
      console.error(`⚠️  Trust chain setup failed for ${bot.slug}: ${err.message}`);
      require('fs').writeFileSync(require('path').join(botDir, 'trust-chain-error.json'), JSON.stringify({
        error: err.message,
        stack: err.stack,
        time: new Date().toISOString()
      }, null, 2));
    });

    return true;
  } catch (err) {
    console.error(`❌ K8s Deployment Failed for ${bot.slug}: ${err.message}`);
    throw err;
  }
}

/**
 * Establish the Verana trust chain for a newly deployed agent.
 * Mirrors what the GHA workflow does for the avatar:
 *   1. Wait for vs-agent admin API to become ready (in-cluster)
 *   2. Retrieve the agent's DID
 *   3. Discover the Service VTJSC from the ECS trust registry
 *   4. Issue a Service credential from the organization admin (in-cluster)
 *   5. Link the signed credential on the agent
 */
async function setupTrustChain(bot, namespace, botDir) {
  const ECS_TR_URL   = 'https://ecs-trust-registry.testnet.verana.network';
  const ORG_ADMIN    = 'https://admin.organization.eafit.testnet.verana.network';
  const AGENT_ADMIN  = `http://agent-${bot.slug}.${namespace}:3000`;

  // -- Helper: simple fetch with timeout --
  const fetchJson = async (url, opts = {}, timeoutMs = 10000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} from ${url} - ${text}`);
      }
      return res.json();
    } finally { clearTimeout(t); }
  };

  // 1. Wait up to 3 minutes for agent admin to be ready
  console.log(`⏳ Waiting for agent ${bot.slug} admin API...`);
  let agentDid = null;
  for (let i = 0; i < 36; i++) {
    try {
      const info = await fetchJson(`${AGENT_ADMIN}/v1/agent`);
      if (info?.publicDid) { agentDid = info.publicDid; break; }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  if (!agentDid) throw new Error('Agent admin API did not become ready in time');
  console.log(`✅ Agent DID: ${agentDid}`);

  // 2. Check if org-issued Service credential already linked
  // (self-issued VTCs from SELF_ISSUED_VTC_* env vars should NOT match)
  try {
    const orgDidUrl = `https://${bot.slug}.${process.env.BASE_DOMAIN || 'agents.team-f.teams.eafit.testnet.verana.network'}/.well-known/did.json`;
    const didDoc = await fetchJson(orgDidUrl);
    const orgIssuer = 'organization.eafit';
    for (const svc of (didDoc.service || [])) {
      if (svc.type !== 'LinkedVerifiablePresentation') continue;
      try {
        const vp = await fetchJson(svc.serviceEndpoint, {}, 5000);
        const vcIssuer = vp?.verifiableCredential?.[0]?.issuer || '';
        if (vcIssuer.includes(orgIssuer)) {
          console.log('✅ Org-issued Service credential already linked — skipping');
          return;
        }
      } catch { /* VP not accessible, check next service entry */ }
    }
  } catch { /* DID doc not yet propagated, continue */ }

  // 3. Discover Service VTJSC from ECS trust registry
  const ecsDid   = await fetchJson(`${ECS_TR_URL}/.well-known/did.json`);
  const vpSvc    = (ecsDid.service || []).find(s =>
    s.type === 'LinkedVerifiablePresentation' && String(s.id).includes('service-jsc-vp'));
  if (!vpSvc) throw new Error('Service VTJSC not found in ECS DID document');

  const vp       = await fetchJson(vpSvc.serviceEndpoint);
  const jscUrl   = vp?.verifiableCredential?.[0]?.id;
  if (!jscUrl) throw new Error('Could not extract VTJSC URL from VP');
  console.log(`✅ Service VTJSC: ${jscUrl}`);

  // 4. Build logo data URI from uploaded photo (or default)
  let logoDataUri = '';
  if (bot.photo_url) {
    try {
      const filePath = path.join(process.env.UPLOAD_DIR || './uploads', path.basename(bot.photo_url));
      const data = fs.readFileSync(filePath);
      const ext  = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      logoDataUri = `data:${mime};base64,${data.toString('base64')}`;
    } catch { /* fallback below */ }
  }
  if (!logoDataUri) {
    try {
      const r = await fetch('https://png.klev.club/uploads/posts/2024-04/png-klev-club-l936-p-milii-robot-png-16.png');
      const buf = Buffer.from(await r.arrayBuffer());
      logoDataUri = `data:image/png;base64,${buf.toString('base64')}`;
    } catch { logoDataUri = ''; }
  }

  // 5. Issue Service credential from org admin (in-cluster)
  const claims = {
    id:                   agentDid,
    name:                 bot.persona_name || bot.service_name,
    type:                 'AIAgent',
    description:          bot.persona_description || bot.service_description || 'AI Agent created via Persona Creator',
    logo:                 logoDataUri,
    minimumAgeRequired:   bot.minimum_age || 1,
    termsAndConditions:   'https://verana.io/page/terms-of-service',
    privacyPolicy:        'https://verana.io/page/privacy-policy',
  };
  const issued = await fetchJson(`${ORG_ADMIN}/v1/vt/issue-credential`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'jsonld', did: agentDid, jsonSchemaCredentialId: jscUrl, claims }),
  }, 30000);
  const signedCred = issued?.credential || issued;
  console.log(`✅ Service credential issued from org`);

  // 6. Delete any stale linked credential then link the new one
  await fetch(`${AGENT_ADMIN}/v1/vt/linked-credentials`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialSchemaId: jscUrl }),
  }).catch(() => {});

  await fetchJson(`${AGENT_ADMIN}/v1/vt/linked-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schemaBaseId: 'service', credential: signedCred }),
  }, 15000);

  console.log(`🔐 Trust chain established for agent ${bot.slug}`);
  fs.writeFileSync(path.join(botDir, 'trust-chain.json'), JSON.stringify({ agentDid, jscUrl, linkedAt: new Date().toISOString() }, null, 2));
}

/**
 * Remove an agent from K8s.
 */
async function undeployFromK8s(bot, namespace) {
  const { execSync } = require('child_process');
  try {
    execSync(`kubectl delete deployment agent-${bot.slug} -n ${namespace} --ignore-not-found`);
    execSync(`kubectl delete service agent-${bot.slug} -n ${namespace} --ignore-not-found`);
    execSync(`kubectl delete ingress agent-${bot.slug} -n ${namespace} --ignore-not-found`);
    execSync(`kubectl delete configmap agent-config-${bot.slug} -n ${namespace} --ignore-not-found`);
    console.log(`🗑️ Successfully undeployed agent ${bot.slug} from K8s`);
    return true;
  } catch (err) {
    console.error(`❌ K8s Undeploy Failed for ${bot.slug}: ${err.message}`);
    return false;
  }
}

module.exports = { mcpCatalog, mcpConfigMap, mcpPromptInjections, buildAgentPack, recordPublish, deployToK8s, undeployFromK8s };
