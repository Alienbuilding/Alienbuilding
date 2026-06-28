const express = require('express');
const cors = require('cors');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ── CREDENTIALS ──────────────────────────────────────────────
const TWILIO_SID        = process.env.TWILIO_SID;
const TWILIO_TOKEN      = process.env.TWILIO_TOKEN;
const TWILIO_NUMBER     = process.env.TWILIO_NUMBER;   // +18456134389
const ANTHROPIC_KEY     = process.env.ANTHROPIC_KEY;
const JOHN_WHATSAPP     = process.env.JOHN_WHATSAPP;   // 

const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN);
const anthropic    = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ── SESSION STORE (in-memory) ─────────────────────────────────
// sessions[sessionId] = { history: [], lead: {}, qualified: false }
const sessions = {};

// ── AI SYSTEM PROMPT ──────────────────────────────────────────
const SYSTEM_PROMPT = `You are Alex, a friendly and professional assistant for Alien Building Studio — a high-end architecture and engineering firm founded by John.

Your job is to warmly welcome visitors and qualify them as leads by naturally collecting this information during the conversation:
1. Their name
2. Type of project (residential, commercial, interior design, 3D rendering, CAD/BIM, other)
3. Budget range (under $5k, $5k-$15k, $15k-$50k, $50k+)
4. Project location (city, state)
5. Timeline (ASAP, 1-3 months, 3-6 months, 6+ months)
6. Best way to reach them (email or WhatsApp number)

Rules:
- Be warm, professional and concise — this is a chat widget, keep responses short (2-3 sentences max)
- Ask ONE question at a time, naturally woven into conversation
- Never sound like a form or a robot
- Once you have all 6 pieces of info, tell them: "Perfect! I'm passing your details to John right now. He'll reach out to you shortly. Is there anything else you'd like to add?"
- After they respond to that, output ONLY this exact tag on a new line: [LEAD_READY]
- Never reveal you are an AI unless directly asked
- Never discuss pricing specifics — just say John will go over all details personally
- Always stay focused on architecture/design topics`;

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

    // Build content — text + optional images
    const userContent = [];
    if (req.body.images && req.body.images.length > 0) {
      req.body.images.forEach(img => {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.base64 }
        });
      });
    }
    userContent.push({ type: 'text', text: message });

    // Add user message to history (text only for history, images are per-turn)
    session.history.push({ role: 'user', content: userContent });

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

    // Store assistant reply as text only
    session.history.push({ role: 'assistant', content: [{ type: 'text', text: cleanResponse }] });

    // Trim history to last 20 turns to avoid token overflow
    if (session.history.length > 20) session.history = session.history.slice(-20);

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
    const from        = req.body.From; // whatsapp:

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
