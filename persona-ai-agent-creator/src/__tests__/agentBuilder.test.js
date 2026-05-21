const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

let mcpCatalog, mcpConfigMap, mcpPromptInjections, buildAgentPack, recordPublish;
function loadAgentBuilder() {
  const mod = require('../services/agentBuilder');
  mcpCatalog = mod.mcpCatalog;
  mcpConfigMap = mod.mcpConfigMap;
  mcpPromptInjections = mod.mcpPromptInjections;
  buildAgentPack = mod.buildAgentPack;
  recordPublish = mod.recordPublish;
  return mod;
}
loadAgentBuilder();

const GENERATED_DIR = path.join(__dirname, '..', '..', 'generated-test');
const PUBLISH_DB = path.join(__dirname, '..', '..', 'data', 'test-publish.sqlite');

beforeAll(() => {
  process.env.GENERATED_DIR = GENERATED_DIR;
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
});

afterAll(() => {
  fs.rmSync(GENERATED_DIR, { recursive: true, force: true });
  for (const f of [PUBLISH_DB, PUBLISH_DB + '-wal', PUBLISH_DB + '-shm']) {
    try { fs.unlinkSync(f); } catch {}
  }
});

describe('mcpCatalog', () => {
  it('is an array with expected entries', () => {
    expect(Array.isArray(mcpCatalog)).toBe(true);
    expect(mcpCatalog.length).toBeGreaterThanOrEqual(5);
  });

  it('each entry has id, icon, nameKey, descriptionKey', () => {
    for (const entry of mcpCatalog) {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('icon');
      expect(entry).toHaveProperty('nameKey');
      expect(entry).toHaveProperty('descriptionKey');
    }
  });

  it('includes known MCPs', () => {
    const ids = mcpCatalog.map(e => e.id);
    expect(ids).toContain('memory');
    expect(ids).toContain('weather');
    expect(ids).toContain('wikipedia');
    expect(ids).toContain('time');
    expect(ids).toContain('fetch');
  });

  it('all catalog IDs have a matching config', () => {
    for (const entry of mcpCatalog) {
      expect(mcpConfigMap[entry.id]).toBeDefined();
      expect(mcpPromptInjections[entry.id]).toBeDefined();
    }
  });
});

describe('mcpConfigMap', () => {
  it('contains config for all catalog entries', () => {
    for (const entry of mcpCatalog) {
      const cfg = mcpConfigMap[entry.id];
      expect(cfg).toHaveProperty('name');
      expect(cfg).toHaveProperty('transport');
      expect(cfg).toHaveProperty('command');
      expect(cfg).toHaveProperty('args');
      expect(cfg).toHaveProperty('toolAccess');
    }
  });
});

