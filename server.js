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

function makeMcpServer() {
  const mcp = new McpServer({ name: 'deckbuilder', version: '1.0.0' });
  mcp.tool(
    'build_deck',
    'Build a branded Figma presentation deck. Pushes the spec to the connected Figma plugin, which clones master frames and applies all text, image, and SVG updates.',
    {
      spec: z.object({
        pageName: z.string().describe('Name of the Figma page, e.g. "Deck: Acme Corp"'),
        common: z.object({ presentationTitle: z.string() }).optional(),
        slides: z.array(z.object({}).passthrough()).describe('Array of slide specs')
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
      console.log(`Spec dispatched to ${sent} client(s): ${spec.pageName}`);
      return {
        content: [{ type: 'text', text: `Building "${spec.pageName}" — dispatched to ${sent} Figma client(s).` }]
      };
    }
  );
  return mcp;
}

app.get('/', (req, res) => res.json({ ok: true, clients: clients.size }));

app.post('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcp = makeMcpServer();
    res.on('close', () => { transport.close(); mcp.server.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/mcp', async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcp = makeMcpServer();
    res.on('close', () => { transport.close(); mcp.server.close(); });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('MCP error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Deck Builder MCP server on port ${PORT}`));
