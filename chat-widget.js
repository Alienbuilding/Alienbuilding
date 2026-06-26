/* ================================================================
   ALIEN BUILDING — AI Chat Widget
   Drop this <script> tag before </body> in your index.html:
   <script src="chat-widget.js"></script>
   ================================================================ */

(function () {
  // ── CONFIG — update BACKEND_URL after Railway deployment ──────
  const BACKEND_URL = window.ALIEN_CHAT_URL || 'https://YOUR-RAILWAY-URL.up.railway.app';
  const AGENT_NAME  = 'Alex';
  const AGENT_ROLE  = 'Alien Building Assistant';
  const OPEN_DELAY  = 4000; // auto-open after 4 seconds

  // ── SESSION ID ────────────────────────────────────────────────
  let sessionId = localStorage.getItem('ab_session');
  if (!sessionId) {
    sessionId = 'ab_' + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem('ab_session', sessionId);
  }

  let pollInterval   = null;
  let lastPollTime   = Date.now();
  let isOpen         = false;
  let hasAutoOpened  = false;
  let isTyping       = false;

  // ── STYLES ────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ab-chat-bubble {
      position: fixed; bottom: 28px; right: 28px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #3DBA6F, #2a8a50);
      box-shadow: 0 4px 24px rgba(61,186,111,0.4);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
      border: none; outline: none;
    }
    #ab-chat-bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 32px rgba(61,186,111,0.55);
    }
    #ab-chat-bubble svg { width: 26px; height: 26px; fill: #fff; }

    #ab-chat-badge {
      position: absolute; top: -4px; right: -4px;
      width: 18px; height: 18px; border-radius: 50%;
      background: #e74c3c; color: #fff;
      font-size: 10px; font-weight: 700; font-family: sans-serif;
      display: none; align-items: center; justify-content: center;
      border: 2px solid #050507;
    }

    #ab-chat-window {
      position: fixed; bottom: 96px; right: 28px; z-index: 9998;
      width: 360px; height: 520px;
      background: #0D0D0F;
      border: 1px solid rgba(61,186,111,0.25);
      border-radius: 16px;
      box-shadow: 0 16px 64px rgba(0,0,0,0.6);
      display: flex; flex-direction: column;
      overflow: hidden;
      opacity: 0; transform: translateY(16px) scale(0.97);
      pointer-events: none;
      transition: opacity 0.25s ease, transform 0.25s ease;
      font-family: 'Inter', 'Segoe UI', sans-serif;
    }
    #ab-chat-window.open {
      opacity: 1; transform: translateY(0) scale(1);
      pointer-events: all;
    }

    #ab-chat-header {
      background: linear-gradient(135deg, #111214, #1a1c1f);
      padding: 14px 16px; display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid rgba(61,186,111,0.15);
      flex-shrink: 0;
    }
    #ab-chat-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(135deg, #3DBA6F22, #3DBA6F44);
      border: 1px solid rgba(61,186,111,0.4);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    #ab-chat-avatar svg { width: 20px; height: 20px; stroke: #3DBA6F; fill: none; }
    #ab-chat-info { flex: 1; }
    #ab-chat-name { color: #fff; font-weight: 600; font-size: 14px; line-height: 1.2; }
    #ab-chat-status {
      color: #3DBA6F; font-size: 11px; display: flex; align-items: center; gap: 4px;
    }
    #ab-chat-status::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%;
      background: #3DBA6F; display: inline-block;
    }
    #ab-chat-close {
      background: none; border: none; color: #666; cursor: pointer;
      font-size: 18px; line-height: 1; padding: 4px; transition: color 0.2s;
    }
    #ab-chat-close:hover { color: #aaa; }

    #ab-chat-messages {
      flex: 1; overflow-y: auto; padding: 16px 14px;
      display: flex; flex-direction: column; gap: 10px;
      scrollbar-width: thin; scrollbar-color: #222 transparent;
    }
    #ab-chat-messages::-webkit-scrollbar { width: 4px; }
    #ab-chat-messages::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

    .ab-msg {
      max-width: 82%; padding: 9px 13px;
      border-radius: 14px; font-size: 13.5px; line-height: 1.5;
      word-break: break-word; animation: ab-fadein 0.2s ease;
    }
    @keyframes ab-fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

    .ab-msg.agent {
      background: #1a1c20; color: #d4d4d8;
      border-bottom-left-radius: 4px; align-self: flex-start;
      border: 1px solid #2a2c30;
    }
    .ab-msg.user {
      background: linear-gradient(135deg, #1e4d32, #1a3f28);
      color: #e8f5ee; border-bottom-right-radius: 4px;
      align-self: flex-end;
      border: 1px solid rgba(61,186,111,0.2);
    }
    .ab-msg.john {
      background: linear-gradient(135deg, #1a2a4a, #152040);
      color: #d0e0ff; border-bottom-left-radius: 4px;
      align-self: flex-start;
      border: 1px solid rgba(100,150,255,0.2);
    }
    .ab-msg-label {
      font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; margin-bottom: 3px;
      color: #3DBA6F; font-family: 'Syne', sans-serif;
    }
    .ab-msg-label.john-label { color: #7aaeff; }

    .ab-typing {
      display: flex; gap: 4px; align-items: center;
      padding: 10px 14px; background: #1a1c20;
      border-radius: 14px; border-bottom-left-radius: 4px;
      border: 1px solid #2a2c30; align-self: flex-start;
      width: fit-content;
    }
    .ab-typing span {
      width: 6px; height: 6px; border-radius: 50%;
      background: #3DBA6F; opacity: 0.4;
      animation: ab-bounce 1.2s infinite;
    }
    .ab-typing span:nth-child(2) { animation-delay: 0.2s; }
    .ab-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes ab-bounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
      40% { transform: scale(1); opacity: 1; }
    }

    #ab-chat-input-area {
      padding: 12px 14px; border-top: 1px solid #1e2022;
      display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
      background: #0D0D0F;
    }
    #ab-chat-input {
      flex: 1; background: #161820; color: #d4d4d8;
      border: 1px solid #2a2c35; border-radius: 10px;
      padding: 9px 12px; font-size: 13.5px; font-family: inherit;
      resize: none; outline: none; line-height: 1.4;
      max-height: 90px; transition: border-color 0.2s;
    }
    #ab-chat-input::placeholder { color: #555; }
    #ab-chat-input:focus { border-color: rgba(61,186,111,0.5); }
    #ab-chat-send {
      width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
      background: linear-gradient(135deg, #3DBA6F, #2a8a50);
      border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: opacity 0.2s, transform 0.1s;
    }
    #ab-chat-send:hover { opacity: 0.9; transform: scale(1.05); }
    #ab-chat-send:active { transform: scale(0.96); }
    #ab-chat-send svg { width: 16px; height: 16px; stroke: #fff; fill: none; }

    #ab-chat-footer {
      text-align: center; padding: 6px; font-size: 10px;
      color: #333; border-top: 1px solid #151517;
      background: #0D0D0F; flex-shrink: 0;
    }

    @media (max-width: 420px) {
      #ab-chat-window { width: calc(100vw - 24px); right: 12px; bottom: 84px; }
      #ab-chat-bubble { bottom: 16px; right: 16px; }
    }
  `;
  document.head.appendChild(style);

  // ── HTML ──────────────────────────────────────────────────────
  const bubble = document.createElement('button');
  bubble.id = 'ab-chat-bubble';
  bubble.setAttribute('aria-label', 'Open chat');
  bubble.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
    <div id="ab-chat-badge"></div>
  `;

  const win = document.createElement('div');
  win.id = 'ab-chat-window';
  win.setAttribute('role', 'dialog');
  win.setAttribute('aria-label', 'Chat with Alien Building');
  win.innerHTML = `
    <div id="ab-chat-header">
      <div id="ab-chat-avatar">
        <svg viewBox="0 0 24 24" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
      <div id="ab-chat-info">
        <div id="ab-chat-name">${AGENT_NAME} · ${AGENT_ROLE}</div>
        <div id="ab-chat-status">Online · Typically replies instantly</div>
      </div>
      <button id="ab-chat-close" aria-label="Close chat">✕</button>
    </div>
    <div id="ab-chat-messages"></div>
    <div id="ab-chat-input-area">
      <textarea id="ab-chat-input" placeholder="Type your message..." rows="1"></textarea>
      <button id="ab-chat-send" aria-label="Send message">
        <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>
    <div id="ab-chat-footer">Powered by Alien Building Studio</div>
  `;

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  // ── REFS ──────────────────────────────────────────────────────
  const messages = win.querySelector('#ab-chat-messages');
  const input    = win.querySelector('#ab-chat-input');
  const sendBtn  = win.querySelector('#ab-chat-send');
  const closeBtn = win.querySelector('#ab-chat-close');
  const badge    = bubble.querySelector('#ab-chat-badge');

  // ── HELPERS ───────────────────────────────────────────────────
  function showBadge(n) {
    if (n > 0) { badge.style.display = 'flex'; badge.textContent = n; }
    else { badge.style.display = 'none'; }
  }

  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(text, type = 'agent') {
    // Remove typing indicator if present
    const typing = messages.querySelector('.ab-typing');
    if (typing) typing.remove();

    const wrap = document.createElement('div');
    if (type === 'john') {
      wrap.innerHTML = `<div class="ab-msg-label john-label">John</div><div class="ab-msg john">${text}</div>`;
    } else if (type === 'agent') {
      wrap.innerHTML = `<div class="ab-msg agent">${text}</div>`;
    } else {
      wrap.innerHTML = `<div class="ab-msg user">${text}</div>`;
    }
    messages.appendChild(wrap);
    scrollBottom();
  }

  function showTyping() {
    const t = document.createElement('div');
    t.className = 'ab-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(t);
    scrollBottom();
  }

  // ── OPEN / CLOSE ──────────────────────────────────────────────
  function openChat() {
    isOpen = true;
    win.classList.add('open');
    showBadge(0);
    input.focus();
    if (messages.children.length === 0) {
      // First open — show greeting after short delay
      setTimeout(() => {
        showTyping();
        setTimeout(() => {
          addMessage("Hi! 👋 I'm Alex, Alien Building's assistant. I'd love to learn about your project and connect you with John. What brings you here today?");
        }, 900);
      }, 300);
    }
  }

  function closeChat() {
    isOpen = false;
    win.classList.remove('open');
  }

  bubble.addEventListener('click', () => isOpen ? closeChat() : openChat());
  closeBtn.addEventListener('click', closeChat);

  // Auto open after delay (once only)
  setTimeout(() => {
    if (!hasAutoOpened && !isOpen) {
      hasAutoOpened = true;
      openChat();
    }
  }, OPEN_DELAY);

  // ── SEND MESSAGE ──────────────────────────────────────────────
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isTyping) return;

    input.value = '';
    input.style.height = 'auto';
    addMessage(text, 'user');

    isTyping = true;
    showTyping();

    try {
      const res = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: text })
      });
      const data = await res.json();
      addMessage(data.reply || "Sorry, I couldn't process that. Please try again.", 'agent');
    } catch (err) {
      addMessage("Connection error. Please try again in a moment.", 'agent');
    }

    isTyping = false;
    startPolling();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 90) + 'px';
  });

  // ── POLLING: check for John's replies ─────────────────────────
  function startPolling() {
    if (pollInterval) return;
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/poll/${sessionId}?since=${lastPollTime}`);
        const data = await res.json();
        if (data.replies && data.replies.length > 0) {
          data.replies.forEach(r => {
            addMessage(r.text, 'john');
            lastPollTime = Math.max(lastPollTime, r.timestamp + 1);
            if (!isOpen) showBadge(1);
          });
        }
      } catch (_) {}
    }, 3000); // poll every 3 seconds
  }

})();
