const fs = require('fs');
const path = require('path');
const { getRecordingsDir } = require('../../utils/paths');
const logger = require('../../core/logger');

// Pre-crear carpetas de día con este margen para que ffmpeg nunca escriba a un
// directorio inexistente cuando el segmento cruza la medianoche.
const DAY_DIR_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min

const dayDirName = (date) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

class Recorder {
    constructor() {
        this.recordingsDir = null;
        this._dayDirTimer = null;
    }

    _ensureDayDirs() {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        for (const d of [now, tomorrow]) {
            const dir = path.join(this.recordingsDir, dayDirName(d));
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.system('Recorder', `Created day folder: ${dir}`);
            }
        }
    }

    init(app, server, ffmpegManager) {
        const recordingsDir = getRecordingsDir();
        this.recordingsDir = recordingsDir;
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }

        this._ensureDayDirs();
        this._dayDirTimer = setInterval(() => this._ensureDayDirs(), DAY_DIR_CHECK_INTERVAL_MS);

        ffmpegManager.addOutput([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-af', 'volume=8dB',           // Igualar la ganancia de audio del stream en vivo
            '-ar', '44100',
            '-b:a', '128k',
            '-f', 'segment',
            '-segment_time', '3600',       // 1 hour per file
            '-reset_timestamps', '1',
            '-map_metadata', '-1',         // Elimina el título fantasma "Session by TP Link"
            '-strftime', '1',
            // Carpeta por día (YYYY-MM-DD), pre-creada por _ensureDayDirs.
            path.join(recordingsDir, '%Y-%m-%d', '%H-%M-%S.ts'),
        ]);

        logger.system('Recorder', `Recorder module initialized. Saving to: ${recordingsDir}`);
    }
}

module.exports = new Recorder();
