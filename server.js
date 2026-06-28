const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false, limit: '20mb' }));

// ── CREDENTIALS ──────────────────────────────────────────────
const TWILIO_SID        = process.env.TWILIO_SID;
const TWILIO_TOKEN      = process.env.TWILIO_TOKEN;
const TWILIO_NUMBER     = process.env.TWILIO_NUMBER;   // +18456134389
const ANTHROPIC_KEY     = process.env.ANTHROPIC_KEY;
const JOHN_WHATSAPP     = process.env.JOHN_WHATSAPP;   // whatsapp:

const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
const anthropic    = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── SESSION STORE (in-memory) ─────────────────────────────────
// sessions[sessionId] = { history: [], lead: {}, qualified: false }
const sessions = {};

// ── AI SYSTEM PROMPT ──────────────────────────────────────────
const SYSTEM_PROMPT = `You are Alex, an assistant for Alien Building Studio — a creative architecture and engineering studio founded by John. You specialize in 3D visualization, CAD/BIM, architectural design, interior design, and engineering.

Your personality: warm, curious, like a creative person — not a support bot. You talk like a talented colleague who's genuinely excited about the project.

Your goal: have a natural conversation, understand their vision, and collect what John needs to follow up:
1. Their name
2. Project type (residential, commercial, 3D rendering, interior, CAD/DWG, or other)
3. Rough budget range
4. Location (city/country)
5. Timeline
6. Best contact (email or WhatsApp)

How to talk:
- Keep it short: 1-2 sentences per reply, max
- Ask ONE thing at a time, weaved naturally into the conversation
- Sound genuinely interested in their vision
- Never list options like a form — ask open questions instead

Examples of good replies:
"Love that — a residential project. What's the vibe you're going for? Something modern and minimal, or more warm and organic?"
"Nice, a commercial space in Austin — exciting. Is this ground-up or a renovation?"
"Got it. And roughly when are you hoping to see the first renders?"

Bad replies (never do this):
"What is your budget range? Under $5k, $5k-$15k, $15k-$50k, $50k+"
"Please provide: 1) project type 2) location 3) timeline"

Other rules:
- Never give specific pricing — John discusses that personally
- Never reveal you are an AI unless directly asked
- Once you have all 6 pieces of info, say warmly: "This sounds like an amazing project. Let me get John looped in — he'll want to hear about this directly. Is there anything else you'd like to add before I connect you?"
- After they respond to that, output ONLY this on a new line: [LEAD_READY]`;

// ── HELPER: extract lead data from conversation ───────────────
function extractLead(history) {
  // Build a readable summary from the conversation
  const convo = history
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .join(' | ');
  return convo;
}

// ── HELPER: send WhatsApp message to John ────────────────────
async function notifyJohn(sessionId, leadSummary, fullHistory) {
  // Build a clean lead card
  const convoText = fullHistory
    .map(m => `${m.role === 'user' ? '👤 Client' : '🤖 Alex'}: ${m.content}`)
    .join('\n');

  const message =
    `🔔 *New Lead — Alien Building*\n\n` +
    `*Session:* ${sessionId}\n\n` +
    `*Full conversation:*\n${convoText}\n\n` +
    `Reply to this WhatsApp message and your reply will appear in the client's chat widget on the website.`;

  await twilioClient.messages.create({
    from: `whatsapp:${TWILIO_NUMBER}`,
    to: JOHN_WHATSAPP,
    body: message
  });

  console.log(`✅ Lead notification sent to John for session ${sessionId}`);
}

// ── ROUTE: client sends a message from the widget ─────────────
app.post('/chat', async (req, res) => {
  try {
    const { sessionId, message } = req.body;

    if (!sessionId || !message) {
      return res.status(400).json({ error: 'sessionId and message required' });
    }

    // Init session if new
    if (!sessions[sessionId]) {
      sessions[sessionId] = { history: [], qualified: false };
    }

    const session = sessions[sessionId];

    // Add user message to history
    session.history.push({ role: 'user', content: message });

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: session.history
    });

    const aiText = response.content[0].text;

    // Check if lead is ready
    const leadReady = aiText.includes('[LEAD_READY]');
    const cleanResponse = aiText.replace('[LEAD_READY]', '').trim();

    // Add AI response to history
    session.history.push({ role: 'assistant', content: cleanResponse });

    // If lead is ready and not yet notified — send to John's WhatsApp
    if (leadReady && !session.qualified) {
      session.qualified = true;
      await notifyJohn(sessionId, extractLead(session.history), session.history);
    }

    res.json({ reply: cleanResponse, sessionId });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ── ROUTE: John replies from WhatsApp → goes to client widget ──
app.post('/whatsapp-reply', async (req, res) => {
  try {
    const incomingMsg = req.body.Body;
    const from        = req.body.From; // whatsapp:+55

    // Only accept messages from John
    if (from !== JOHN_WHATSAPP) {
      return res.status(200).send('<Response></Response>');
    }

    // Find the active session to reply to
    // John's reply goes to the most recently qualified session
    const qualifiedSessions = Object.entries(sessions)
      .filter(([, s]) => s.qualified)
      .sort(([, a], [, b]) => (b.lastActivity || 0) - (a.lastActivity || 0));

    if (qualifiedSessions.length === 0) {
      await twilioClient.messages.create({
        from: `whatsapp:${TWILIO_NUMBER}`,
        to: JOHN_WHATSAPP,
        body: '⚠️ No active client sessions found to reply to.'
      });
      return res.status(200).send('<Response></Response>');
    }

    const [targetSessionId, targetSession] = qualifiedSessions[0];

    // Store John's reply in session so widget can poll it
    if (!targetSession.johnReplies) targetSession.johnReplies = [];
    targetSession.johnReplies.push({
      text: incomingMsg,
      timestamp: Date.now()
    });

    console.log(`✅ John replied to session ${targetSessionId}: ${incomingMsg}`);
    res.status(200).send('<Response></Response>');

  } catch (err) {
    console.error('WhatsApp reply error:', err);
    res.status(200).send('<Response></Response>');
  }
});

// ── ROUTE: widget polls for John's replies ────────────────────
app.get('/poll/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const since = parseInt(req.query.since || '0');

  const session = sessions[sessionId];
  if (!session) return res.json({ replies: [] });

  const newReplies = (session.johnReplies || [])
    .filter(r => r.timestamp > since);

  res.json({ replies: newReplies });
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: '🟢 Alien Building Chat Server running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
