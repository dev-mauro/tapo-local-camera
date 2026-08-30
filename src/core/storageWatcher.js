const fs = require('fs');
const logger = require('./logger');
const config = require('../config');

/**
 * Periodically checks free disk space on the recordings volume and
 * broadcasts status to clients (both as periodic telemetry and as an
 * alert when space runs low).
 */
class StorageWatcher {
    constructor() {
        this.recordingsDir = null;
        this.broadcastFn = null;
        this.timer = null;
        this.wasLow = false;
    }

    init(recordingsDir, broadcastFn) {
        this.recordingsDir = recordingsDir;
        this.broadcastFn = broadcastFn;

        this.timer = setInterval(() => this._check(), config.STORAGE_CHECK_INTERVAL_MS);
        this._check();
        logger.system('StorageWatcher', `Started (interval: ${config.STORAGE_CHECK_INTERVAL_MS}ms, low threshold: ${config.STORAGE_LOW_THRESHOLD_PERCENT}%)`);
    }

    async _check() {
        let stats;
        try {
            stats = await fs.promises.statfs(this.recordingsDir);
        } catch (e) {
            logger.systemError('StorageWatcher', `Failed to read disk stats: ${e.message}`);
            return;
        }

        const total = stats.blocks * stats.bsize;
        const free = stats.bavail * stats.bsize;
        const usedPercent = total > 0 ? ((total - free) / total) * 100 : 0;
        const freePercent = 100 - usedPercent;
        const low = freePercent < config.STORAGE_LOW_THRESHOLD_PERCENT;

        if (low && !this.wasLow) {
            logger.systemError('StorageWatcher', `Low storage: ${freePercent.toFixed(1)}% free (${(free / 1e9).toFixed(1)} GB / ${(total / 1e9).toFixed(1)} GB)`);
        } else if (!low && this.wasLow) {
            logger.system('StorageWatcher', `Storage recovered: ${freePercent.toFixed(1)}% free`);
        }
        this.wasLow = low;

        this._broadcast({ type: 'storage_status', total, free, usedPercent, low });
    }

    _broadcast(payload) {
        if (typeof this.broadcastFn === 'function') {
            this.broadcastFn(payload);
        }
    }
}

module.exports = new StorageWatcher();
