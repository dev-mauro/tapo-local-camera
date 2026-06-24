const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Gestiona el proceso de go2rtc, que es el ÚNICO consumidor del RTSP de la cámara.
 * go2rtc:
 *   - Sirve WebRTC al navegador (baja latencia, audio nativo).
 *   - Expone un re-stream RTSP local (rtsp://127.0.0.1:<rtspPort>/<stream>) del que
 *     se alimenta el grabador FFmpeg, de modo que la cámara recibe una sola conexión.
 *
 * Genera su propio archivo de configuración a partir de la RTSP_URL y se reinicia
 * automáticamente si el proceso muere.
 */
class Go2rtcManager {
    constructor({ rtspUrl, streamName, apiPort, rtspPort, webrtcPort, binPath }) {
        this.rtspUrl = rtspUrl;
        this.streamName = streamName;
        this.apiPort = apiPort;
        this.rtspPort = rtspPort;
        this.webrtcPort = webrtcPort;
        this.binPath = binPath;
        this.process = null;
        this.stopping = false;
        this.configPath = path.join(os.tmpdir(), `go2rtc.${streamName}.yaml`);
    }

    /** Devuelve la URL del re-stream RTSP local para el grabador. */
    get localRtspUrl() {
        return `rtsp://127.0.0.1:${this.rtspPort}/${this.streamName}`;
    }

    /** Resuelve la ruta del binario de go2rtc. */
    resolveBin() {
        if (this.binPath && fs.existsSync(this.binPath)) return this.binPath;

        const exe = os.platform() === 'win32' ? 'go2rtc.exe' : 'go2rtc';
        const local = path.resolve(__dirname, '../../bin', exe);
        if (fs.existsSync(local)) return local;

        // Último recurso: confiar en el PATH del sistema.
        return exe;
    }

    /** Escribe el archivo de configuración de go2rtc. */
    writeConfig() {
        const cfg =
`# Generado automáticamente por go2rtcManager — no editar a mano.
streams:
  ${this.streamName}: ${this.rtspUrl}

api:
  listen: ":${this.apiPort}"
  origin: "*"   # Permite la señalización WebRTC desde el origen de la app (otro puerto)

rtsp:
  listen: ":${this.rtspPort}"

webrtc:
  listen: ":${this.webrtcPort}"

log:
  level: info
`;
        fs.writeFileSync(this.configPath, cfg, 'utf8');
    }

    start() {
        this.writeConfig();
        const bin = this.resolveBin();

        console.log(`Starting go2rtc: ${bin} -config ${this.configPath}`);
        this.process = spawn(bin, ['-config', this.configPath]);

        const log = (buf) => {
            const msg = buf.toString().trim();
            if (msg) console.log(`GO2RTC: ${msg}`);
        };
        this.process.stdout.on('data', log);
        this.process.stderr.on('data', log);

        this.process.on('error', (err) => {
            console.error(`go2rtc no se pudo iniciar: ${err.message}`);
            console.error('¿Falta el binario? Ejecuta: npm run setup:go2rtc');
        });

        this.process.on('close', (code) => {
            console.log(`go2rtc process exited with code ${code}`);
            if (!this.stopping) {
                console.log('Restarting go2rtc in 5 seconds...');
                setTimeout(() => this.start(), 5000);
            }
        });

        return this.process;
    }

    stop() {
        this.stopping = true;
        if (this.process) this.process.kill();
    }
}

module.exports = Go2rtcManager;