describe('buildAgentPack', () => {
  const MIN_BOT = {
    id: 'test-id-123',
    slug: 'test-agent',
    user_id: 'user-1',
    service_name: 'Test Service',
    service_description: 'A test service',
    persona_name: 'Test Agent',
    persona_profession: 'Tester',
    persona_description: 'I am a test agent',
    prompt: 'You are a test assistant.',
    mcp_servers: ['weather', 'time'],
    rag_urls: ['https://example.com/docs'],
    photo_url: '',
    minimum_age: 13,
    public_url: '',
    publish_status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('produces an agentPack object with correct structure', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    expect(agentPack).toHaveProperty('metadata');
    expect(agentPack).toHaveProperty('languages');
    expect(agentPack).toHaveProperty('llm');
    expect(agentPack).toHaveProperty('rag');
    expect(agentPack).toHaveProperty('memory');
    expect(agentPack).toHaveProperty('flows');
    expect(agentPack).toHaveProperty('mcp');
    expect(agentPack).toHaveProperty('integrations');
  });

  it('metadata uses bot persona name', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    expect(agentPack.metadata.displayName).toBe('Test Agent');
    expect(agentPack.metadata.description).toBe('I am a test agent');
  });

  it('LLM uses deepseek model', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    expect(agentPack.llm.provider).toBe('openai');
    expect(agentPack.llm.model).toBe('deepseek-chat');
  });

  it('includes selected MCP servers', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    const serverNames = agentPack.mcp.servers.map(s => s.name);
    expect(serverNames).toContain('weather');
    expect(serverNames).toContain('time');
  });

  it('does not include unselected MCP servers', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    const serverNames = agentPack.mcp.servers.map(s => s.name);
    expect(serverNames).not.toContain('wikipedia');
    expect(serverNames).not.toContain('memory');
  });

  it('includes RAG URLs', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    expect(agentPack.rag.remoteUrls).toContain('https://example.com/docs');
  });

  it('appends plain-text and tool instructions to the prompt', () => {
    const { agentPack } = buildAgentPack(MIN_BOT);
    const sysPrompt = agentPack.languages.en.systemPrompt;
    expect(sysPrompt).toContain('IMPORTANT: Always respond in plain text');
    expect(sysPrompt).toContain('Weather: Get real-time weather');
    expect(sysPrompt).toContain('Time: Real-time clock/timezone');
  });

  it('produces valid YAML', () => {
    const { yamlStr } = buildAgentPack(MIN_BOT);
    expect(typeof yamlStr).toBe('string');
    const parsed = yaml.load(yamlStr);
    expect(parsed).toHaveProperty('metadata');
    expect(parsed.metadata.id).toBe('test-agent');
  });

  it('writes the YAML to disk', () => {
    const { botDir } = buildAgentPack(MIN_BOT);
    const filePath = path.join(botDir, 'agent-pack.yaml');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('test-agent');
  });

  describe('buildAgentPack edge cases', () => {
    it('uses service name when persona name is empty', () => {
      const bot = { ...MIN_BOT, persona_name: '', persona_description: '' };
      const { agentPack } = buildAgentPack(bot);
      expect(agentPack.metadata.displayName).toBe('Test Service');
      expect(agentPack.metadata.description).toBe('A test service');
    });

    it('handles no MCP servers selected', () => {
      const bot = { ...MIN_BOT, mcp_servers: [] };
      const { agentPack } = buildAgentPack(bot);
      expect(agentPack.mcp.servers).toEqual([]);
    });

    it('handles empty prompt', () => {
      const bot = { ...MIN_BOT, prompt: '' };
      const { agentPack } = buildAgentPack(bot);
      const sysPrompt = agentPack.languages.en.systemPrompt;
      expect(sysPrompt).toContain('You are a helpful assistant');
    });

    it('deduplicates MCP servers', () => {
      const bot = { ...MIN_BOT, mcp_servers: ['weather', 'weather', 'time'] };
      const { agentPack } = buildAgentPack(bot);
      expect(agentPack.mcp.servers.length).toBe(2);
    });

    it('does not include tool instructions when no MCP servers selected', () => {
      const bot = { ...MIN_BOT, mcp_servers: [] };
      const { agentPack } = buildAgentPack(bot);
      const sysPrompt = agentPack.languages.en.systemPrompt;
      expect(sysPrompt).not.toContain('Agent Tools');
    });
  });

  describe('recordPublish', () => {
    let db;
    let botId;

    beforeAll(() => {
      process.env.DATABASE_PATH = PUBLISH_DB;
      for (const f of [PUBLISH_DB, PUBLISH_DB + '-wal', PUBLISH_DB + '-shm']) {
        try { fs.unlinkSync(f); } catch {}
      }
      delete require.cache[require.resolve('../db/sqlite')];
      delete require.cache[require.resolve('../services/agentBuilder')];
      db = require('../db/sqlite');
      loadAgentBuilder();
      const bot = db.push('bots', { ...MIN_BOT, id: 'publish-bot-1', slug: 'publish-test-agent' });
      botId = bot.id;
    });

    afterAll(() => {
      for (const f of [PUBLISH_DB, PUBLISH_DB + '-wal', PUBLISH_DB + '-shm']) {
        try { fs.unlinkSync(f); } catch {}
      }
    });

    it('records a publish event', () => {
      const bot = db.find('bots', b => b.id === botId);
      recordPublish(bot, {
        action: 'publish',
        publicUrl: 'https://publish-test-agent.agents.test.domain',
        status: 'applied',
        details: 'Deployed successfully',
      });
      const runs = db.filter('publish_runs', r => r.bot_id === botId);
      expect(runs.length).toBe(1);
      expect(runs[0].action).toBe('publish');
      expect(runs[0].status).toBe('applied');
    });

    it('creates a bot version on publish', () => {
      const versions = db.filter('bot_versions', v => v.bot_id === botId);
      expect(versions.length).toBe(1);
      expect(versions[0].yaml_config).toBeDefined();
      const parsed = yaml.load(versions[0].yaml_config);
      expect(parsed.metadata.id).toBe('publish-test-agent');
    });

    it('updates bot publish status and public_url', () => {
      const bot = db.find('bots', b => b.id === botId);
      expect(bot.publish_status).toBe('published');
      expect(bot.public_url).toBe('https://publish-test-agent.agents.test.domain');
    });

    it('records an unpublish event', () => {
      const bot = db.find('bots', b => b.id === botId);
      recordPublish(bot, {
        action: 'unpublish',
        publicUrl: '',
        status: 'unpublished',
        details: 'Bot unpublished by user.',
      });
      const runs = db.filter('publish_runs', r => r.bot_id === botId && r.action === 'unpublish');
      expect(runs.length).toBe(1);
    });

    it('sets bot status to draft on unpublish', () => {
      const bot = db.find('bots', b => b.id === botId);
      expect(bot.publish_status).toBe('draft');
      expect(bot.public_url).toBe('');
    });

    it('does not create a bot version on unpublish', () => {
      const versions = db.filter('bot_versions', v => v.bot_id === botId);
      expect(versions.length).toBe(1);
    });

    it('handles pending_manual_apply status', () => {
      const bot = db.find('bots', b => b.id === botId);
      recordPublish(bot, {
        action: 'publish',
        publicUrl: 'https://test.pending.domain',
        status: 'pending_manual_apply',
        details: 'K8s apply disabled',
      });
      const updatedBot = db.find('bots', b => b.id === botId);
      expect(updatedBot.publish_status).toBe('pending_apply');
    });
  });
});
