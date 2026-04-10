const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { TOOLS, TOOL_META, GOAL_WEIGHTS, DEEP_PROFILES, TOOL_COMBOS, IDEA_QUESTIONS, BUILD_QUESTIONS } = require('./data');
const { buildStack, estimateOutcomes, getToolReason, buildDerivedTags, parseGoal } = require('./engine');

const app = express();
app.use(cors());
app.use(express.json());

const limiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
app.use(limiter);

// GET /health
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0', tools: TOOLS.length }));

// GET /tools?category=X&skill=beginner&free=true
app.get('/tools', (req, res) => {
  let tools = TOOLS;
  if (req.query.category) tools = tools.filter(t => t.categories.includes(req.query.category));
  if (req.query.free === 'true') tools = tools.filter(t => t.free && t.free.available);
  res.json(tools.map(t => ({ id:t.id, name:t.name, maker:t.maker, tagline:t.tagline, categories:t.categories, scores:t.scores, free:t.free })));
});

// GET /tool/:id
app.get('/tool/:id', (req, res) => {
  const tool = TOOLS.find(t => t.id === req.params.id);
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  const meta = TOOL_META[tool.id] || {};
  const profile = DEEP_PROFILES[tool.id] || null;
  res.json({ ...tool, meta, deepProfile: profile });
});

// GET /search?q=video&category=Video
app.get('/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const cat = req.query.category;
  let results = TOOLS.filter(t => {
    const inName = t.name.toLowerCase().includes(q);
    const inTagline = (t.tagline||'').toLowerCase().includes(q);
    const inBestFor = (t.bestFor||'').toLowerCase().includes(q);
    const inCats = t.categories.some(c => c.toLowerCase().includes(q));
    const inUseCases = (t.useCases||[]).some(u => u.toLowerCase().includes(q));
    return inName || inTagline || inBestFor || inCats || inUseCases;
  });
  if (cat) results = results.filter(t => t.categories.includes(cat));
  res.json(results.map(t => ({ id:t.id, name:t.name, maker:t.maker, tagline:t.tagline, categories:t.categories, scores:t.scores })));
});

// GET /compare?ids=claude,chatgpt,gemini
app.get('/compare', (req, res) => {
  const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length < 2) return res.status(400).json({ error: 'Provide at least 2 tool IDs' });
  const tools = ids.map(id => TOOLS.find(t => t.id === id)).filter(Boolean);
  res.json(tools.map(t => ({ id:t.id, name:t.name, maker:t.maker, tagline:t.tagline, scores:t.scores, free:t.free, paid:t.paid, features:t.features, categories:t.categories })));
});

// POST /recommend
// Body: { goal, mode, answers: { budget, skill, compliance, team_size } }
app.post('/recommend', (req, res) => {
  try {
    const { goal, mode, answers } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal is required' });

    // Build session
    const session = {
      goal,
      mode: mode || 'idea',
      answers: answers || {},
      goalTags: [],
      derivedTags: [],
      step: 2
    };

    // Parse goal text into tags
    session.goalTags = parseGoal(goal, session);

    // Also derive tags from any provided answers
    if (answers) {
      const goalLower = goal.toLowerCase();
      if (goalLower.includes('video')) session.goalTags.push('video');
      if (goalLower.includes('cod') || goalLower.includes('develop')) session.goalTags.push('coding');
      if (goalLower.includes('writ') || goalLower.includes('blog') || goalLower.includes('content')) session.goalTags.push('writing');
      if (goalLower.includes('research') || goalLower.includes('analyz')) session.goalTags.push('research');
      if (goalLower.includes('automat') || goalLower.includes('workflow')) session.goalTags.push('automation');
      if (goalLower.includes('image') || goalLower.includes('design') || goalLower.includes('art')) session.goalTags.push('image-gen');
      if (goalLower.includes('voice') || goalLower.includes('audio') || goalLower.includes('podcast')) session.goalTags.push('voice');
      if (goalLower.includes('market') || goalLower.includes('social')) session.goalTags.push('marketing');
    }

    // Deduplicate tags
    session.goalTags = [...new Set(session.goalTags)];

    // Build derived tags from answers
    session.derivedTags = buildDerivedTags(session);

    // Run the stack builder
    const stack = buildStack(session);
    const outcomes = estimateOutcomes(stack, session);

    // Enrich stack with reasons
    const enrichedStack = stack.map(({ tool, layer, score }) => {
      const reason = getToolReason(tool, layer, session.goalTags, session.answers, session);
      return {
        tool: {
          id: tool.id,
          name: tool.name,
          maker: tool.maker,
          tagline: tool.tagline,
          icon: tool.icon,
          categories: tool.categories,
          scores: tool.scores,
          free: tool.free,
          paid: tool.paid.slice(0, 2)
        },
        layer,
        score,
        why: reason.why,
        detail: reason.detail,
        tradeoff: reason.tradeoff
      };
    });

    res.json({
      stack: enrichedStack,
      outcomes,
      session: { goal, mode: session.mode, goalTags: session.goalTags, derivedTags: session.derivedTags }
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /combos?category=Automation
app.get('/combos', (req, res) => {
  let combos = TOOL_COMBOS;
  if (req.query.category) {
    const cat = req.query.category.toLowerCase();
    combos = combos.filter(c => (c.title||'').toLowerCase().includes(cat) || (c.bestFor||'').toLowerCase().includes(cat));
  }
  res.json(combos);
});

// GET /categories
app.get('/categories', (req, res) => {
  const cats = [...new Set(TOOLS.flatMap(t => t.categories))].sort();
  res.json(cats);
});

// GET /openapi.json — OpenAPI 3.0 spec for this API
app.get('/openapi.json', (req, res) => {
  const host = req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  res.json({
    openapi: '3.0.0',
    info: { title: 'Toolipedia API', version: '1.0.0', description: 'AI tool directory and stack advisor' },
    servers: [{ url: `${proto}://${host}` }],
    paths: {
      '/health': { get: { summary: 'Health check', responses: { '200': { description: 'OK' } } } },
      '/tools': { get: { summary: 'List tools', parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }, { name: 'free', in: 'query', schema: { type: 'boolean' } }], responses: { '200': { description: 'Array of tools' } } } },
      '/tool/{id}': { get: { summary: 'Get a specific tool', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Tool detail' }, '404': { description: 'Not found' } } } },
      '/search': { get: { summary: 'Search tools', parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'category', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Search results' } } } },
      '/compare': { get: { summary: 'Compare tools', parameters: [{ name: 'ids', in: 'query', required: true, schema: { type: 'string' }, description: 'Comma-separated tool IDs (2-4)' }], responses: { '200': { description: 'Comparison data' } } } },
      '/recommend': { post: { summary: 'Get stack recommendation', requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['goal'], properties: { goal: { type: 'string' }, mode: { type: 'string', enum: ['idea', 'build'] }, answers: { type: 'object' } } } } } }, responses: { '200': { description: 'Recommended stack' } } } },
      '/combos': { get: { summary: 'List tool combinations', parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: 'Tool combos' } } } },
      '/categories': { get: { summary: 'List all categories', responses: { '200': { description: 'Array of category names' } } } }
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Toolipedia API running on port ${PORT}`));
