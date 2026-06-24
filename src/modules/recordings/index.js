const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffprobePath = require('ffprobe-static').path;
const ffmpegPath = require('ffmpeg-static');
const { getRecordingsDir } = require('../../utils/paths');

ffmpeg.setFfprobePath(ffprobePath);
ffmpeg.setFfmpegPath(ffmpegPath);

const recordingsDir = getRecordingsDir();
const cacheDir = path.join(recordingsDir, '.cache');
const router = Router();

// Tope del caché de MP4 remuxeados (snapshots de la grabación actual se acumulan).
const CACHE_MAX_FILES = 20;

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

// ── Caché de remux .ts → .mp4 ─────────────────────────────────────────────────
const ensureCacheDir = () => {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
};

// Nombre de caché determinístico por archivo + tamaño + mtime: si la grabación
// actual crece, cambia la firma y se genera un MP4 nuevo (snapshot).
const cacheNameFor = (base, stat) =>
    `${base.replace(/\.ts$/, '')}.${stat.size}.${Math.round(stat.mtimeMs)}.mp4`;

// Borra snapshots viejos del mismo archivo base (deja solo el vigente).
const pruneOldSnapshots = (base, keepName) => {
    const prefix = `${base.replace(/\.ts$/, '')}.`;
    for (const f of fs.readdirSync(cacheDir)) {
        if (f.startsWith(prefix) && f !== keepName) {
            try { fs.unlinkSync(path.join(cacheDir, f)); } catch (e) {}
        }
    }
};

// Mantiene el caché bajo el tope, borrando los MP4 más antiguos.
const enforceCacheCap = () => {
    const files = fs.readdirSync(cacheDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => ({ f, mtime: fs.statSync(path.join(cacheDir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime);
    while (files.length > CACHE_MAX_FILES) {
        const { f } = files.shift();
        try { fs.unlinkSync(path.join(cacheDir, f)); } catch (e) {}
    }
};

// Conversiones en curso, para no lanzar ffmpeg dos veces sobre el mismo archivo.
const inFlight = new Map();

const remuxToMp4 = (srcPath, outPath) => new Promise((resolve, reject) => {
    const tmp = `${outPath}.part`;
    ffmpeg(srcPath)
        // -f mp4 explícito: el temporal termina en .part y ffmpeg no puede inferir
        // el formato por la extensión.
        .outputOptions(['-c', 'copy', '-movflags', '+faststart', '-f', 'mp4'])
        .on('end', () => {
            try { fs.renameSync(tmp, outPath); resolve(outPath); }
            catch (e) { reject(e); }
        })
        .on('error', (err) => {
            try { fs.existsSync(tmp) && fs.unlinkSync(tmp); } catch (e) {}
            reject(err);
        })
        .save(tmp);
});

// Devuelve la ruta de un MP4 listo para servir (desde caché o recién remuxeado).
const getPlayableMp4 = async (base, srcPath, stat) => {
    ensureCacheDir();
    const outName = cacheNameFor(base, stat);
    const outPath = path.join(cacheDir, outName);

    if (fs.existsSync(outPath)) return outPath;

    if (inFlight.has(outName)) return inFlight.get(outName);

    const job = (async () => {
        await remuxToMp4(srcPath, outPath);
        pruneOldSnapshots(base, outName);
        enforceCacheCap();
        return outPath;
    })().finally(() => inFlight.delete(outName));

    inFlight.set(outName, job);
    return job;
};

// ── Listado ───────────────────────────────────────────────────────────────────
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

// Grabación en curso (la más reciente).
router.get('/current', (req, res) => {
    try {
        if (!fs.existsSync(recordingsDir)) return res.json({ ok: true, current: null });
        const names = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.ts'));
        if (names.length === 0) return res.json({ ok: true, current: null });
        const newest = names
            .map(f => ({ f, mtime: fs.statSync(path.join(recordingsDir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime)[0].f;
        res.json({ ok: true, current: newest });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Reproducción VOD: remuxea a MP4 (con caché) y lo sirve con soporte de Range/seek.
router.get('/:filename/stream', async (req, res) => {
    const srcPath = safeFilePath(req.params.filename);
    if (!srcPath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(srcPath)) return res.status(404).json({ ok: false, error: 'File not found' });

    try {
        const stat = fs.statSync(srcPath);
        const mp4Path = await getPlayableMp4(path.basename(srcPath), srcPath, stat);
        // dotfiles: 'allow' porque el caché vive en ".cache" (send bloquea dotfiles por defecto).
        // res.sendFile maneja Range automáticamente → seek nativo.
        res.sendFile(mp4Path, { dotfiles: 'allow' });
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
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
        // Borra también los MP4 cacheados de esta grabación.
        if (fs.existsSync(cacheDir)) pruneOldSnapshots(path.basename(filePath), null);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
