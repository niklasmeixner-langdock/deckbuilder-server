import { randomUUID } from 'node:crypto';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const app = express();
app.use(express.json({ limit: '10mb' }));

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`Plugin connected. Total: ${clients.size}`);
  ws.send(JSON.stringify({ type: 'connected', message: 'Deck Builder ready.' }));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// One MCP server instance, sessions keyed by id
const mcp = new McpServer({ name: 'deckbuilder', version: '1.0.0' });
const transports = {};

mcp.tool(
  'build_deck',
  'Build a branded Figma presentation deck. Pushes the spec to the connected Figma plugin.',
  {
    spec: z.object({
      pageName: z.string(),
      common: z.object({ presentationTitle: z.string() }).optional(),
      slides: z.array(z.object({}).passthrough())
    }).passthrough()
  },
  async ({ spec }) => {
    if (clients.size === 0) {
      return {
        content: [{ type: 'text', text: 'No Figma plugin connected. Open Figma and run the Deck Builder plugin first.' }],
        isError: true
      };
    }
    const payload = JSON.stringify({ type: 'build', spec });
    let sent = 0;
    for (const client of clients) {
      try { client.send(payload); sent++; }
      catch { clients.delete(client); }
    }
    console.log(`Dispatched to ${sent} client(s): ${spec.pageName}`);
    return {
      content: [{ type: 'text', text: `Building "${spec.pageName}" — sent to ${sent} Figma client(s).` }]
    };
  }
);

app.get('/', (req, res) => res.json({ ok: true, clients: clients.size }));

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  let transport = transports[sessionId];

  if (!transport) {
    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'No session — send initialize first' });
      return;
    }
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports[id] = transport; }
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    await mcp.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  const transport = transports[sessionId];
  if (!transport) { res.status(400).json({ error: 'Unknown session' }); return; }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (transports[sessionId]) {
    await transports[sessionId].close();
    delete transports[sessionId];
  }
  res.status(200).end();
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Deck Builder MCP server on port ${PORT}`));
