const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const config = require('../config');

const DAY_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

// Ventana de gracia tras arrancar el proceso durante la cual "todavía no hay
// ningún archivo" es normal (recién levantando ffmpeg/go2rtc) y no una falla.
const STARTUP_GRACE_MS = 60 * 1000;

// Tiempo mínimo entre reinicios forzados de ffmpeg. Sin este cooldown, una vez
// declarado "no está grabando" el watcher solo reiniciaba una vez y, si el
// reinicio no arreglaba la causa raíz (p. ej. el proceso vuelve a quedar
// colgado en vez de morir), nunca lo volvía a intentar.
const RESTART_COOLDOWN_MS = 60 * 1000;

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
        this.lastRestartAt = 0;
        this.isRecording = true;
        this.restarting = false;
        this.startedAt = Date.now();
    }

    init(recordingsDir, broadcastFn, ffmpegManager) {
        this.recordingsDir = recordingsDir;
        this.broadcastFn = broadcastFn;
        this.ffmpegManager = ffmpegManager;
        this.lastGrowth = Date.now();
        this.startedAt = Date.now();

        this.timer = setInterval(() => this._check(), config.RECORDING_CHECK_INTERVAL_MS);
        logger.system('RecordingWatcher', `Started (interval: ${config.RECORDING_CHECK_INTERVAL_MS}ms, stall threshold: ${config.RECORDING_STALL_THRESHOLD_MS}ms)`);
    }

    _latestFile() {
        let dayDirs;
        try {
            dayDirs = fs.readdirSync(this.recordingsDir, { withFileTypes: true })
                .filter(d => d.isDirectory() && DAY_DIR_RE.test(d.name))
                .map(d => d.name)
                .sort()
                .reverse();
        } catch (e) {
            return null;
        }

        // Recorre las carpetas de día de más reciente a más antigua hasta encontrar
        // la primera con archivos. Normalmente será la de hoy (o ayer, justo tras
        // cruzar medianoche), pero recorder.js pre-crea la carpeta de hoy y de
        // mañana cada 10 min sin importar si ffmpeg realmente está escribiendo —
        // si la grabación lleva días detenida, esas carpetas vacías se acumulan
        // por delante del último archivo real, así que no hay que limitar la
        // búsqueda a solo las 2 más recientes (antes se hacía y ocultaba el
        // problema en vez de detectarlo).
        for (const dayDir of dayDirs) {
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
            return latest;
        }
        return null;
    }

    _check() {
        if (this.restarting) return;

        const file = this._latestFile();
        if (!file) {
            const sinceStart = Date.now() - this.startedAt;
            if (sinceStart < STARTUP_GRACE_MS) {
                // Recién arrancando: aún no hay ningún archivo en ningún día, esperable.
                this.lastGrowth = Date.now();
                return;
            }
            // Pasado el margen de arranque y sigue sin haber NINGÚN archivo en
            // ningún día: la grabación nunca llegó a empezar. También es una falla.
            this._flagStalled('No se encontró ningún archivo de grabación tras el arranque.');
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
        if (stalledFor >= config.RECORDING_STALL_THRESHOLD_MS) {
            this._flagStalled(`Recording stalled for ${stalledFor}ms on ${path.basename(file)}.`);
        }
    }

    // Marca el estado como "no grabando" y fuerza un reinicio de ffmpeg, con un
    // cooldown para poder reintentar repetidamente si el problema persiste
    // (antes solo se reiniciaba una vez por episodio: si ese reinicio no
    // arreglaba la causa raíz, el watcher se quedaba de brazos cruzados).
    _flagStalled(reason) {
        const sinceLastRestart = Date.now() - this.lastRestartAt;
        if (sinceLastRestart < RESTART_COOLDOWN_MS) return;

        this.isRecording = false;
        logger.systemError('RecordingWatcher', `${reason} Restarting FFmpeg.`);
        this._broadcast({ type: 'recording_status', recording: false, message: 'La grabación se detuvo. Reintentando...' });
        this._restart();
    }

    _restart() {
        this.restarting = true;
        this.lastRestartAt = Date.now();
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
