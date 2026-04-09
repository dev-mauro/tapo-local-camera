const express = require('express');
const http = require('http');
const path = require('path');
const config = require('../config');
const FfmpegManager = require('../core/ffmpegManager');
const recorder = require('../modules/recorder');
const controlSocket = require('../modules/control');
const imaging = require('../modules/imaging');

const app = express();
const server = http.createServer(app);

// Servir la aplicación cliente
app.use(express.static(path.join(__dirname, '../../public')));

// Servir los archivos HLS cuando la estrategia sea hls
// Solo exponemos la carpeta a través de express si se están generando
app.use('/hls', express.static(path.join(__dirname, '../../public/hls')));

const initServer = () => {
    // 1. Iniciar gestor base de FFmpeg
    const ffmpegManager = new FfmpegManager(config.RTSP_URL);

    // 2. Cargar módulos
    // Siempre cargamos el módulo de grabación y control web
    recorder.init(app, server, ffmpegManager);
    controlSocket.init();

    // Variable global para que FFmpeg Manager notifique rechazos de red
    global.broadcastError = (msg) => {
        if (controlSocket.wss) {
            controlSocket.wss.clients.forEach(client => {
                if (client.readyState === 1) { // WebSocket.OPEN
                    client.send(JSON.stringify({ type: 'server_fatal_error', message: msg }));
                }
            });
        }
    };

    let activeStreamer = null;
    if (config.STREAM_STRATEGY === 'hls') {
        activeStreamer = require('../modules/streamers/HlsStreamer');
    } else {
        activeStreamer = require('../modules/streamers/WsStreamer');
    }

    activeStreamer.init(app, server, ffmpegManager);

    // Sistema de enrutamiento Master para WebSockets múltiples en el mismo puerto
    server.on('upgrade', (request, socket, head) => {
        const pathname = request.url;
        if (pathname === '/control') {
            if (controlSocket.wss) {
                controlSocket.wss.handleUpgrade(request, socket, head, (ws) => {
                    controlSocket.wss.emit('connection', ws, request);
                });
            }
        } else if (pathname === '/ws') {
            if (activeStreamer.wss) {
                activeStreamer.wss.handleUpgrade(request, socket, head, (ws) => {
                    activeStreamer.wss.emit('connection', ws, request);
                });
            }
        } else {
            socket.destroy();
        }
    });

    // 3. API endpoint para que el frontend sepa cómo conectarse
    app.get('/api/strategy', (req, res) => {
        res.json({ strategy: config.STREAM_STRATEGY });
    });

    // 4. Imaging API
    app.get('/api/imaging', async (req, res) => {
        try {
            const settings = await imaging.getSettings();
            res.json({ ok: true, settings });
        } catch (err) {
            res.status(503).json({ ok: false, error: err.message });
        }
    });

    app.post('/api/imaging', express.json(), async (req, res) => {
        try {
            await imaging.applySettings(req.body);
            res.json({ ok: true });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // 4. Iniciar FFmpeg
    const process = ffmpegManager.start();

    // 5. Hook de post-inicio para módulos que necesiten el proceso nativo (ej. WS Streamer)
    if (process && typeof activeStreamer.onProcessStart === 'function') {
        activeStreamer.onProcessStart(process);
    }

    // 6. Iniciar red web
    server.listen(config.PORT, () => {
        console.log(`Server listening on port ${config.PORT}`);
        console.log(`Open http://localhost:${config.PORT}/camara to view the stream.`);
    });
};

module.exports = initServer;
