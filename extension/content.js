(() => {
  const DEFAULT_SERVER = HOTSTAR_PARTY_DEFAULTS.server;
  const SESSION_KEY = 'hotstar-party.room';
  const TICK_MS = 2000;
  const RECONNECT_MS = 2000;
  const ECHO_WINDOW_MS = 600;
  const TICK_DRIFT_SECONDS = 1.5;
  const ACTION_DRIFT_SECONDS = 0.3;
  const MAX_CHAT_MESSAGES = 200;
  const MAX_CHAT_LENGTH = 500;
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  let ws = null;
  let room = null;
  let status = 'idle';
  let isHost = false;
  let peers = 0;
  let members = [];
  let mismatch = false;
  let suppressUntil = 0;
  let ticker = null;
  let toastTimer = null;
  let myName = '';
  let chat = [];
  let unread = 0;
  let ui = null;

  function video() {
    let best = null;
    let bestArea = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best || document.querySelector('video');
  }

  function state() {
    return { room, status, isHost, peers, members, mismatch, name: myName, hasVideo: Boolean(video()) };
  }

  function randomCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function suppressEcho() {
    suppressUntil = Date.now() + ECHO_WINDOW_MS;
  }

  function formatTime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function broadcast(type) {
    const v = video();
    if (!v || peers === 0) return;
    send({ type, t: v.currentTime, paused: v.paused, path: location.pathname });
  }

  function apply(msg) {
    const v = video();
    if (!v) return;
    const who = msg.from || 'Your friend';
    if (msg.path !== location.pathname) {
      if (!mismatch) toast(`${who} is watching something else`);
      mismatch = true;
      return;
    }
    mismatch = false;
    const threshold = msg.type === 'tick' ? TICK_DRIFT_SECONDS : ACTION_DRIFT_SECONDS;
    const seek = !v.seeking && Math.abs(v.currentTime - msg.t) > threshold;
    if (msg.type === 'sync') {
      if (msg.paused !== v.paused) toast(`${who} ${msg.paused ? 'paused' : 'pressed play'}`);
      else if (seek) toast(`${who} jumped to ${formatTime(msg.t)}`);
    }
    if (seek) {
      suppressEcho();
      v.currentTime = msg.t;
    }
    if (msg.paused && !v.paused) {
      suppressEcho();
      v.pause();
    } else if (!msg.paused && v.paused) {
      suppressEcho();
      v.play().catch(() => toast('Press play to sync with your friend'));
    }
  }

  function onLocalEvent(e) {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || v !== video()) return;
    if (!room || Date.now() < suppressUntil) return;
    broadcast('sync');
  }

  document.addEventListener('play', onLocalEvent, true);
  document.addEventListener('pause', onLocalEvent, true);
  document.addEventListener('seeked', onLocalEvent, true);

  function multisetDifference(a, b) {
    const rest = [...b];
    return a.filter((x) => {
      const i = rest.indexOf(x);
      if (i >= 0) {
        rest.splice(i, 1);
        return false;
      }
      return true;
    });
  }

  function addChat(entry) {
    chat.push(entry);
    if (chat.length > MAX_CHAT_MESSAGES) chat.shift();
    renderChat();
  }

  function sendChat(text) {
    const clean = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (!clean || !room) return;
    send({ type: 'chat', text: clean });
    addChat({ name: myName || 'You', text: clean, me: true });
  }

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'peers') {
      const before = members.filter((m) => !m.you).map((m) => m.name);
      members = Array.isArray(msg.members) ? msg.members : [];
      const after = members.filter((m) => !m.you).map((m) => m.name);
      peers = msg.peers;
      isHost = Boolean(msg.host);
      if (after.length !== before.length) {
        for (const name of multisetDifference(after, before)) {
          toast(`${name} joined`);
          addChat({ system: true, text: `${name} joined` });
        }
        for (const name of multisetDifference(before, after)) {
          toast(`${name} left`);
          addChat({ system: true, text: `${name} left` });
        }
        if (after.length > before.length && isHost) broadcast('tick');
      }
      renderChat();
      return;
    }
    if (msg.type === 'chat') {
      const text = String(msg.text || '').slice(0, MAX_CHAT_LENGTH);
      const name = msg.from || 'Friend';
      if (!isOpen()) {
        unread += 1;
        toast(`${name}: ${text}`);
      }
      addChat({ name, text, me: false });
      return;
    }
    if (msg.type === 'sync' || msg.type === 'tick') apply(msg);
  }

  function closeSocket() {
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
    ws = null;
  }

  async function connect(code) {
    closeSocket();
    const { server, name } = await chrome.storage.sync.get({ server: DEFAULT_SERVER, name: '' });
    myName = name;
    room = code;
    status = 'connecting';
    peers = 0;
    members = [];
    isHost = false;
    mismatch = false;
    sessionStorage.setItem(SESSION_KEY, code);
    renderChat();
    try {
      ws = new WebSocket(server);
    } catch {
      status = 'error';
      return;
    }
    ws.onopen = () => {
      status = 'connected';
      send({ type: 'join', room: code, name: myName });
    };
    ws.onmessage = onMessage;
    ws.onerror = () => {
      status = 'error';
    };
    ws.onclose = () => {
      ws = null;
      peers = 0;
      members = [];
      if (!room) return;
      status = 'reconnecting';
      setTimeout(() => {
        if (room === code && !ws) connect(code);
      }, RECONNECT_MS);
    };
    if (!ticker) {
      ticker = setInterval(() => {
        if (isHost) broadcast('tick');
      }, TICK_MS);
    }
  }

  function disconnect() {
    room = null;
    status = 'idle';
    peers = 0;
    members = [];
    isHost = false;
    mismatch = false;
    chat = [];
    unread = 0;
    sessionStorage.removeItem(SESSION_KEY);
    closeSocket();
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    renderChat();
  }

  function overlayParent() {
    const host = document.fullscreenElement;
    return host && !(host instanceof HTMLVideoElement) ? host : document.body;
  }

  function toast(text) {
    let el = document.getElementById('hotstar-party-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hotstar-party-toast';
    }
    const parent = overlayParent();
    if (el.parentElement !== parent) parent.appendChild(el);
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  function ensureUi() {
    if (ui) return ui;
    const root = document.createElement('div');
    root.id = 'hotstar-party-ui';
    root.innerHTML =
      '<div class="hp-pill"><span>Chat</span><span class="hp-badge"></span></div>' +
      '<div class="hp-panel">' +
      '<div class="hp-head"><span>Room <b class="hp-room"></b></span><button class="hp-close" title="Minimise">&times;</button></div>' +
      '<div class="hp-members"></div>' +
      '<div class="hp-log"></div>' +
      '<div class="hp-input"><input maxlength="500" placeholder="Message" autocomplete="off"></div>' +
      '</div>';
    const q = (sel) => root.querySelector(sel);
    ui = {
      root,
      badge: q('.hp-badge'),
      room: q('.hp-room'),
      members: q('.hp-members'),
      log: q('.hp-log'),
      input: q('.hp-input input'),
    };
    root.addEventListener('click', (e) => e.stopPropagation());
    q('.hp-pill').addEventListener('click', () => setOpen(true));
    q('.hp-close').addEventListener('click', () => setOpen(false));
    for (const type of ['keydown', 'keyup', 'keypress']) {
      ui.input.addEventListener(type, (e) => e.stopPropagation());
    }
    ui.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      sendChat(ui.input.value);
      ui.input.value = '';
    });
    document.addEventListener('fullscreenchange', mountUi);
    return ui;
  }

  function mountUi() {
    if (!ui || !room) return;
    const parent = overlayParent();
    if (ui.root.parentElement !== parent) parent.appendChild(ui.root);
  }

  function isOpen() {
    return Boolean(ui && ui.root.classList.contains('open'));
  }

  function setOpen(open) {
    ensureUi().root.classList.toggle('open', open);
    if (open) {
      unread = 0;
      renderChat();
      ui.input.focus();
    }
  }

  function renderEntry(entry) {
    const el = document.createElement('div');
    if (entry.system) {
      el.className = 'hp-sys';
      el.textContent = entry.text;
      return el;
    }
    el.className = entry.me ? 'hp-msg me' : 'hp-msg';
    const who = document.createElement('small');
    who.textContent = entry.me ? myName || 'You' : entry.name;
    el.append(who, document.createTextNode(entry.text));
    return el;
  }

  function renderChat() {
    if (!room) {
      if (ui) ui.root.remove();
      return;
    }
    ensureUi();
    mountUi();
    ui.room.textContent = room;
    ui.badge.textContent = unread ? String(unread) : '';
    const others = members.filter((m) => !m.you).map((m) => m.name);
    ui.members.textContent = others.length ? `With ${others.join(', ')}` : 'Waiting for your friend to join';
    ui.log.replaceChildren(...chat.map(renderEntry));
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.name) {
      myName = changes.name.newValue || '';
      if (room) send({ type: 'name', name: myName });
      renderChat();
    }
    if (changes.server && room) connect(room);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg.type) {
      case 'getState':
        reply(state());
        return false;
      case 'create':
        connect(randomCode()).then(() => reply(state()));
        return true;
      case 'join':
        connect(String(msg.room || '').trim().toUpperCase()).then(() => reply(state()));
        return true;
      case 'leave':
        disconnect();
        reply(state());
        return false;
      default:
        return false;
    }
  });

  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) connect(saved);
})();
