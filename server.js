import { randomUUID } from 'node:crypto';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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

// sessions: id -> { server, transport }
const sessions = {};

function createSession() {
  const server = new McpServer({ name: 'deckbuilder', version: '1.0.0' });

  server.tool(
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

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => { sessions[id] = { server, transport }; }
  });
  transport.onclose = () => {
    if (transport.sessionId) delete sessions[transport.sessionId];
  };

  return { server, transport };
}

app.get('/', (req, res) => res.json({ ok: true, clients: clients.size }));

app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    const existing = sessions[sessionId];

    if (existing) {
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!req.body || req.body.method !== 'initialize') {
      res.status(400).json({ error: 'No session — send initialize first' });
      return;
    }

    const { server, transport } = createSession();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP POST error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    const existing = sessions[sessionId];
    if (!existing) { res.status(400).json({ error: 'Unknown session' }); return; }
    await existing.transport.handleRequest(req, res);
  } catch (err) {
    console.error('MCP GET error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessions[sessionId]) {
    await sessions[sessionId].transport.close();
    delete sessions[sessionId];
  }
  res.status(200).end();
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Deck Builder MCP server on port ${PORT}`));
