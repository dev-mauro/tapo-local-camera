const express = require('express');
const http = require('http');
const path = require('path');
const config = require('../config');
const FfmpegManager = require('../core/ffmpegManager');
const recorder = require('../modules/recorder');
const controlSocket = require('../modules/control');
const imaging = require('../modules/imaging');
const recordingsRouter = require('../modules/recordings');
const WsStreamer = require('../modules/streamers/WsStreamer');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, '../../public')));

const initServer = () => {
    const ffmpegManager = new FfmpegManager(config.RTSP_URL);

    recorder.init(app, server, ffmpegManager);
    controlSocket.init();

    global.broadcastError = (msg) => {
        if (controlSocket.wss) {
            controlSocket.wss.clients.forEach(client => {
                if (client.readyState === 1) {
                    client.send(JSON.stringify({ type: 'server_fatal_error', message: msg }));
                }
            });
        }
    };

    WsStreamer.init(app, server, ffmpegManager);

    server.on('upgrade', (request, socket, head) => {
        const pathname = request.url;
        if (pathname === '/control') {
            if (controlSocket.wss) {
                controlSocket.wss.handleUpgrade(request, socket, head, (ws) => {
                    controlSocket.wss.emit('connection', ws, request);
                });
            }
        } else if (pathname === '/ws') {
            if (WsStreamer.wss) {
                WsStreamer.wss.handleUpgrade(request, socket, head, (ws) => {
                    WsStreamer.wss.emit('connection', ws, request);
                });
            }
        } else {
            socket.destroy();
        }
    });

    // Imaging API
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

    // Recordings API
    app.use('/api/recordings', recordingsRouter);

    const process = ffmpegManager.start();
    if (process && typeof WsStreamer.onProcessStart === 'function') {
        WsStreamer.onProcessStart(process);
    }

    server.listen(config.PORT, () => {
        console.log(`Server listening on port ${config.PORT}`);
        console.log(`Open http://localhost:${config.PORT}/camara to view the stream.`);
    });
};

module.exports = initServer;
