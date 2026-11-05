const http = require('http');
const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT) || 8790;
const MAX_MESSAGE_BYTES = 4096;
const ROOM_PATTERN = /^[A-Z0-9]{4,8}$/;
const rooms = new Map();

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('hotstar-party relay\n');
});
const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

function roster(code) {
  const members = rooms.get(code);
  if (!members) return;
  const list = [...members];
  list.forEach((socket, i) => {
    socket.send(JSON.stringify({ type: 'peers', peers: list.length - 1, host: i === 0 }));
  });
}

wss.on('connection', (socket) => {
  let code = null;

  function leave() {
    if (!code) return;
    const members = rooms.get(code);
    members.delete(socket);
    if (members.size === 0) rooms.delete(code);
    else roster(code);
    code = null;
  }

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join') {
      if (typeof msg.room !== 'string' || !ROOM_PATTERN.test(msg.room)) return;
      leave();
      code = msg.room;
      if (!rooms.has(code)) rooms.set(code, new Set());
      rooms.get(code).add(socket);
      roster(code);
      return;
    }
    if (!code) return;
    const payload = JSON.stringify(msg);
    for (const peer of rooms.get(code)) {
      if (peer !== socket && peer.readyState === peer.OPEN) peer.send(payload);
    }
  });

  socket.on('close', leave);
  socket.on('error', leave);
});

server.listen(port, () => {
  console.log(`hotstar-party relay listening on port ${port}`);
});
