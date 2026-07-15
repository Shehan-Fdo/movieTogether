import http from 'http';
import { WebSocketServer } from 'ws';
import app from './app.js';
import crypto from 'crypto';

const port = process.env.PORT || 5000;
const server = http.createServer(app);

const wss = new WebSocketServer({ server });
const clients = new Map();
let currentMovie = null;

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  clients.set(ws, { id: clientId });
  console.log(`Client connected: ${clientId}. Total: ${clients.size}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          console.log(`Client ${clientId} joined`);
          if (currentMovie) {
            ws.send(JSON.stringify({ type: 'movie-change', fileName: currentMovie }));
          }
          broadcast({ type: 'state-request', targetId: clientId }, clientId);
          break;

        case 'state-response':
          for (const [client, meta] of clients.entries()) {
            if (meta.id === data.targetId) {
              client.send(JSON.stringify({
                type: 'sync',
                action: data.playing ? 'play' : 'pause',
                time: data.time,
                fileName: data.fileName
              }));
              break;
            }
          }
          break;

        case 'play':
        case 'pause':
        case 'seek':
          broadcast({
            type: 'sync',
            action: data.type,
            time: data.time,
            fileName: data.fileName,
            senderId: clientId
          }, clientId);
          break;

        case 'movie-select':
          currentMovie = data.fileName;
          broadcast({
            type: 'movie-change',
            fileName: data.fileName,
            senderId: clientId
          });
          break;

        default:
          console.warn(`Unknown message type: ${data.type}`);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`Client disconnected: ${clientId}. Total: ${clients.size}`);
  });
});

function broadcast(messageObj, excludeClientId = null) {
  const payload = JSON.stringify(messageObj);
  for (const [ws, meta] of clients.entries()) {
    if (excludeClientId && meta.id === excludeClientId) {
      continue;
    }
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
