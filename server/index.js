// =====================================================
// MULTIPLAYER SERVER - WebSocket game server stub
// =====================================================
// Usage: node server/index.js
// Serves the game on port 3000 (or PORT env var)
// WebSocket runs on the SAME port.

import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

// --- Simple static file server ---
const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.woff2': 'font/woff2',
};

const STATIC_ROOT = path.resolve(__dirname, '../base/modular');

const httpServer = http.createServer((req, res) => {
    let filePath = path.join(STATIC_ROOT, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// --- WebSocket game server ---
// Attach WebSocketServer to the SAME http server instance
const wss = new WebSocketServer({ server: httpServer });

let nextPlayerId = 1;
const players = new Map(); // ws → { id, name, position, rotation }

const MAX_NAME_LENGTH = 16;
const JOIN_TIMEOUT_MS = 30000;

// Shared world seed — all players get the same seed so worlds match
let worldSeed = Math.floor(Math.random() * 0xFFFFFF);
console.log(`[Server] World seed: 0x${worldSeed.toString(16)}`);

wss.on('connection', (ws) => {
    // Server-authoritative join: a connection stays "pending" until it sends a
    // valid `join {name}`. Pending sockets are not in the players map, receive
    // no welcome and no broadcasts, and are dropped after JOIN_TIMEOUT_MS.
    let playerData = null;

    const joinTimeout = setTimeout(() => {
        if (!playerData) ws.close();
    }, JOIN_TIMEOUT_MS);

    function handleJoin(msg) {
        const name = String(msg.name ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_NAME_LENGTH);
        if (!name) {
            ws.send(JSON.stringify({ type: 'join_error', reason: 'invalid_name' }));
            return;
        }
        const taken = [...players.values()].some(
            p => p.name.toLowerCase() === name.toLowerCase()
        );
        if (taken) {
            ws.send(JSON.stringify({ type: 'join_error', reason: 'name_taken' }));
            return;
        }

        clearTimeout(joinTimeout);
        playerData = {
            id: nextPlayerId++,
            name,
            position: { x: 0, y: 0, z: 0 },
            rotation: 0
        };
        players.set(ws, playerData);

        // Send welcome with assigned ID, accepted name and world seed
        ws.send(JSON.stringify({
            type: 'welcome',
            id: playerData.id,
            name,
            seed: worldSeed,
            playerCount: players.size
        }));

        // Notify existing players about new player
        broadcast(ws, JSON.stringify({
            type: 'player_join',
            id: playerData.id,
            name,
            position: playerData.position,
            rotation: playerData.rotation
        }));

        // Send existing players to the new player
        for (const [otherWs, otherData] of players) {
            if (otherWs !== ws && otherWs.readyState === 1) {
                ws.send(JSON.stringify({
                    type: 'player_join',
                    id: otherData.id,
                    name: otherData.name,
                    position: otherData.position,
                    rotation: otherData.rotation,
                    inventory: otherData.inventory || null,
                    selectedSlot: otherData.selectedSlot ?? null
                }));
            }
        }

        console.log(`[Server] ${name} (#${playerData.id}) joined (${players.size} total)`);
    }

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw);

            // Until joined, the ONLY accepted message is `join`
            if (!playerData) {
                if (msg.type === 'join') handleJoin(msg);
                return;
            }

            const playerId = playerData.id;
            switch (msg.type) {
                case 'player_state':
                    playerData.position = msg.position;
                    playerData.rotation = msg.rotation;
                    // Relay to other players. Explicit allowlist (not a spread of `msg`)
                    // so this stays a deliberate contract — see NetworkManager.sendPlayerState
                    // for the full set of fields a client actually sends.
                    broadcast(ws, JSON.stringify({
                        type: 'player_state',
                        id: playerId,
                        position: msg.position,
                        rotation: msg.rotation,
                        isOnBoat: msg.isOnBoat,
                        activeAction: msg.activeAction,
                        // One-shot melee swing counter — remote clients diff this against
                        // their last-seen value to trigger the attack animation.
                        attackSeq: msg.attackSeq,
                        // Full 3D ship transform + speed, used by RemotePlayerManager to
                        // render a piloted remote ship exactly instead of approximating
                        // it from position-delta heading.
                        shipPosition: msg.shipPosition,
                        shipQuaternion: msg.shipQuaternion,
                        shipSpeed: msg.shipSpeed
                    }));
                    break;

                case 'world_event':
                    // Relay world events to all OTHER players
                    broadcast(ws, JSON.stringify({
                        type: 'world_event',
                        playerId,
                        ...msg
                    }));
                    break;

                case 'inventory_update':
                    playerData.inventory = msg.inventory;
                    playerData.selectedSlot = msg.selectedSlot;
                    broadcast(ws, JSON.stringify({
                        type: 'inventory_update',
                        id: playerId,
                        inventory: msg.inventory,
                        selectedSlot: msg.selectedSlot
                    }));
                    break;

                case 'chat':
                    broadcast(null, JSON.stringify({
                        type: 'chat',
                        playerId,
                        name: playerData.name,
                        text: msg.text
                    }));
                    break;
            }
        } catch (e) {
            console.warn('[Server] Bad message from player', playerData ? playerData.id : '(pending)');
        }
    });

    ws.on('close', () => {
        clearTimeout(joinTimeout);
        if (!playerData) return; // pending socket never joined — nothing to announce
        players.delete(ws);
        broadcast(null, JSON.stringify({
            type: 'player_leave',
            id: playerData.id,
            name: playerData.name
        }));
        console.log(`[Server] ${playerData.name} (#${playerData.id}) disconnected (${players.size} total)`);
    });
});

/**
 * Broadcast a message to all connected players except `excludeWs`
 */
function broadcast(excludeWs, data) {
    for (const [ws] of players) {
        if (ws !== excludeWs && ws.readyState === 1) {
            ws.send(data);
        }
    }
}

// Start the HTTP server (which also handles WebSocket upgrades)
httpServer.listen(PORT, () => {
    console.log(`[Server] Running on http://localhost:${PORT}`);
});
