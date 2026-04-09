const WebSocket = require('ws');

class ControlSocket {
    constructor() {
        this.clients = new Map();
    }

    init() {
        const wss = new WebSocket.Server({ noServer: true });
        this.wss = wss;

        wss.on('connection', (ws) => {
            const socketId = Math.random().toString(36).substr(2, 9);
            this.clients.set(socketId, { ws, name: "Invitado" });

            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);

                    if (data.type === 'join') {
                        // User sets their name
                        this.clients.get(socketId).name = data.name || "Anon";
                        this.broadcastUsers();
                    }
                    
                    if (data.type === 'ping') {
                        // Ping pong para cálculo de latencia de red (Server Time)
                        ws.send(JSON.stringify({ type: 'pong', clientTime: data.clientTime, serverTime: Date.now() }));
                    }

                } catch (e) {
                    console.error("Error parsing control message", e);
                }
            });

            ws.on('close', () => {
                this.clients.delete(socketId);
                this.broadcastUsers(); // Update everyone that someone left
            });

            // Always update on connect
            this.broadcastUsers();
        });

        console.log("Control socket initialized on path: /control");
    }

    broadcastUsers() {
        const userList = Array.from(this.clients.values()).map(c => c.name);
        const payload = JSON.stringify({
            type: 'users_update',
            count: userList.length,
            list: userList
        });

        for (let { ws } of this.clients.values()) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }
}

module.exports = new ControlSocket();
