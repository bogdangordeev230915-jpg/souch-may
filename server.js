const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// Раздаём папку public (там лежит crestore.html и прочее)
app.use(express.static(path.join(__dirname, 'public')));

// Health-check — Render любит дёргать корень
app.get('/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);

// WebSocket-сервер живёт на том же порту и пути /ws
const wss = new WebSocketServer({ server, path: '/ws' });

// История сообщений в памяти (последние 200)
const history = [];
const MAX_HISTORY = 200;

function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(data);
  });
}

wss.on('connection', (ws) => {
  // Отправляем новому клиенту всю историю
  ws.send(JSON.stringify({ type: 'history', messages: history }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.text !== 'string') return;

    const clean = {
      text: msg.text.slice(0, 1000),
      from: String(msg.from || 'Гость').slice(0, 32),
      time: Date.now(),
    };

    history.push(clean);
    if (history.length > MAX_HISTORY) history.shift();

    broadcast({ type: 'message', message: clean });
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('CreStore server running on port ' + PORT);
});