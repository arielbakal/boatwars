// =====================================================
// NETWORK MANAGER - WebSocket client stub for
//                   multiplayer (to be implemented)
// =====================================================

import MessageProtocol from './MessageProtocol.js';

export default class NetworkManager {
    constructor() {
        this.ws = null;
        this.connected = false;
        this.playerId = null;
        this.remotePlayers = new Map();   // id → { position, rotation, state }
        this.onPlayerJoin = null;         // callback(id, data)
        this.onPlayerLeave = null;        // callback(id)
        this.onPlayerUpdate = null;       // callback(id, data)
        this.onWorldEvent = null;         // callback(event)
        this.onWelcome = null;            // callback(data) - receives seed, playerCount
        this.onInventoryUpdate = null;    // callback(id, data)
        this._sendQueue = [];
        this._lastSendTime = 0;
        this.SEND_RATE = 1000 / 20;       // 20 ticks/sec
        this.worldSeed = null;            // seed from server
    }

    /**
     * Connect to game server
     * @param {string} url - WebSocket URL e.g. ws://localhost:3000
     * @returns {Promise<void>}
     */
    connect(url) {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(url);
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    this.connected = true;
                    console.log('[Network] Connected to', url);
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this._handleMessage(event.data);
                };

                this.ws.onclose = () => {
                    this.connected = false;
                    this.remotePlayers.clear();
                    console.log('[Network] Disconnected');
                };

                this.ws.onerror = (err) => {
                    console.error('[Network] Error', err);
                    reject(err);
                };
            } catch (err) {
                reject(err);
            }
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    /**
     * Send player state snapshot (position, rotation, action)
     */
    sendPlayerState(state) {
        if (!this.connected) return;
        const now = performance.now();
        if (now - this._lastSendTime < this.SEND_RATE) return;
        this._lastSendTime = now;

        this._send(MessageProtocol.encode({
            type: 'player_state',
            position: {
                x: state.player.pos.x,
                y: state.player.pos.y,
                z: state.player.pos.z
            },
            rotation: state.player.targetRotation || 0,
            isOnBoat: state.isOnBoat,
            activeAction: state.isChopping ? 'chop' : state.isMining ? 'mine' : null,
            // Melee attack is a one-shot ~0.4s swing, not a held state like chop/mine,
            // so a boolean risks being missed by an unluckily-timed 20Hz send. A
            // monotonically-increasing counter is robust instead: remote clients
            // trigger a full swing whenever they observe it increase, even if they
            // only ever see one packet during the swing's lifetime.
            attackSeq: state.attackSeq || 0,
            // Ship 3D state for remote rendering
            shipPosition: state.isOnBoat && state.activeBoat ? {
                x: state.activeBoat.position.x,
                y: state.activeBoat.position.y,
                z: state.activeBoat.position.z
            } : null,
            shipQuaternion: state.isOnBoat ? {
                x: state.shipQuaternion.x,
                y: state.shipQuaternion.y,
                z: state.shipQuaternion.z,
                w: state.shipQuaternion.w
            } : null,
            shipSpeed: state.isOnBoat ? state.boatSpeed : 0
        }));
    }

    /**
     * Broadcast a world-changing event (tree chopped, entity spawned, etc.)
     */
    sendWorldEvent(event) {
        if (!this.connected) return;
        this._send(MessageProtocol.encode({
            type: 'world_event',
            ...event
        }));
    }

    /**
     * Broadcast inventory snapshot to other players
     */
    sendInventoryUpdate(inventory, selectedSlot) {
        if (!this.connected) return;
        // Serialize inventory: convert THREE.Color to hex integers for transmission
        const serialized = inventory.map(item => {
            if (!item) return null;
            return {
                type: item.type,
                color: item.color ? item.color.getHex() : 0xffffff,
                count: item.count || 1,
                age: item.age || 0
            };
        });
        this._send(MessageProtocol.encode({
            type: 'inventory_update',
            inventory: serialized,
            selectedSlot: selectedSlot
        }));
    }

    _send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
    }

    _handleMessage(raw) {
        const msg = MessageProtocol.decode(raw);
        if (!msg) return;

        switch (msg.type) {
            case 'welcome':
                this.playerId = msg.id;
                this.worldSeed = msg.seed || null;
                console.log('[Network] Assigned ID:', msg.id, 'Seed:', msg.seed);
                if (this.onWelcome) this.onWelcome(msg);
                break;

            case 'player_join':
                this.remotePlayers.set(msg.id, {
                    position: msg.position,
                    rotation: msg.rotation
                });
                if (this.onPlayerJoin) this.onPlayerJoin(msg.id, msg);
                break;

            case 'player_leave':
                this.remotePlayers.delete(msg.id);
                if (this.onPlayerLeave) this.onPlayerLeave(msg.id);
                break;

            case 'player_state':
                if (this.remotePlayers.has(msg.id)) {
                    const remote = this.remotePlayers.get(msg.id);
                    remote.position = msg.position;
                    remote.rotation = msg.rotation;
                    remote.isOnBoat = msg.isOnBoat;
                    remote.activeAction = msg.activeAction;
                    remote.shipPosition = msg.shipPosition;
                    remote.shipQuaternion = msg.shipQuaternion;
                    remote.shipSpeed = msg.shipSpeed;
                }
                if (this.onPlayerUpdate) this.onPlayerUpdate(msg.id, msg);
                break;

            case 'world_event':
                if (this.onWorldEvent) this.onWorldEvent(msg);
                break;

            case 'inventory_update':
                if (this.onInventoryUpdate) this.onInventoryUpdate(msg.id, msg);
                break;
        }
    }

    /**
     * Interpolate remote players (call each frame)
     */
    update(dt) {
        // Future: implement position interpolation / extrapolation
        // for smooth remote player movement
    }
}
