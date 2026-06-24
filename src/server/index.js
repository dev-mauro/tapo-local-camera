const express = require('express');
const http = require('http');
const path = require('path');
const config = require('../config');
const FfmpegManager = require('../core/ffmpegManager');
const Go2rtcManager = require('../core/go2rtcManager');
const recorder = require('../modules/recorder');
const controlSocket = require('../modules/control');
const imaging = require('../modules/imaging');
const recordingsRouter = require('../modules/recordings');

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, '../../public')));

// Configuración inyectada al frontend (puerto y nombre del stream de go2rtc).
app.get('/camara/config.js', (req, res) => {
    res.type('application/javascript');
    res.send(
        `window.GO2RTC_API_PORT = ${config.GO2RTC_API_PORT};\n` +
        `window.GO2RTC_STREAM = ${JSON.stringify(config.STREAM_NAME)};\n`
    );
});

const initServer = () => {
    // go2rtc es el único consumidor del RTSP de la cámara.
    const go2rtc = new Go2rtcManager({
        rtspUrl: config.RTSP_URL,
        streamName: config.STREAM_NAME,
        apiPort: config.GO2RTC_API_PORT,
        rtspPort: config.GO2RTC_RTSP_PORT,
        webrtcPort: config.GO2RTC_WEBRTC_PORT,
        binPath: config.GO2RTC_BIN,
    });
    go2rtc.start();

    // El grabador FFmpeg se alimenta del re-stream local de go2rtc, no de la cámara.
    const ffmpegManager = new FfmpegManager(go2rtc.localRtspUrl);
    recorder.init(app, server, ffmpegManager);

    // ONVIF (PTZ, imaging, eventos). Usa las credenciales de config.RTSP_URL (la cámara).
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

    server.on('upgrade', (request, socket, head) => {
        const pathname = request.url;
        if (pathname === '/control') {
            if (controlSocket.wss) {
                controlSocket.wss.handleUpgrade(request, socket, head, (ws) => {
                    controlSocket.wss.emit('connection', ws, request);
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

    // Damos un margen a go2rtc para levantar el re-stream antes de grabar.
    // (Si aún no está listo, FfmpegManager reintenta automáticamente.)
    setTimeout(() => ffmpegManager.start(), 2000);

    server.listen(config.PORT, () => {
        console.log(`Server listening on port ${config.PORT}`);
        console.log(`Open http://localhost:${config.PORT}/camara to view the stream.`);
    });
};

module.exports = initServer;
