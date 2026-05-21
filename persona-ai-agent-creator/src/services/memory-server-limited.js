#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.MEMORY_DATA_FILE || '/app/data/memory.json';
const MAX_OBSERVATION_LENGTH = parseInt(process.env.MEMORY_MAX_OBS_LENGTH || '200', 10);
const MAX_ENTITY_NAME_LENGTH = parseInt(process.env.MEMORY_MAX_ENTITY_NAME || '50', 10);
const MAX_ENTITIES = parseInt(process.env.MEMORY_MAX_ENTITIES || '100', 10);
const MAX_OBSERVATIONS_PER_ENTITY = parseInt(process.env.MEMORY_MAX_OBS_PER_ENTITY || '20', 10);

let state = { entities: {}, relations: [] };

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch { state = { entities: {}, relations: [] }; }
}

function save() {
  ensureDir(DATA_FILE);
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function validateEntityInput(name, entityType, observations) {
  const errors = [];
  if (!name || typeof name !== 'string') errors.push('entity name is required');
  if (name && name.length > MAX_ENTITY_NAME_LENGTH) errors.push(`entity name exceeds ${MAX_ENTITY_NAME_LENGTH} chars`);
  if (!entityType || typeof entityType !== 'string') errors.push('entityType is required');
  if (observations) {
    for (let i = 0; i < observations.length; i++) {
      if (observations[i] && observations[i].length > MAX_OBSERVATION_LENGTH) {
        observations[i] = observations[i].substring(0, MAX_OBSERVATION_LENGTH);
      }
    }
  }
  return errors;
}

load();

const rl = require('readline').createInterface({ input: process.stdin });
let requestId = null;

rl.on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'limited-memory-server', version: '1.0.0' }
      }
    });
    return;
  }

  if (msg.method === 'notifications/initialized') return;

  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'read_graph',
            description: 'Read the entire knowledge graph',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'search_nodes',
            description: 'Search for nodes in the knowledge graph by query',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Search query' }
              },
              required: ['query']
            }
          },
          {
            name: 'open_nodes',
            description: 'Open specific nodes by name',
            inputSchema: {
              type: 'object',
              properties: {
                names: { type: 'array', items: { type: 'string' }, description: 'Names of nodes to open' }
              },
              required: ['names']
            }
          },
          {
            name: 'create_entities',
            description: `Create entities. Max ${MAX_ENTITIES} total, observations capped at ${MAX_OBSERVATION_LENGTH} chars`,
            inputSchema: {
              type: 'object',
              properties: {
                entities: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: `Entity name, max ${MAX_ENTITY_NAME_LENGTH} chars` },
                      entityType: { type: 'string', description: 'Type of entity' },
                      observations: {
                        type: 'array',
                        items: { type: 'string' },
                        description: `Observations, each max ${MAX_OBSERVATION_LENGTH} chars`
                      }
                    },
                    required: ['name', 'entityType']
                  }
                }
              },
              required: ['entities']
            }
          },
          {
            name: 'add_observations',
            description: `Add observations to existing entities. Each observation capped at ${MAX_OBSERVATION_LENGTH} chars`,
            inputSchema: {
              type: 'object',
              properties: {
                observations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      entityName: { type: 'string' },
                      contents: {
                        type: 'array',
                        items: { type: 'string' }
                      }
                    },
                    required: ['entityName', 'contents']
                  }
                }
              },
              required: ['observations']
            }
          },
          {
            name: 'delete_entities',
            description: 'Delete entities by name',
            inputSchema: {
              type: 'object',
              properties: {
                entityNames: { type: 'array', items: { type: 'string' } }
              },
              required: ['entityNames']
            }
          }
        ]
      }
    });
    return;
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;

    try {
      switch (name) {
        case 'read_graph': {
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(state) }] } });
          break;
        }
        case 'search_nodes': {
          const q = (args.query || '').toLowerCase();
          const matched = Object.values(state.entities).filter(e =>
            e.name.toLowerCase().includes(q) ||
            e.entityType.toLowerCase().includes(q) ||
            (e.observations || []).some(o => o.toLowerCase().includes(q))
          );
          const result = { entities: matched, relations: state.relations.filter(r =>
            r.from.toLowerCase().includes(q) || r.to.toLowerCase().includes(q)
          ) };
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
          break;
        }
        case 'open_nodes': {
          const names = args.names || [];
          const result = { entities: names.map(n => state.entities[n]).filter(Boolean), relations: [] };
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
          break;
        }
        case 'create_entities': {
          const entities = args.entities || [];
          if (Object.keys(state.entities).length + entities.length > MAX_ENTITIES) {
            send({
              jsonrpc: '2.0', id: msg.id,
              error: { code: -32000, message: `Cannot create: exceeds max ${MAX_ENTITIES} entities. Delete some first.` }
            });
            break;
          }
          for (const ent of entities) {
            const errs = validateEntityInput(ent.name, ent.entityType, ent.observations);
            if (errs.length > 0) {
              send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: errs.join('; ') } });
              return;
            }
            if (ent.observations && ent.observations.length > MAX_OBSERVATIONS_PER_ENTITY) {
              ent.observations = ent.observations.slice(0, MAX_OBSERVATIONS_PER_ENTITY);
            }
            state.entities[ent.name] = { name: ent.name, entityType: ent.entityType, observations: ent.observations || [] };
          }
          save();
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Entities created' }] } });
          break;
        }
        case 'add_observations': {
          const obsList = args.observations || [];
          for (const item of obsList) {
            if (!state.entities[item.entityName]) {
              send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: `Entity "${item.entityName}" not found` } });
              return;
            }
            const truncated = (item.contents || []).map(c => c.length > MAX_OBSERVATION_LENGTH ? c.substring(0, MAX_OBSERVATION_LENGTH) : c);
            const existing = state.entities[item.entityName].observations || [];
            const allowed = MAX_OBSERVATIONS_PER_ENTITY - existing.length;
            if (truncated.length > allowed) {
              send({
                jsonrpc: '2.0', id: msg.id,
                error: { code: -32000, message: `Entity "${item.entityName}" has max ${MAX_OBSERVATIONS_PER_ENTITY} observations. Delete some first.` }
              });
              return;
            }
            state.entities[item.entityName].observations = [...existing, ...truncated];
          }
          save();
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Observations added' }] } });
          break;
        }
        case 'delete_entities': {
          const names = args.entityNames || [];
          for (const n of names) delete state.entities[n];
          state.relations = state.relations.filter(r => !names.includes(r.from) && !names.includes(r.to));
          save();
          send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'Entities deleted' }] } });
          break;
        }
        default:
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Tool not found: ${name}` } });
      }
    } catch (err) {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: err.message } });
    }
    return;
  }

  if (msg.id != null) {
    send({ jsonrpc: '2.0', id: msg.id, result: {} });
  }
});
