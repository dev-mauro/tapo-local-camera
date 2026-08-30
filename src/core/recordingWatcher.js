const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../config');

/**
 * Watches the active recording file and detects a stalled recording
 * (ffmpeg alive but no longer writing data). On stall, forces a full
 * ffmpeg restart; on recovery, notifies clients.
 */
class RecordingWatcher {
    constructor() {
        this.recordingsDir = null;
        this.broadcastFn = null;
        this.ffmpegManager = null;
        this.timer = null;
        this.lastSize = -1;
        this.lastGrowth = Date.now();
        this.isRecording = true;
        this.restarting = false;
    }

    init(recordingsDir, broadcastFn, ffmpegManager) {
        this.recordingsDir = recordingsDir;
        this.broadcastFn = broadcastFn;
        this.ffmpegManager = ffmpegManager;
        this.lastGrowth = Date.now();

        this.timer = setInterval(() => this._check(), config.RECORDING_CHECK_INTERVAL_MS);
        logger.system('RecordingWatcher', `Started (interval: ${config.RECORDING_CHECK_INTERVAL_MS}ms, stall threshold: ${config.RECORDING_STALL_THRESHOLD_MS}ms)`);
    }

    _latestFile() {
        let dayDirs;
        try {
            dayDirs = fs.readdirSync(this.recordingsDir, { withFileTypes: true })
                .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
                .map(d => d.name)
                .sort()
                .reverse();
        } catch (e) {
            return null;
        }

        // Solo hace falta mirar las carpetas más recientes: el archivo activo
        // vive en el día de hoy (o en el de ayer justo tras cruzar medianoche).
        for (const dayDir of dayDirs.slice(0, 2)) {
            const dirPath = path.join(this.recordingsDir, dayDir);
            let files;
            try {
                files = fs.readdirSync(dirPath).filter(f => f.endsWith('.ts'));
            } catch (e) {
                continue;
            }
            if (files.length === 0) continue;

            let latest = null;
            let latestMtime = -Infinity;
            for (const f of files) {
                const full = path.join(dirPath, f);
                const stat = fs.statSync(full);
                if (stat.mtimeMs > latestMtime) {
                    latestMtime = stat.mtimeMs;
                    latest = full;
                }
            }
            if (latest) return latest;
        }
        return null;
    }

    _check() {
        if (this.restarting) return;

        const file = this._latestFile();
        if (!file) {
            // No recording file yet (e.g. right after startup); don't flag as stalled.
            this.lastGrowth = Date.now();
            return;
        }

        const size = fs.statSync(file).size;

        if (size !== this.lastSize) {
            this.lastSize = size;
            this.lastGrowth = Date.now();

            if (!this.isRecording) {
                this.isRecording = true;
                logger.system('RecordingWatcher', `Recording recovered: ${path.basename(file)}`);
                this._broadcast({ type: 'recording_status', recording: true });
            }
            return;
        }

        const stalledFor = Date.now() - this.lastGrowth;
        if (stalledFor >= config.RECORDING_STALL_THRESHOLD_MS && this.isRecording) {
            this.isRecording = false;
            logger.systemError('RecordingWatcher', `Recording stalled for ${stalledFor}ms on ${path.basename(file)}. Restarting FFmpeg.`);
            this._broadcast({ type: 'recording_status', recording: false, message: 'La grabación se detuvo. Reintentando...' });
            this._restart();
        }
    }

    _restart() {
        this.restarting = true;
        try {
            this.ffmpegManager.stop();
        } catch (e) {
            logger.systemError('RecordingWatcher', `Error stopping FFmpeg: ${e.message}`);
        }
        setTimeout(() => {
            this.lastSize = -1;
            this.lastGrowth = Date.now();
            this.restarting = false;
            this.ffmpegManager.start();
        }, 1000);
    }

    _broadcast(payload) {
        if (typeof this.broadcastFn === 'function') {
            this.broadcastFn(payload);
        }
    }
}

module.exports = new RecordingWatcher();
