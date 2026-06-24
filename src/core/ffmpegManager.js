const { spawn } = require('child_process');
const os = require('os');

const ffmpegPath = os.platform() === 'android'
    ? '/data/data/com.termux/files/usr/bin/ffmpeg' // Ruta específica para Termux en Android
    : require('ffmpeg-static'); // Asume que ffmpeg está en el PATH para otros sistemas operativos

class FfmpegManager {
    constructor(rtspUrl) {
        this.rtspUrl = rtspUrl;
        this.outputs = [];
        this.process = null;
    }

    /**
     * Add an output destination and its FFmpeg arguments
     * @param {Array} options Array of ffmpeg arguments for this output
     */
    addOutput(options) {
        this.outputs.push(...options);
    }

    /**
     * Spawns the FFmpeg process with all accumulated outputs
     * @returns {ChildProcess} The spawned process
     */
    start() {
        if (this.outputs.length === 0) {
            console.warn("No outputs defined for FFmpeg, aborting start.");
            return;
        }

        const args = [
            '-rtsp_transport', 'tcp', // Better stability for RTSP
            '-fflags', '+genpts', // Regenerar marcas de tiempo rotas
            '-use_wallclock_as_timestamps', '1', // Ignorar el reloj interno de la cámara y usar el del PC
            '-i', this.rtspUrl,
            ...this.outputs
        ];

        console.log(`Starting FFmpeg with args: ${ffmpegPath} ${args.join(' ')}`);

        this.process = spawn(ffmpegPath, args);

        this.process.stderr.on('data', (data) => {
            const stderrMsg = data.toString();
            
            // Detectar conexión rechazada por límite alcanzado en la TAPO
            if (stderrMsg.includes("Operation not permitted")) {
                if (global.broadcastError) {
                    global.broadcastError("El stream1 de la cámara está ocupado por otro cliente.");
                }
            }

            // FFmpeg logs to stderr natively. Uncomment next line to debug:
            // console.log(`FFMPEG: ${stderrMsg}`);
        });

        this.process.on('close', (code) => {
            // On Windows, negative FFmpeg exit codes are reported as unsigned 32-bit:
            //   -1 → 4294967295 (generic error)
            //   -2 → 4294967294 (AVERROR_EXIT: stream dropped or write error)
            const signed = code > 2147483647 ? code - 4294967296 : code;
            const isCleanExit = code === 0 || code === 255;

            console.log(`FFmpeg process exited with code ${code}${signed !== code ? ` (${signed})` : ''}`);

            if (!isCleanExit) {
                console.log("Restarting FFmpeg in 5 seconds...");
                setTimeout(() => this.start(), 5000);
            }
        });

        return this.process;
    }
}

module.exports = FfmpegManager;
