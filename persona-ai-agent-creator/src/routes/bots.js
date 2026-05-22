'use strict';
const express  = require('express');
const multer   = require('multer');
const slugify  = require('slugify');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');

const db                                       = require('../db/sqlite');
const { mcpCatalog, buildAgentPack, recordPublish, deployToK8s, undeployFromK8s } = require('../services/agentBuilder');

const uploadDir    = process.env.UPLOAD_DIR     || './uploads';
const teamNamespace = process.env.TEAM_NAMESPACE || 'team-f';
const baseDomain   = process.env.BASE_DOMAIN    || 'agents.team-f.teams.eafit.testnet.verana.network';
const enableK8sApply = process.env.ENABLE_K8S_APPLY === 'true';

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF.'));
  },
});
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
          personaDescription, prompt, ragUrls, mcpServers, photoUrl, minimumAge, tones, language } = req.body;

  const serviceNameStr = typeof serviceName === 'string' ? serviceName.trim() : '';
  const personaNameStr = typeof personaName === 'string' ? personaName.trim() : '';
  const promptStr = typeof prompt === 'string' ? prompt.trim() : '';

  const tonesArr = typeof tones === 'string' ? tones.split(',').filter(Boolean) : (Array.isArray(tones) ? tones : []);

  const sanitizedUrl = photoUrl && photoUrl.trim();
  const finalPhotoUrl = req.file
    ? `/uploads/${req.file.filename}`
    : (sanitizedUrl && !/^(javascript|data):/i.test(sanitizedUrl) ? sanitizedUrl : '');

  if (!serviceNameStr || !personaNameStr) {
    const error = res.locals.t('validation.botRequiredFields');
    return res.status(400).render('bot-new', {
      mcpCatalog,
      error,
      bot: {
        service_name: serviceName || '',
        service_description: serviceDescription || '',
        persona_name: personaName || '',
        persona_profession: personaProfession || '',
        persona_description: personaDescription || '',
        prompt: prompt || '',
        rag_urls: ragUrls ? ragUrls.split('\n').filter(Boolean) : [],
        mcp_servers: mcpServers ? (Array.isArray(mcpServers) ? mcpServers : [mcpServers]) : [],
        photo_url: finalPhotoUrl,
        minimum_age: minimumAge ? parseInt(minimumAge, 10) : 1,
        tones: tonesArr,
        language: language || 'auto'
      }
    });
  }

  const slug = slugify(serviceNameStr, { lower: true, strict: true }) + '-' + crypto.randomBytes(4).toString('hex');

  const bot = db.push('bots', {
    id:                  crypto.randomBytes(16).toString('hex'),
    user_id:             res.locals.currentUser.id,
    slug,
    service_name:        serviceNameStr,
    service_description: serviceDescription,
    persona_name:        personaNameStr,
    persona_profession:  personaProfession,
    persona_description: personaDescription,
    prompt:              promptStr,
    rag_urls:    ragUrls    ? ragUrls.split('\n').filter(Boolean) : [],
    mcp_servers: mcpServers ? (Array.isArray(mcpServers) ? mcpServers : [mcpServers]) : [],
    tones:       tonesArr,
    language:    language || 'auto',
    public_url:     '',
    publish_status: 'draft',
    photo_url:           finalPhotoUrl,
    minimum_age:         minimumAge ? parseInt(minimumAge, 10) : 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  res.redirect(`/bots/${bot.id}`);
});

// ── View ──────────────────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const bot = db.find('bots', b => String(b.id) === String(req.params.id) && String(b.user_id) === String(res.locals.currentUser.id));
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  let trustChainError = null;
  try {
    const generatedDir = process.env.GENERATED_DIR || path.join(__dirname, '../../generated');
    const botDirParent = path.join(generatedDir, bot.slug);
    if (fs.existsSync(botDirParent)) {
      const dirs = fs.readdirSync(botDirParent).filter(f => fs.statSync(path.join(botDirParent, f)).isDirectory());
      if (dirs.length > 0) {
        dirs.sort().reverse(); // newest first
        const latestDir = path.join(botDirParent, dirs[0]);
        const errorFile = path.join(latestDir, 'trust-chain-error.json');
        if (fs.existsSync(errorFile)) {
          trustChainError = JSON.parse(fs.readFileSync(errorFile, 'utf8'));
        }
      }
    }
  } catch (e) {
    console.error('Failed to read trust chain error:', e);
  }

  res.render('bot-view', {
    title: bot.service_name,
    description: `${bot.persona_profession} - ${bot.persona_description || ''}`.substring(0, 160).trim(),
    image: bot.photo_url || null,
    bot,
    agentUrl: `https://${bot.slug}.${process.env.BASE_DOMAIN || 'agents.team-f.teams.eafit.testnet.verana.network'}`,
    trustChainError
  });
});

// ── Edit ──────────────────────────────────────────────────────────────────────
router.get('/:id/edit', (req, res) => {
  const bot = db.find('bots', b => String(b.id) === String(req.params.id) && String(b.user_id) === String(res.locals.currentUser.id));
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });
  res.render('bot-edit', { bot, mcpCatalog });
});

