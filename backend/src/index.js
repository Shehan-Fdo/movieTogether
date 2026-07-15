import http from 'http';
import { WebSocketServer } from 'ws';
import app from './app.js';
import crypto from 'crypto';

const port = process.env.PORT || 5000;
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map();
let currentMovie = null;
const bufferingUsers = new Set();

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  clients.set(ws, { id: clientId });
  console.log(`Client connected: ${clientId}. Total: ${clients.size}`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          const meta = clients.get(ws);
          if (meta) {
            meta.username = data.username;
            meta.latency = null;
            meta.speed = null;
          }
          console.log(`Client ${clientId} (${data.username || 'unknown'}) joined`);
          if (currentMovie) {
            ws.send(JSON.stringify({ type: 'movie-change', fileName: currentMovie }));
          }
          broadcastUserList();
          broadcast({ type: 'state-request', targetId: clientId }, clientId);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
          break;

        case 'latency-report':
          const currentMeta = clients.get(ws);
          if (currentMeta) {
            currentMeta.latency = data.latency;
            currentMeta.speed = data.speed;
          }
          broadcastUserList();
          break;

        case 'buffering':
          bufferingUsers.add(data.username);
          console.log(`User ${data.username} is buffering. Active:`, Array.from(bufferingUsers));
          broadcast({ type: 'pause-for-buffer', username: data.username });
          break;

        case 'buffered':
          bufferingUsers.delete(data.username);
          console.log(`User ${data.username} finished buffering. Remaining:`, Array.from(bufferingUsers));
          if (bufferingUsers.size === 0) {
            broadcast({ type: 'resume-from-buffer' });
          }
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
          const senderMeta = clients.get(ws);
          broadcast({
            type: 'sync',
            action: data.type,
            time: data.time,
            fileName: data.fileName,
            senderId: clientId,
            senderUsername: senderMeta ? senderMeta.username : 'Someone'
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
    const meta = clients.get(ws);
    if (meta && meta.username) {
      bufferingUsers.delete(meta.username);
      if (bufferingUsers.size === 0) {
        broadcast({ type: 'resume-from-buffer' });
      }
    }
    clients.delete(ws);
    console.log(`Client disconnected: ${clientId}. Total: ${clients.size}`);
    broadcastUserList();
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

function broadcastUserList() {
  const userList = Array.from(clients.values()).map(c => ({
    username: c.username,
    latency: c.latency || null,
    speed: c.speed || null
  })).filter(u => u.username);
  broadcast({ type: 'status-update', users: userList });
}

server.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
