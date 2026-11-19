const DEFAULT_SERVER = HOTSTAR_PARTY_DEFAULTS.server;
const $ = (id) => document.getElementById(id);

async function call(msg) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    return null;
  }
}

function render(s) {
  const status = $('status');
  status.className = 'muted';
  if (!s) {
    status.textContent = 'Open a Hotstar video in this tab first.';
    $('out').hidden = true;
    $('in').hidden = true;
    return;
  }
  if (!s.room) {
    status.textContent = s.hasVideo
      ? 'Create a room and share the code, or join your friend\'s room.'
      : 'No video on this page yet. Open the title you both want to watch.';
    $('out').hidden = false;
    $('in').hidden = true;
    return;
  }
  $('out').hidden = true;
  $('in').hidden = false;
  $('roomCode').textContent = s.room;
  if (s.status === 'connecting') status.textContent = 'Connecting to relay...';
  else if (s.status === 'reconnecting') status.textContent = 'Connection lost, reconnecting...';
  else if (s.status === 'error') {
    status.textContent = 'Could not reach the relay server. Check the server URL below.';
    status.className = 'error';
  } else status.textContent = s.isHost ? 'You are the host. Your player leads.' : 'Following the host\'s player.';
  const others = (s.members || []).filter((m) => !m.you).map((m) => m.name);
  if (others.length === 0) $('peers').textContent = 'Waiting for your friend to join with this code.';
  else if (s.mismatch) $('peers').textContent = `${others.join(', ')} is on a different title.`;
  else $('peers').textContent = `Watching with ${others.join(', ')}.`;
}

async function refresh() {
  render(await call({ type: 'getState' }));
}

$('create').onclick = async () => render(await call({ type: 'create' }));
$('join').onclick = async () => {
  const code = $('code').value.trim();
  if (code.length < 4) return;
  render(await call({ type: 'join', room: code }));
};
$('code').onkeydown = (e) => {
  if (e.key === 'Enter') $('join').click();
};
$('leave').onclick = async () => render(await call({ type: 'leave' }));

let nameTimer = null;
$('name').oninput = () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => chrome.storage.sync.set({ name: $('name').value.trim() }), 400);
};

$('saveServer').onclick = async () => {
  const server = $('server').value.trim() || DEFAULT_SERVER;
  await chrome.storage.sync.set({ server });
  $('server').value = server;
  const button = $('saveServer');
  button.textContent = 'Saved';
  setTimeout(() => {
    button.textContent = 'Save';
  }, 1500);
};

chrome.storage.sync.get({ server: DEFAULT_SERVER, name: '' }).then(({ server, name }) => {
  $('server').value = server;
  $('name').value = name;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.name && document.activeElement !== $('name')) $('name').value = changes.name.newValue || '';
  if (changes.server) $('server').value = changes.server.newValue || DEFAULT_SERVER;
});
refresh();
setInterval(refresh, 1000);
