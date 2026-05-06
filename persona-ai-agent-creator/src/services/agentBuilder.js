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

/** MCP catalog shown in the UI (premium integrations only) */
const mcpCatalog = [
  { id: 'github', profile: 'Developer', icon: '🐙', nameKey: 'GitHub',         descriptionKey: 'Interact with GitHub repositories (Requires Authentication).' },
  { id: 'gitlab', profile: 'Developer', icon: '🦊', nameKey: 'GitLab',         descriptionKey: 'Interact with GitLab repositories (Requires Authentication).' },
  { id: 'imap',   profile: 'Executive', icon: '📧', nameKey: 'Email (IMAP)',    descriptionKey: 'Read and draft emails directly from your webmail.' },
  { id: 'vcal',   profile: 'Executive', icon: '📅', nameKey: 'Calendar (vCal)', descriptionKey: 'Manage your schedule and check availability.' },
];

/** Full MCP server config objects (used when generating agent-pack.yaml) */
const mcpConfigMap = {
  weather:   { name: 'weather',   transport: 'stdio', command: 'npx', args: ['-y', '@smithery/weather-mcp'],                  toolAccess: { default: 'public' } },
  wikipedia: { name: 'wikipedia', transport: 'stdio', command: 'npx', args: ['-y', '@smithery/wikipedia'],                    toolAccess: { default: 'public' } },
  time:      { name: 'time',      transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-time'],       toolAccess: { default: 'public' } },
  duckduckgo:{ name: 'duckduckgo',transport: 'stdio', command: 'npx', args: ['-y', '@ericthered926/duckduckgo-mcp-server'],   toolAccess: { default: 'public' } },
  github: {
    name: 'github', transport: 'streamable-http', url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    accessMode: 'user-controlled',
    userConfig: { fields: [{ name: 'token', type: 'secret', label: { en: 'GitHub Token:', es: 'Token de GitHub:' }, headerTemplate: 'Bearer {value}' }] },
    toolAccess: { default: 'public' },
  },
  gitlab: {
    name: 'gitlab', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-gitlab'],
    env: { GITLAB_PERSONAL_ACCESS_TOKEN: '${GITLAB_PERSONAL_ACCESS_TOKEN}', GITLAB_API_URL: '${GITLAB_API_URL}' },
    toolAccess: { default: 'public' },
    userConfig: { fields: [
      { name: 'token',  type: 'secret', label: { en: 'GitLab Token:', es: 'Token de GitLab:' }, headerTemplate: 'Bearer {value}' },
      { name: 'apiUrl', type: 'string', label: { en: 'API URL:',      es: 'URL de la API:' } },
    ]},
  },
  imap: {
    name: 'imap', transport: 'stdio', command: 'npx', args: ['-y', '@paton/imap-mcp'],
    toolAccess: { default: 'public' },
    userConfig: { fields: [
      { name: 'username', type: 'string', label: { en: 'Email Username:',              es: 'Usuario de Email:' } },
      { name: 'password', type: 'secret', label: { en: 'App Password:',                es: 'Contraseña de Aplicación:' } },
      { name: 'host',     type: 'string', label: { en: 'IMAP Host (e.g. imap.gmail.com):', es: 'Host IMAP:' } },
    ]},
  },
  vcal: {
    name: 'vcal', transport: 'stdio', command: 'npx', args: ['-y', '@paton/vcal-mcp'],
    toolAccess: { default: 'public' },
    userConfig: { fields: [
      { name: 'vcalUrl', type: 'string', label: { en: 'iCal/vCal Private URL:', es: 'URL Privada de iCal/vCal:' } },
    ]},
  },
};

/** Prompt hints injected per tool so the LLM knows when to use each one */
const mcpPromptInjections = {
  weather:    '- **Weather**: If the user asks about the weather, ALWAYS use the weather tool.',
  wikipedia:  '- **Wikipedia**: Use this tool to look up facts, history, or general knowledge.',
  time:       '- **Time**: You have access to the current time and timezone conversions. Use it when discussing schedules.',
  duckduckgo: '- **Web Search**: If the user asks about current events or real-time data, ALWAYS use the duckduckgo search tool.',
  github:     '- **GitHub**: Use this tool to interact with GitHub repositories, read issues, or inspect code.',
  gitlab:     '- **GitLab**: Use this tool to interact with GitLab repositories, merge requests, or inspect code.',
  imap:       '- **Email**: If the user asks to check email or draft a message, ALWAYS use the IMAP tool.',
  vcal:       '- **Calendar**: Use this tool to check availability, upcoming meetings, and schedules.',
};

/** Default free servers always injected regardless of user selection */
const DEFAULT_SERVERS = ['time', 'duckduckgo', 'weather', 'wikipedia'];

/**
 * Build the agent-pack.yaml content for a bot and persist it to disk.
 * Returns { agentPack, yamlStr, botDir }.
 */
function buildAgentPack(bot) {
  const finalServers = Array.from(new Set([...(bot.mcp_servers || []), ...DEFAULT_SERVERS]));

  let augmentedPrompt = bot.prompt || 'You are a helpful assistant.';
  const toolInstructions = finalServers
    .map(id => mcpPromptInjections[id])
    .filter(Boolean)
    .join('\n');

  if (toolInstructions) {
    augmentedPrompt += `\n\n### Agent Tools & Capabilities\nALWAYS use your available tools when relevant:\n${toolInstructions}`;
  }

  const agentPack = {
    metadata: {
      id:              bot.slug,
      displayName:     bot.persona_name || bot.service_name,
      description:     bot.persona_description || bot.service_description,
      defaultLanguage: 'es',
    },
    llm: {
      provider:    'openai',
      model:       'google/gemma-3-4b-it:free',
      baseUrl:     'https://openrouter.ai/api/v1',
      temperature: 0.2,
      agentPrompt: augmentedPrompt,
    },
    mcp: {
      servers: finalServers.map(id => mcpConfigMap[id]).filter(Boolean),
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

module.exports = { mcpCatalog, mcpConfigMap, mcpPromptInjections, buildAgentPack, recordPublish };
