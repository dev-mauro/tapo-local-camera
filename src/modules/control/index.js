const WebSocket = require('ws');
const ptz = require('../ptz');
const cameraEvents = require('../events');
const config = require('../../config');

class ControlSocket {
    constructor() {
        this.clients = new Map();
        this.wss = null;
    }

    init() {
        const wss = new WebSocket.Server({ noServer: true });
        this.wss = wss;

        // Initialize PTZ controller (which in turn initializes imaging + events)
        ptz.init(config.RTSP_URL);

        // Wire the events module to broadcast through this socket
        cameraEvents.setBroadcast((payload) => this.broadcast(payload));

        wss.on('connection', (ws) => {
            const socketId = Math.random().toString(36).substr(2, 9);
            this.clients.set(socketId, { ws, name: "Invitado" });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);

                    if (data.type === 'join') {
                        this.clients.get(socketId).name = data.name || "Anon";
                        this.broadcastUsers();
                    }
                    
                    if (data.type === 'ping') {
                        ws.send(JSON.stringify({ type: 'pong', clientTime: data.clientTime, serverTime: Date.now() }));
                    }

                    // --- PTZ Commands ---
                    if (data.type === 'ptz_move') {
                        ptz.move(data.direction, data.speed || 0.5);
                    }

                    if (data.type === 'ptz_stop') {
                        ptz.stop();
                    }

                } catch (e) {
                    console.error("Error parsing control message", e);
                }
            });

            ws.on('close', () => {
                this.clients.delete(socketId);
                this.broadcastUsers();
            });

            this.broadcastUsers();
        });

        console.log("Control socket initialized on path: /control");
    }

    /**
     * Broadcast a JSON payload to all connected clients.
     * @param {object} payload
     */
    broadcast(payload) {
        const msg = JSON.stringify(payload);
        for (let { ws } of this.clients.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(msg);
            }
        }
    }

    broadcastUsers() {
        const userList = Array.from(this.clients.values()).map(c => c.name);
        this.broadcast({
            type: 'users_update',
            count: userList.length,
            list: userList,
        });
    }
}

module.exports = new ControlSocket();
