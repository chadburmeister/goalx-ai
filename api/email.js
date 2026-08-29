// ---------------------------------------------------------------------------
// POST /api/email
//
// One-time relay: takes a summary + transcript and sends it to an address the
// person typed in themselves. Sends once, keeps nothing.
//
// PRIVACY CONTRACT — do not break this:
//   * No database. No file. No log of the address or the content.
//   * No BCC, no archive copy, no "for our records" duplicate.
//   * The only party that ever receives this email is the recipient the person
//     typed. If you are tempted to add an analytics hook here, don't.
// ---------------------------------------------------------------------------

const MAX_BODY = 120000;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim()) && s.length < 320;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.GOALX_FROM_EMAIL || 'Skip at GoalX <skip@goalx.ai>';
  if (!apiKey) {
    res.status(500).json({
      error: 'Email is not configured on this deployment yet. Use the download button instead.'
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body) {
    res.status(400).json({ error: 'Bad request.' });
    return;
  }

  const to = (body.to || '').trim();
  if (!isEmail(to)) {
    res.status(400).json({ error: "That doesn't look like a valid email address." });
    return;
  }

  const name = typeof body.name === 'string' ? body.name.slice(0, 60).trim() : '';
  const summary = String(body.summary || '').slice(0, MAX_BODY);
  const transcript = Array.isArray(body.transcript) ? body.transcript.slice(0, 400) : [];

  if (!summary && transcript.length === 0) {
    res.status(400).json({ error: 'There is nothing to send yet.' });
    return;
  }

  const transcriptHtml = transcript
    .map(m => {
      const who = m.role === 'assistant' ? 'Skip' : name || 'You';
      const colour = m.role === 'assistant' ? '#8a6d2f' : '#33404f';
      return `<div style="margin:0 0 20px"><div style="font:600 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${colour};margin-bottom:5px">${escapeHtml(
        who
      )}</div><div style="font:400 15px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#1a2330;white-space:pre-wrap">${escapeHtml(
        String(m.content || '')
      )}</div></div>`;
    })
    .join('');

  const html = `<div style="background:#fbf8f3;padding:34px 16px">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid rgba(26,35,48,.12);border-radius:14px;padding:38px 34px">
    <div style="font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#b8892f;margin-bottom:22px">GoalX · Your outcome</div>
    <h1 style="font:400 27px/1.25 Georgia,serif;color:#0e1520;margin:0 0 8px">${
      name ? escapeHtml(name) + ', here' : 'Here'
    } is what you found.</h1>
    <p style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#5c6878;margin:0 0 30px">${escapeHtml(
      new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    )}</p>
    <div style="font:400 16.5px/1.72 Georgia,serif;color:#1a2330;white-space:pre-wrap;border-left:3px solid #d9a63f;padding:4px 0 4px 24px;margin:0 0 38px">${escapeHtml(
      summary
    )}</div>
    ${
      transcriptHtml
        ? `<div style="border-top:1px solid rgba(26,35,48,.12);padding-top:32px">
             <div style="font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:#b8892f;margin-bottom:24px">The full conversation</div>
             ${transcriptHtml}
           </div>`
        : ''
    }
    <p style="font:400 13px/1.65 -apple-system,Segoe UI,Roboto,sans-serif;color:#8a94a1;margin:34px 0 0;border-top:1px solid rgba(26,35,48,.12);padding-top:22px">
      This email is the only copy. GoalX stored nothing — not your answers, not this summary, not your address. Keep this message somewhere you'll find it again.
    </p>
  </div>
</div>`;

  const plain =
    `GOALX — YOUR OUTCOME\n${new Date().toDateString()}\n\n${summary}\n\n` +
    (transcript.length
      ? `\n----- THE FULL CONVERSATION -----\n\n` +
        transcript.map(m => `${m.role === 'assistant' ? 'SKIP' : (name || 'YOU').toUpperCase()}:\n${m.content}\n`).join('\n')
      : '') +
    `\n\nThis email is the only copy. GoalX stored nothing.`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'Your GoalX outcome — what you truly want',
        html,
        text: plain
      })
    });

    if (!r.ok) {
      console.error('[goalx] email upstream status', r.status);
      res.status(502).json({ error: 'The email could not be sent. Please download your copy instead.' });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[goalx] email failed:', err && err.name);
    res.status(502).json({ error: 'The email could not be sent. Please download your copy instead.' });
  }
};
