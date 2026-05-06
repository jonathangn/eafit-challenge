'use strict';
const express  = require('express');
const multer   = require('multer');
const slugify  = require('slugify');
const crypto   = require('crypto');
const fs       = require('fs');

const db                                       = require('../db/sqlite');
const { mcpCatalog, buildAgentPack, recordPublish } = require('../services/agentBuilder');

const uploadDir    = process.env.UPLOAD_DIR     || './uploads';
const teamNamespace = process.env.TEAM_NAMESPACE || 'team-f';
const baseDomain   = process.env.BASE_DOMAIN    || 'agents.team-f.teams.eafit.testnet.verana.network';
const enableK8sApply = process.env.ENABLE_K8S_APPLY === 'true';

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });
const router = express.Router();

// ── List ──────────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const bots = db.filter('bots', b => b.user_id === res.locals.currentUser.id);
  res.render('bots', { bots });
});

// ── New ───────────────────────────────────────────────────────────────────────
router.get('/new', (_req, res) => res.render('bot-new', { mcpCatalog }));

router.post('/', upload.single('photo'), (req, res) => {
  const { serviceName, serviceDescription, personaName, personaProfession,
          personaDescription, prompt, ragUrls, mcpServers } = req.body;

  const slug = slugify(serviceName, { lower: true, strict: true }) + '-' + crypto.randomBytes(4).toString('hex');

  const bot = db.push('bots', {
    id:                  crypto.randomBytes(16).toString('hex'),
    user_id:             res.locals.currentUser.id,
    slug,
    service_name:        serviceName,
    service_description: serviceDescription,
    persona_name:        personaName,
    persona_profession:  personaProfession,
    persona_description: personaDescription,
    prompt,
    rag_urls:    ragUrls    ? ragUrls.split('\n').filter(Boolean) : [],
    mcp_servers: mcpServers ? (Array.isArray(mcpServers) ? mcpServers : [mcpServers]) : [],
    public_url:     '',
    publish_status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  res.redirect(`/bots/${bot.id}`);
});

// ── View ──────────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const bot = db.find('bots', b => b.id === req.params.id && b.user_id === res.locals.currentUser.id);
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });
  res.render('bot-view', { bot });
});

// ── Edit ──────────────────────────────────────────────────────────────────────
router.get('/:id/edit', (req, res) => {
  const bot = db.find('bots', b => b.id === req.params.id && b.user_id === res.locals.currentUser.id);
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });
  res.render('bot-edit', { bot, mcpCatalog });
});

router.post('/:id', upload.single('photo'), (req, res) => {
  const bot = db.find('bots', b => b.id === req.params.id && b.user_id === res.locals.currentUser.id);
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  const { serviceName, serviceDescription, personaName, personaProfession,
          personaDescription, prompt, ragUrls, mcpServers } = req.body;

  db.update('bots', b => b.id === bot.id, {
    service_name:        serviceName,
    service_description: serviceDescription,
    persona_name:        personaName,
    persona_profession:  personaProfession,
    persona_description: personaDescription,
    prompt,
    rag_urls:    ragUrls    ? ragUrls.split('\n').filter(Boolean) : [],
    mcp_servers: mcpServers ? (Array.isArray(mcpServers) ? mcpServers : [mcpServers]) : [],
    updated_at: new Date().toISOString(),
  });

  res.redirect(`/bots/${bot.id}`);
});

// ── Publish ───────────────────────────────────────────────────────────────────
router.post('/:id/publish', (req, res) => {
  const bot = db.find('bots', b => b.id === req.params.id && b.user_id === res.locals.currentUser.id);
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  buildAgentPack(bot);

  const publicUrl = `https://${bot.slug}.${baseDomain}`;
  const status    = enableK8sApply ? 'applied' : 'pending_manual_apply';
  const details   = enableK8sApply ? `Deployed to ${teamNamespace}` : 'K8s apply disabled';

  recordPublish(bot, { action: 'publish', publicUrl, status, details });

  res.redirect(`/bots/${bot.id}?toast=published`);
});

// ── Unpublish ─────────────────────────────────────────────────────────────────
router.post('/:id/unpublish', (req, res) => {
  const bot = db.find('bots', b => b.id === req.params.id && b.user_id === res.locals.currentUser.id);
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  recordPublish(bot, { action: 'unpublish', publicUrl: '', status: 'unpublished', details: 'Bot unpublished by user.' });

  res.redirect(`/bots/${bot.id}?toast=unpublished`);
});

module.exports = router;
