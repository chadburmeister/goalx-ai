// ---------------------------------------------------------------------------
// POST /api/chat
//
// Relays a conversation to the Claude API and returns Skip's next message.
//
// PRIVACY CONTRACT — do not break this:
//   * Nothing is written to a database, a file, or a log.
//   * The request body is held in memory for the life of the request only.
//   * No console.log of user content. We log Anthropic's own error strings
//     (which describe the request shape, never the conversation) and nothing else.
// ---------------------------------------------------------------------------

const { buildSystemPrompt } = require('./_skip-prompt.js');

// Tried in order until one is accepted by this API key. The first success is
// remembered for the life of the warm instance so we only pay for discovery once.
const MODEL_CHAIN = [
  process.env.GOALX_MODEL,
  'claude-sonnet-4-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001'
].filter(Boolean);

let workingModel = null;

const MAX_TURNS = 200;
const MAX_CHARS = 8000;

async function callClaude(apiKey, model, system, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens: 1400, temperature: 0.8, system, messages })
  });

  if (r.ok) return { ok: true, data: await r.json() };

  let detail = '';
  let type = '';
  try {
    const e = await r.json();
    type = (e && e.error && e.error.type) || '';
    detail = (e && e.error && e.error.message) || '';
  } catch {
    /* non-JSON error body */
  }
  return { ok: false, status: r.status, type, detail };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'The server is missing its API key. Set ANTHROPIC_API_KEY in Vercel.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || !Array.isArray(body.messages)) {
    res.status(400).json({ error: 'Bad request.' });
    return;
  }

  const track = body.track === 'faith' ? 'faith' : 'universal';
  const mode = body.mode === 'coach' ? 'coach' : 'solo';
  const name = typeof body.name === 'string' ? body.name.slice(0, 60).trim() : '';

  const messages = body.messages
    .slice(-MAX_TURNS)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .filter(m => m.content.trim().length > 0);

  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: "I'm ready to begin." });
  }

  const system = buildSystemPrompt({ track, mode, name });
  const candidates = workingModel ? [workingModel] : MODEL_CHAIN;

  try {
    let last = null;

    for (const model of candidates) {
      const r = await callClaude(apiKey, model, system, messages);

      if (r.ok) {
        if (workingModel !== model) {
          workingModel = model;
          console.log('[goalx] using model:', model);
        }
        const text = (r.data.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('')
          .trim();

        if (!text) {
          res.status(502).json({ error: 'Skip returned an empty response. Please try again.' });
          return;
        }

        let step = null;
        const marker = text.match(/\[\[Q:\s*(SUMMARY|\d{1,2})\s*\]\]/i);
        if (marker) step = marker[1].toUpperCase();
        const reply = text.replace(/\[\[Q:[^\]]*\]\]/gi, '').trim();

        res.status(200).json({ reply, step });
        return;
      }

      last = r;
      // Anthropic's own error text — describes the request, never the conversation.
      console.error(`[goalx] model "${model}" rejected — ${r.status} ${r.type}: ${r.detail}`);

      // A model-availability problem is worth retrying with the next candidate.
      // Anything else (auth, rate limit, malformed request) will fail identically.
      const modelProblem =
        r.status === 404 ||
        /model/i.test(r.detail || '') ||
        r.type === 'not_found_error';
      if (!modelProblem) break;
    }

    if (last && last.status === 401) {
      res.status(502).json({ error: 'The API key was rejected. Check ANTHROPIC_API_KEY in Vercel.' });
      return;
    }
    if (last && last.status === 429) {
      res.status(502).json({ error: 'Skip is at capacity right now. Give it a moment and send that again.' });
      return;
    }
    if (last && (last.status === 400 || last.status === 403) && /credit|balance|billing|quota/i.test(last.detail || '')) {
      res.status(502).json({
        error: 'The Anthropic account has no API credits. Add a payment method at console.anthropic.com → Billing.'
      });
      return;
    }

    res.status(502).json({
      error: last && last.detail
        ? 'Skip could not start: ' + last.detail
        : 'Skip could not be reached just now. Please try that again.'
    });
  } catch (err) {
    console.error('[goalx] request failed:', err && err.name, err && err.message);
    res.status(502).json({ error: 'Skip could not be reached just now. Please try that again.' });
  }
};
