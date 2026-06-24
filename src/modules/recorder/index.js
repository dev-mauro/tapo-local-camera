const fs = require('fs');
const path = require('path');
const { getRecordingsDir } = require('../../utils/paths');

class Recorder {
    init(app, server, ffmpegManager) {
        const recordingsDir = getRecordingsDir();
        if (!fs.existsSync(recordingsDir)) {
            fs.mkdirSync(recordingsDir, { recursive: true });
        }

        ffmpegManager.addOutput([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-ar', '44100',
            '-b:a', '128k',
            '-f', 'segment',
            '-segment_time', '3600',       // 1 hour per file
            '-reset_timestamps', '1',
            '-map_metadata', '-1',         // Elimina el título fantasma "Session by TP Link"
            '-strftime', '1',
            path.join(recordingsDir, 'camara_%Y-%m-%d_%H-%M-%S.ts'),
        ]);

        console.log(`Recorder module initialized. Saving to: ${recordingsDir}`);
    }
}

module.exports = new Recorder();
