// ---------------------------------------------------------------------------
// POST /api/chat
//
// Relays a conversation to the Claude API and returns Skip's next message.
//
// PRIVACY CONTRACT — do not break this:
//   * Nothing is written to a database, a file, or a log.
//   * The request body is held in memory for the life of the request only.
//   * No console.log of user content. Errors log a type, never a payload.
// ---------------------------------------------------------------------------

const { buildSystemPrompt } = require('./_skip-prompt.js');

const MODEL = process.env.GOALX_MODEL || 'claude-sonnet-5';
const MAX_TURNS = 200;          // hard cap on conversation length
const MAX_CHARS = 8000;         // hard cap on a single user message

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
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

  if (messages.length === 0) {
    // Opening turn: nudge Skip to begin.
    messages.push({ role: 'user', content: "I'm ready to begin." });
  }
  if (messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: "I'm ready to begin." });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1400,
        temperature: 0.8,
        system: buildSystemPrompt({ track, mode, name }),
        messages
      })
    });

    if (!upstream.ok) {
      // Log the status only. Never the body — it can echo user content.
      console.error('[goalx] upstream error status', upstream.status);
      res.status(502).json({
        error:
          upstream.status === 401
            ? 'The API key was rejected. Check ANTHROPIC_API_KEY in Vercel.'
            : upstream.status === 429
            ? "Skip is at capacity right now. Give it a moment and send that again."
            : 'Skip could not be reached just now. Please try that again.'
      });
      return;
    }

    const data = await upstream.json();
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    if (!text) {
      res.status(502).json({ error: 'Skip returned an empty response. Please try again.' });
      return;
    }

    // Pull the progress marker out of the prose before it ever reaches the client.
    let step = null;
    const marker = text.match(/\[\[Q:\s*(SUMMARY|\d{1,2})\s*\]\]/i);
    if (marker) step = marker[1].toUpperCase();
    const reply = text.replace(/\[\[Q:[^\]]*\]\]/gi, '').trim();

    res.status(200).json({ reply, step });
  } catch (err) {
    console.error('[goalx] request failed:', err && err.name);
    res.status(502).json({ error: 'Skip could not be reached just now. Please try that again.' });
  }
};
