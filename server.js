const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.json({ limit: '10mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const API_KEY = process.env.API_KEY || 'changeme';

// Track connected plugin clients
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Plugin connected. Total clients: ${clients.size}`);

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Plugin disconnected. Total clients: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
    clients.delete(ws);
  });

  // Send a hello so the plugin knows it's live
  ws.send(JSON.stringify({ type: 'connected', message: 'Langdock Deck Builder server ready.' }));
});

// Health check
app.get('/', (req, res) => {
  res.json({ ok: true, clients: clients.size });
});

// Langdock calls this with the deck spec JSON
app.post('/spec', (req, res) => {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const spec = req.body;
  if (!spec || !spec.pageName || !Array.isArray(spec.slides)) {
    return res.status(400).json({ error: 'Invalid spec — must have pageName and slides[]' });
  }

  if (clients.size === 0) {
    return res.status(503).json({ error: 'No plugin clients connected. Open Figma and run the plugin first.' });
  }

  const payload = JSON.stringify({ type: 'build', spec });
  let sent = 0;
  for (const client of clients) {
    try {
      client.send(payload);
      sent++;
    } catch (e) {
      clients.delete(client);
    }
  }

  console.log(`Spec dispatched to ${sent} client(s): ${spec.pageName}`);
  res.json({ ok: true, clientsNotified: sent });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Deck Builder server listening on port ${PORT}`);
});
