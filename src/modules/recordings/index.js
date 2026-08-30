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

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_RE = /^\d{2}-\d{2}-\d{2}\.ts$/;

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

// Valida el nombre de una carpeta de día (YYYY-MM-DD) y evita path traversal.
const safeDayDir = (day) => {
    if (!DAY_RE.test(day)) return null;
    return path.join(recordingsDir, day);
};

// Valida día + archivo (HH-MM-SS.ts) y devuelve la ruta absoluta.
const safeFilePath = (day, filename) => {
    const dayDir = safeDayDir(day);
    if (!dayDir) return null;
    const base = path.basename(filename);
    if (!FILE_RE.test(base)) return null;
    return path.join(dayDir, base);
};

// Nombre de caché único por día+archivo+tamaño+mtime.
const cacheNameFor = (day, base, stat) =>
    `${day}_${base.replace(/\.ts$/, '')}.${stat.size}.${Math.round(stat.mtimeMs)}.mp4`;

// ── Caché de remux .ts → .mp4 ─────────────────────────────────────────────────
const ensureCacheDir = () => {
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
};

// Borra snapshots viejos del mismo día+archivo (deja solo el vigente).
const pruneOldSnapshots = (day, base, keepName) => {
    if (!fs.existsSync(cacheDir)) return;
    const prefix = `${day}_${base.replace(/\.ts$/, '')}.`;
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
const getPlayableMp4 = async (day, base, srcPath, stat) => {
    ensureCacheDir();
    const outName = cacheNameFor(day, base, stat);
    const outPath = path.join(cacheDir, outName);

    if (fs.existsSync(outPath)) return outPath;

    if (inFlight.has(outName)) return inFlight.get(outName);

    const job = (async () => {
        await remuxToMp4(srcPath, outPath);
        pruneOldSnapshots(day, base, outName);
        enforceCacheCap();
        return outPath;
    })().finally(() => inFlight.delete(outName));

    inFlight.set(outName, job);
    return job;
};

// Lista de carpetas de día disponibles, ordenadas de más reciente a más antigua.
const listDayDirs = () => {
    if (!fs.existsSync(recordingsDir)) return [];
    return fs.readdirSync(recordingsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && DAY_RE.test(d.name))
        .map(d => d.name)
        .sort()
        .reverse();
};

// ── Listado de días ───────────────────────────────────────────────────────────
// Liviano: solo hace un `ls` de recordingsDir y cuenta archivos por carpeta,
// sin leer contenido ni probar duración.
router.get('/days', (req, res) => {
    try {
        const days = listDayDirs()
            .map((day) => {
                const dayDir = path.join(recordingsDir, day);
                const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.ts'));
                const totalSize = files.reduce((sum, f) => sum + fs.statSync(path.join(dayDir, f)).size, 0);
                return {
                    day,
                    count: files.length,
                    totalSizeFormatted: formatSize(totalSize),
                };
            })
            // Carpetas pre-creadas (hoy/mañana) que aún no tienen grabaciones no se listan.
            .filter(d => d.count > 0);
        res.json({ ok: true, days });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── Listado de videos de un día ───────────────────────────────────────────────
// Liviano: solo fs.stat (ls), sin ffprobe. La duración de cada video se pide
// aparte y de forma asíncrona (ver /:day/:filename/duration) para que la lista
// aparezca al instante y no se sienta lenta.
router.get('/days/:day', (req, res) => {
    const dayDir = safeDayDir(req.params.day);
    if (!dayDir) return res.status(400).json({ ok: false, error: 'Invalid day' });
    if (!fs.existsSync(dayDir)) return res.status(404).json({ ok: false, error: 'Day not found' });

    try {
        const names = fs.readdirSync(dayDir).filter(f => FILE_RE.test(f));
        const recordings = names.map((f) => {
            const stat = fs.statSync(path.join(dayDir, f));
            return {
                name: f,
                day: req.params.day,
                size: stat.size,
                sizeFormatted: formatSize(stat.size),
                createdAt: stat.birthtime.toISOString(),
            };
        });
        recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ ok: true, recordings });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Duración de un video puntual (ffprobe), pedida en segundo plano por el cliente
// una vez que la lista ya se muestra, para no bloquear el listado inicial.
router.get('/:day/:filename/duration', async (req, res) => {
    const filePath = safeFilePath(req.params.day, req.params.filename);
    if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });

    const durationSecs = await probeDuration(filePath);
    res.json({ ok: true, durationSecs, duration: formatDuration(durationSecs) });
});

// Grabación en curso (la más reciente, buscada en el día más reciente con archivos).
router.get('/current', (req, res) => {
    try {
        for (const day of listDayDirs()) {
            const dayDir = path.join(recordingsDir, day);
            const names = fs.readdirSync(dayDir).filter(f => FILE_RE.test(f));
            if (names.length === 0) continue;
            const newest = names
                .map(f => ({ f, mtime: fs.statSync(path.join(dayDir, f)).mtimeMs }))
                .sort((a, b) => b.mtime - a.mtime)[0].f;
            return res.json({ ok: true, current: { day, name: newest } });
        }
        res.json({ ok: true, current: null });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Reproducción VOD: remuxea a MP4 (con caché) y lo sirve con soporte de Range/seek.
router.get('/:day/:filename/stream', async (req, res) => {
    const srcPath = safeFilePath(req.params.day, req.params.filename);
    if (!srcPath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(srcPath)) return res.status(404).json({ ok: false, error: 'File not found' });

    try {
        const stat = fs.statSync(srcPath);
        const mp4Path = await getPlayableMp4(req.params.day, path.basename(srcPath), srcPath, stat);
        // dotfiles: 'allow' porque el caché vive en ".cache" (send bloquea dotfiles por defecto).
        // res.sendFile maneja Range automáticamente → seek nativo.
        res.sendFile(mp4Path, { dotfiles: 'allow' });
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/:day/:filename', (req, res) => {
    const filePath = safeFilePath(req.params.day, req.params.filename);
    if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
    res.download(filePath, `${req.params.day}_${path.basename(filePath)}`);
});

router.delete('/:day/:filename', (req, res) => {
    const filePath = safeFilePath(req.params.day, req.params.filename);
    if (!filePath) return res.status(400).json({ ok: false, error: 'Invalid filename' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'File not found' });
    try {
        fs.unlinkSync(filePath);
        // Borra también los MP4 cacheados de esta grabación.
        pruneOldSnapshots(req.params.day, path.basename(filePath), null);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
