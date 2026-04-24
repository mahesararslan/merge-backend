import { Logger } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import * as Y from 'yjs';
import { CanvasPermissionService } from './canvas-permission.service';

const logger = new Logger('YjsWsServer');

// In-memory Yjs docs keyed by room name
const docs = new Map<string, Y.Doc>();

function getYDoc(room: string): Y.Doc {
  if (!docs.has(room)) {
    const doc = new Y.Doc();
    docs.set(room, doc);
  }
  return docs.get(room)!;
}

export function cleanupYjsRoom(sessionId: string) {
  const room = `canvas-${sessionId}`;
  const doc = docs.get(room);
  if (doc) {
    doc.destroy();
    docs.delete(room);
    logger.log(`Cleaned up Yjs room ${room}`);
  }
}

// Yjs sync protocol message types
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_SYNC_STEP1 = 0;
const MSG_SYNC_STEP2 = 1;
const MSG_YJS_UPDATE = 2;

interface AuthedWs extends WebSocket {
  userId?: string;
  sessionId?: string;
  room?: string;
  isAlive?: boolean;
}

export function setupYjsWebSocket(
  server: HttpServer,
  jwtService: JwtService,
  permissionService: CanvasPermissionService,
) {
  const wss = new WebSocketServer({ noServer: true });

  // Handle upgrade requests on /yjs path
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    if (!url.pathname.startsWith('/yjs/')) {
      return; // Let other handlers (Socket.IO) handle this
    }

    const sessionId = url.pathname.replace('/yjs/', '');
    const token = url.searchParams.get('token');

    if (!token || !sessionId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const payload = jwtService.verify(token);
      const userId = payload.sub || payload.id;

      wss.handleUpgrade(request, socket, head, (ws: AuthedWs) => {
        ws.userId = userId;
        ws.sessionId = sessionId;
        ws.room = `canvas-${sessionId}`;
        ws.isAlive = true;
        wss.emit('connection', ws, request);
      });
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws: AuthedWs) => {
    const room = ws.room!;
    const doc = getYDoc(room);

    logger.log(`Yjs client connected: user=${ws.userId} room=${room}`);

    // Send sync step 1 (full state vector)
    const stateVector = Y.encodeStateVector(doc);
    const syncStep1 = new Uint8Array(2 + stateVector.length);
    syncStep1[0] = MSG_SYNC;
    syncStep1[1] = MSG_SYNC_STEP1;
    syncStep1.set(stateVector, 2);
    ws.send(syncStep1);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = new Uint8Array(data);
        if (message.length < 1) return;

        const msgType = message[0];

        if (msgType === MSG_SYNC) {
          if (message.length < 2) return;
          const syncType = message[1];
          const payload = message.slice(2);

          if (syncType === MSG_SYNC_STEP1) {
            // Client requesting sync - send our state as step 2
            const update = Y.encodeStateAsUpdate(doc, payload);
            const response = new Uint8Array(2 + update.length);
            response[0] = MSG_SYNC;
            response[1] = MSG_SYNC_STEP2;
            response.set(update, 2);
            ws.send(response);
          } else if (syncType === MSG_SYNC_STEP2 || syncType === MSG_YJS_UPDATE) {
            // Client sending an update - check permissions
            const allowed = await permissionService.canDraw(ws.sessionId!, ws.userId!);
            if (!allowed) {
              // Silently drop the update - client is read-only
              return;
            }

            // Apply update to server doc
            Y.applyUpdate(doc, payload);

            // Broadcast to all other clients in the same room
            wss.clients.forEach((client: AuthedWs) => {
              if (client !== ws && client.room === room && client.readyState === WebSocket.OPEN) {
                client.send(data);
              }
            });
          }
        } else if (msgType === MSG_AWARENESS) {
          // Broadcast awareness to all other clients in the room
          wss.clients.forEach((client: AuthedWs) => {
            if (client !== ws && client.room === room && client.readyState === WebSocket.OPEN) {
              client.send(data);
            }
          });
        }
      } catch (err) {
        logger.error(`Yjs message error: ${err}`);
      }
    });

    ws.on('close', () => {
      logger.log(`Yjs client disconnected: user=${ws.userId} room=${room}`);
    });
  });

  // Heartbeat to detect broken connections
  const interval = setInterval(() => {
    wss.clients.forEach((ws: AuthedWs) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  logger.log('Yjs WebSocket server attached at /yjs/:sessionId');
  return wss;
}