router.post('/:id', upload.single('photo'), (req, res) => {
  const bot = db.find('bots', b => String(b.id) === String(req.params.id) && String(b.user_id) === String(res.locals.currentUser.id));
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  const { serviceName, serviceDescription, personaName, personaProfession,
          personaDescription, prompt, ragUrls, mcpServers, photoUrl, minimumAge, tones, language } = req.body;

  const serviceNameStr = typeof serviceName === 'string' ? serviceName.trim() : '';
  const personaNameStr = typeof personaName === 'string' ? personaName.trim() : '';
  const promptStr = typeof prompt === 'string' ? prompt.trim() : '';

  const tonesArr = typeof tones === 'string' ? tones.split(',').filter(Boolean) : (Array.isArray(tones) ? tones : []);

  const sanitizedUrl = photoUrl && photoUrl.trim();
  const finalPhotoUrl = req.file
    ? `/uploads/${req.file.filename}`
    : (sanitizedUrl && !/^(javascript|data):/i.test(sanitizedUrl) ? sanitizedUrl : bot.photo_url);

  if (!serviceNameStr || !personaNameStr) {
    const error = res.locals.t('validation.botRequiredFields');
    return res.status(400).render('bot-edit', {
      mcpCatalog,
      error,
      bot: {
        ...bot,
        service_name: serviceName || '',
        service_description: serviceDescription || '',
        persona_name: personaName || '',
        persona_profession: personaProfession || '',
        persona_description: personaDescription || '',
        prompt: prompt || '',
        rag_urls: ragUrls ? ragUrls.split('\n').filter(Boolean) : [],
        mcp_servers: mcpServers ? (Array.isArray(mcpServers) ? mcpServers : [mcpServers]) : [],
        photo_url: finalPhotoUrl,
        minimum_age: minimumAge ? parseInt(minimumAge, 10) : 1,
        tones: tonesArr,
        language: language || 'auto'
      }
    });
  }

  db.update('bots', b => b.id === bot.id, {
    service_name:        serviceNameStr,
    service_description: serviceDescription,
    persona_name:        personaNameStr,
    persona_profession:  personaProfession,
    persona_description: personaDescription,
    prompt:              promptStr,
    rag_urls:    ragUrls    ? ragUrls.split('\n').filter(Boolean) : [],
    mcp_servers: mcpServers ? (Array.isArray(mcpServers) ? mcpServers : [mcpServers]) : [],
    tones:       tonesArr,
    language:    language || 'auto',
    photo_url:   finalPhotoUrl,
    minimum_age: minimumAge ? parseInt(minimumAge, 10) : 1,
    updated_at: new Date().toISOString(),
  });

  res.redirect(`/bots/${bot.id}`);
});

// ── Publish ───────────────────────────────────────────────────────────────────
router.post('/:id/publish', async (req, res) => {
  const bot = db.find('bots', b => String(b.id) === String(req.params.id) && String(b.user_id) === String(res.locals.currentUser.id));
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  let status = 'applied';
  let details = `Deployed to ${teamNamespace}`;

  if (enableK8sApply) {
    try {
      await deployToK8s(bot, teamNamespace, baseDomain);
    } catch (err) {
      status = 'failed';
      details = `K8s Deployment Error: ${err.message}`;
    }
  } else {
    status = 'pending_manual_apply';
    details = 'K8s apply disabled (ENABLE_K8S_APPLY=false)';
  }

  const publicUrl = `https://${bot.slug}.${baseDomain}`;
  recordPublish(bot, { action: 'publish', publicUrl, status, details });

  res.redirect(`/bots/${bot.id}?toast=${status === 'failed' ? 'error' : 'published'}`);
});

// ── Unpublish ─────────────────────────────────────────────────────────────────
router.post('/:id/unpublish', async (req, res) => {
  const bot = db.find('bots', b => String(b.id) === String(req.params.id) && String(b.user_id) === String(res.locals.currentUser.id));
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  if (enableK8sApply) {
    await undeployFromK8s(bot, teamNamespace);
  }

  recordPublish(bot, { action: 'unpublish', publicUrl: '', status: 'unpublished', details: 'Bot unpublished by user.' });

  res.redirect(`/bots/${bot.id}?toast=unpublished`);
});

// ── Delete ──────────────────────────────────────────────────────────────────
router.post('/:id/delete', async (req, res) => {
  const bot = db.find('bots', b => String(b.id) === String(req.params.id) && String(b.user_id) === String(res.locals.currentUser.id));
  if (!bot) return res.status(404).render('error', { message: 'Bot not found', status: 404 });

  if (enableK8sApply && bot.publish_status === 'published') {
    try {
      await undeployFromK8s(bot, teamNamespace);
    } catch (err) {
      console.error('Failed to undeploy before delete:', err);
    }
  }

  db.remove('bot_versions',  v => v.bot_id === bot.id);
  db.remove('publish_runs',  r => r.bot_id === bot.id);
  db.remove('bots',          b => b.id === bot.id);

  res.redirect('/bots?toast=deleted');
});

module.exports = router;
