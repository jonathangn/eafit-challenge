const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const TEMP_DIR = path.join(__dirname, '..', '..', 'data', 'test-memory');
const DATA_FILE = path.join(TEMP_DIR, 'memory.json');

function sendMsg(proc, msg) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const lines = chunk.toString().trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          proc.stdout.removeListener('data', onData);
          resolve(parsed);
          return;
        } catch { }
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify(msg) + '\n');
    setTimeout(() => {
      proc.stdout.removeListener('data', onData);
      reject(new Error('Timeout waiting for response'));
    }, 3000);
  });
}

function spawnServer() {
  const proc = spawn('node', [path.join(__dirname, '..', 'services', 'memory-server-limited.js')], {
    env: { ...process.env, MEMORY_DATA_FILE: DATA_FILE },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  return proc;
}

beforeAll(() => {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  try { fs.unlinkSync(DATA_FILE); } catch {}
});

afterAll(() => {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe('Memory MCP Server', () => {
  describe('initialize', () => {
    it('responds with protocol version and capabilities', async () => {
      const proc = spawnServer();
      const res = await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(1);
      expect(res.result.protocolVersion).toBe('2024-11-05');
      expect(res.result.capabilities).toEqual({ tools: {} });
      expect(res.result.serverInfo.name).toBe('limited-memory-server');
      proc.kill();
    });
  });

  describe('notifications/initialized', () => {
    it('does not send a response', async () => {
      const proc = spawnServer();
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      await new Promise(r => setTimeout(r, 200));
      expect(true).toBe(true);
      proc.kill();
    });
  });

  describe('tools/list', () => {
    it('returns all expected tools', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(2);
      const toolNames = res.result.tools.map(t => t.name);
      expect(toolNames).toContain('read_graph');
      expect(toolNames).toContain('search_nodes');
      expect(toolNames).toContain('open_nodes');
      expect(toolNames).toContain('create_entities');
      expect(toolNames).toContain('add_observations');
      expect(toolNames).toContain('delete_entities');
      proc.kill();
    });
  });

  describe('tools/call - read_graph', () => {
    it('returns empty state initially', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'read_graph', arguments: {} }
      });
      const text = JSON.parse(res.result.content[0].text);
      expect(text.entities).toEqual({});
      expect(text.relations).toEqual([]);
      proc.kill();
    });
  });

  describe('tools/call - create_entities', () => {
    it('creates entities successfully', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [
              { name: 'Alice', entityType: 'person', observations: ['likes cats', 'from NYC'] }
            ]
          }
        }
      });
      expect(res.result.content[0].text).toBe('Entities created');
      proc.kill();
    });

    it('rejects missing entity name', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: '', entityType: 'person' }]
          }
        }
      });
      expect(res.error.code).toBe(-32602);
      expect(res.error.message).toContain('entity name is required');
      proc.kill();
    });

    it('rejects missing entityType', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Bob', entityType: '' }]
          }
        }
      });
      expect(res.error.code).toBe(-32602);
      expect(res.error.message).toContain('entityType is required');
      proc.kill();
    });

    it('truncates long observations', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const longObs = 'x'.repeat(500);
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Charlie', entityType: 'test', observations: [longObs] }]
          }
        }
      });
      const readRes = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'read_graph', arguments: {} }
      });
      const state = JSON.parse(readRes.result.content[0].text);
      expect(state.entities['Charlie'].observations[0].length).toBe(200);
      proc.kill();
    });

    it('rejects when exceeding max entities', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const manyEntities = Array.from({ length: 101 }, (_, i) => ({
        name: `Entity${i}`, entityType: 'bulk'
      }));
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'create_entities', arguments: { entities: manyEntities } }
      });
      expect(res.error.code).toBe(-32000);
      expect(res.error.message).toContain('exceeds max');
      proc.kill();
    });

    it('truncates observations per entity to MAX_OBSERVATIONS_PER_ENTITY', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const tooManyObs = Array.from({ length: 25 }, (_, i) => `obs ${i}`);
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Diana', entityType: 'person', observations: tooManyObs }]
          }
        }
      });
      const readRes = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'read_graph', arguments: {} }
      });
      const state = JSON.parse(readRes.result.content[0].text);
      expect(state.entities['Diana'].observations.length).toBe(20);
      proc.kill();
    });
  });

  describe('tools/call - search_nodes', () => {
    it('finds entities by name', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Alice', entityType: 'person', observations: ['likes cats'] }]
          }
        }
      });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'search_nodes', arguments: { query: 'Alice' } }
      });
      const data = JSON.parse(res.result.content[0].text);
      expect(data.entities.length).toBe(1);
      expect(data.entities[0].name).toBe('Alice');
      proc.kill();
    });

    it('returns empty array when no match', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'search_nodes', arguments: { query: 'nonexistent' } }
      });
      const data = JSON.parse(res.result.content[0].text);
      expect(data.entities).toEqual([]);
      proc.kill();
    });
  });

  describe('tools/call - open_nodes', () => {
    it('returns entities by names', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [
              { name: 'Alice', entityType: 'person' },
              { name: 'Bob', entityType: 'person' }
            ]
          }
        }
      });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'open_nodes', arguments: { names: ['Alice'] } }
      });
      const data = JSON.parse(res.result.content[0].text);
      expect(data.entities.length).toBe(1);
      expect(data.entities[0].name).toBe('Alice');
      proc.kill();
    });

    it('skips unknown names', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'open_nodes', arguments: { names: ['Unknown'] } }
      });
      const data = JSON.parse(res.result.content[0].text);
      expect(data.entities).toEqual([]);
      proc.kill();
    });
  });

  describe('tools/call - add_observations', () => {
    it('adds observations to existing entity', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Alice', entityType: 'person', observations: ['initial'] }]
          }
        }
      });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'add_observations',
          arguments: {
            observations: [{ entityName: 'Alice', contents: ['new obs'] }]
          }
        }
      });
      expect(res.result.content[0].text).toBe('Observations added');
      proc.kill();
    });

    it('errors for non-existent entity', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'add_observations',
          arguments: {
            observations: [{ entityName: 'Ghost', contents: ['test'] }]
          }
        }
      });
      expect(res.error.code).toBe(-32602);
      expect(res.error.message).toContain('not found');
      proc.kill();
    });

    it('truncates long observation contents', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: { entities: [{ name: 'Eve', entityType: 'person' }] }
        }
      });
      const longContent = 'x'.repeat(500);
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'add_observations',
          arguments: { observations: [{ entityName: 'Eve', contents: [longContent] }] }
        }
      });
      const readRes = await sendMsg(proc, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'read_graph', arguments: {} }
      });
      const state = JSON.parse(readRes.result.content[0].text);
      expect(state.entities['Eve'].observations[0].length).toBe(200);
      proc.kill();
    });

    it('rejects when exceeding max observations per entity', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const initialObs = Array.from({ length: 20 }, (_, i) => `obs ${i}`);
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Frank', entityType: 'person', observations: initialObs }]
          }
        }
      });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: {
          name: 'add_observations',
          arguments: { observations: [{ entityName: 'Frank', contents: ['too many'] }] }
        }
      });
      expect(res.error.code).toBe(-32000);
      expect(res.error.message).toContain('has max');
      proc.kill();
    });
  });

  describe('tools/call - delete_entities', () => {
    it('deletes entities by name', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Alice', entityType: 'person' }]
          }
        }
      });
      const delRes = await sendMsg(proc, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'delete_entities', arguments: { entityNames: ['Alice'] } }
      });
      expect(delRes.result.content[0].text).toBe('Entities deleted');

      const readRes = await sendMsg(proc, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'read_graph', arguments: {} }
      });
      const state = JSON.parse(readRes.result.content[0].text);
      expect(state.entities['Alice']).toBeUndefined();
      proc.kill();
    });
  });

  describe('tools/call - unknown tool', () => {
    it('returns method not found error', async () => {
      const proc = spawnServer();
      await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} }
      });
      expect(res.error.code).toBe(-32601);
      expect(res.error.message).toContain('Tool not found');
      proc.kill();
    });
  });

  describe('malformed input', () => {
    it('ignores invalid JSON lines', async () => {
      const proc = spawnServer();
      let sawOutput = false;
      proc.stdout.on('data', () => { sawOutput = true; });
      proc.stdin.write('not json\n');
      await new Promise(r => setTimeout(r, 200));
      expect(sawOutput).toBe(false);
      proc.kill();
    });

    it('responds to unknown method with empty result', async () => {
      const proc = spawnServer();
      const res = await sendMsg(proc, { jsonrpc: '2.0', id: 1, method: 'unknown_method' });
      expect(res.result).toEqual({});
      proc.kill();
    });
  });

  describe('state persistence', () => {
    it('persists entities to disk and reloads on restart', async () => {
      const proc1 = spawnServer();
      await sendMsg(proc1, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      await sendMsg(proc1, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'create_entities',
          arguments: {
            entities: [{ name: 'Persistent', entityType: 'test', observations: ['survives restart'] }]
          }
        }
      });
      proc1.kill();

      const proc2 = spawnServer();
      await sendMsg(proc2, { jsonrpc: '2.0', id: 1, method: 'initialize' });
      const res = await sendMsg(proc2, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'read_graph', arguments: {} }
      });
      const state = JSON.parse(res.result.content[0].text);
      expect(state.entities['Persistent']).toBeDefined();
      expect(state.entities['Persistent'].observations).toContain('survives restart');
      proc2.kill();
    });
  });
});
