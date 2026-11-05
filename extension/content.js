(() => {
  const DEFAULT_SERVER = 'ws://localhost:8790';
  const SESSION_KEY = 'hotstar-party.room';
  const TICK_MS = 2000;
  const RECONNECT_MS = 2000;
  const ECHO_WINDOW_MS = 600;
  const TICK_DRIFT_SECONDS = 1.5;
  const ACTION_DRIFT_SECONDS = 0.3;
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  let ws = null;
  let room = null;
  let status = 'idle';
  let isHost = false;
  let peers = 0;
  let mismatch = false;
  let suppressUntil = 0;
  let ticker = null;
  let toastTimer = null;

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
    return { room, status, isHost, peers, mismatch, hasVideo: Boolean(video()) };
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

  function broadcast(type) {
    const v = video();
    if (!v || peers === 0) return;
    send({ type, t: v.currentTime, paused: v.paused, path: location.pathname });
  }

  function apply(msg) {
    const v = video();
    if (!v) return;
    if (msg.path !== location.pathname) {
      if (!mismatch) toast('Your friend is watching something else');
      mismatch = true;
      return;
    }
    mismatch = false;
    const threshold = msg.type === 'tick' ? TICK_DRIFT_SECONDS : ACTION_DRIFT_SECONDS;
    if (!v.seeking && Math.abs(v.currentTime - msg.t) > threshold) {
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

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'peers') {
      const joined = msg.peers > peers;
      const left = msg.peers < peers;
      peers = msg.peers;
      isHost = Boolean(msg.host);
      if (joined) toast('Friend joined');
      if (left) toast('Friend left');
      if (joined && isHost) broadcast('tick');
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
    const { server } = await chrome.storage.sync.get({ server: DEFAULT_SERVER });
    room = code;
    status = 'connecting';
    peers = 0;
    isHost = false;
    mismatch = false;
    sessionStorage.setItem(SESSION_KEY, code);
    try {
      ws = new WebSocket(server);
    } catch {
      status = 'error';
      return;
    }
    ws.onopen = () => {
      status = 'connected';
      send({ type: 'join', room: code });
    };
    ws.onmessage = onMessage;
    ws.onerror = () => {
      status = 'error';
    };
    ws.onclose = () => {
      ws = null;
      peers = 0;
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
    isHost = false;
    mismatch = false;
    sessionStorage.removeItem(SESSION_KEY);
    closeSocket();
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function toast(text) {
    let el = document.getElementById('hotstar-party-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hotstar-party-toast';
      el.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:2147483647;padding:10px 14px;' +
        'background:rgba(0,0,0,.85);color:#fff;font:14px system-ui,sans-serif;' +
        'border-radius:8px;pointer-events:none;transition:opacity .3s;opacity:0';
    }
    const host = document.fullscreenElement;
    const parent = host && !(host instanceof HTMLVideoElement) ? host : document.body;
    if (el.parentElement !== parent) parent.appendChild(el);
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.style.opacity = '0';
    }, 2500);
  }

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
