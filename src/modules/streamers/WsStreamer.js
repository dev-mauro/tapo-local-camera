const WebSocket = require('ws');

class WsStreamer {
    init(app, server, ffmpegManager) {
        // We use mpegts as it allows late-joiners to sync easily over websocket without complex FLV header caching
        ffmpegManager.addOutput([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-af', 'volume=8dB', // El micro de la Tapo entrega un nivel muy bajo; subir ganancia
            '-ar', '44100',      // Resample de audio
            '-b:a', '128k',
            '-f', 'mpegts',
            'pipe:1'
        ]);

        const wss = new WebSocket.Server({ noServer: true });
        this.wss = wss;

        wss.on('connection', (ws) => {
            console.log('Client connected to WebSocket stream');
            ws.on('close', () => {
                console.log('Client disconnected from WebSocket stream');
            });
        });

        // We need to attach to the ffmpeg process AFTER it starts
        this.wss = wss;
        console.log("WebSocket Streamer module initialized. Path: /ws");
    }

    onProcessStart(process) {
        // Si un cliente lento acumula más de este buffer, descartamos el chunk para
        // ese cliente en vez de dejar crecer la cola sin límite (protege la RAM).
        const MAX_BUFFERED = 4 * 1024 * 1024; // 4 MB

        process.stdout.on('data', (data) => {
            // Broadcast the MPEG-TS chunks to all connected WebSocket clients
            this.wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.bufferedAmount < MAX_BUFFERED) {
                    client.send(data, { binary: true });
                }
            });
        });
    }
}

module.exports = new WsStreamer();
