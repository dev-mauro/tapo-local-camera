const fs = require('fs');
const path = require('path');

class Recorder {
    init(app, server, ffmpegManager) {
        const recordsDir = path.join(__dirname, '../../../recordings');
        if (!fs.existsSync(recordsDir)) {
            fs.mkdirSync(recordsDir, { recursive: true });
        }

        ffmpegManager.addOutput([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-ar', '44100',                // Resample de audio para alta compatibilidad
            '-b:a', '128k',
            '-f', 'segment',
            '-segment_time', '3600',       // 3600 seconds = 1 hour
            '-reset_timestamps', '1',
            '-map_metadata', '-1',         // Elimina el título fantasma "Session by TP Link"
            '-strftime', '1',
            path.join(recordsDir, 'camara_%Y-%m-%d_%H-%M-%S.ts') // TS retiene la barra de progreso y no se corrompe NUNCA
        ]);

        console.log("Recorder module initialized.");
    }
}

module.exports = new Recorder();
