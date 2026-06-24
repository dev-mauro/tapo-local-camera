const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffprobePath = require('ffprobe-static').path;
const { getRecordingsDir } = require('../../utils/paths');

ffmpeg.setFfprobePath(ffprobePath);

const recordingsDir = getRecordingsDir();
const router = Router();

const formatSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDuration = (seconds) => {
    if (!seconds || seconds < 0) return null;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const probeDuration = (filePath) => new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
        resolve(err ? null : (metadata?.format?.duration ?? null));
    });
});

const safeFilePath = (filename) => {
    const base = path.basename(filename);
    if (!base.endsWith('.ts')) return null;
    return path.join(recordingsDir, base);
};

router.get('/', async (req, res) => {
    try {
        if (!fs.existsSync(recordingsDir)) {
            return res.json({ ok: true, recordings: [] });
        }

        const names = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.ts'));

        const recordings = await Promise.all(names.map(async (f) => {
            const filePath = path.join(recordingsDir, f);
            const stat = fs.statSync(filePath);
            const durationSecs = await probeDuration(filePath);
            return {
                name: f,
                size: stat.size,
                sizeFormatted: formatSize(stat.size),
                duration: formatDuration(durationSecs),
                createdAt: stat.birthtime.toISOString(),
            };
        }));

        recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ ok: true, recordings });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/:filename', (req, res) => {
    const filePath = safeFilePath(req.params.filename);
    if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
    res.download(filePath, path.basename(filePath));
});

router.delete('/:filename', (req, res) => {
    const filePath = safeFilePath(req.params.filename);
    if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
    try {
        fs.unlinkSync(filePath);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
