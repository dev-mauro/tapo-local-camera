document.addEventListener('DOMContentLoaded', () => {
    const video       = document.getElementById('vod-video');
    const overlay     = document.getElementById('vod-overlay');
    const overlayText = document.getElementById('vod-overlay-text');
    const overlayHint = document.getElementById('vod-overlay-hint');
    const titleEl     = document.getElementById('vod-title');
    const listEl      = document.getElementById('vod-list');
    const speedGroup  = document.getElementById('vod-speed');

    let currentFile = new URLSearchParams(location.search).get('file');

    const parseRecordingName = (filename) => {
        const m = filename.match(/camara_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.ts/);
        if (!m) return filename;
        return `${m[1]}  ${m[2].replace(/-/g, ':')}`;
    };

    // ── Velocidad de reproducción ─────────────────────────────────────────────
    // Los navegadores rechazan playbackRate > 16 (Chrome lanza excepción), así que
    // para tasas mayores hacemos avance manual del currentTime sobre el 1x nativo.
    let playbackRate = 1;
    let ffTimer = null;
    const FF_INTERVAL = 0.25; // segundos

    const clearManualFF = () => {
        if (ffTimer) { clearInterval(ffTimer); ffTimer = null; }
    };
    const applyRate = () => {
        clearManualFF();
        try {
            video.playbackRate = playbackRate;
        } catch (e) {
            video.playbackRate = 1;
            const extra = playbackRate - 1;
            ffTimer = setInterval(() => {
                if (!video.paused && !video.ended) video.currentTime += extra * FF_INTERVAL;
            }, FF_INTERVAL * 1000);
        }
    };

    speedGroup.querySelectorAll('.speed-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            playbackRate = parseFloat(btn.dataset.rate);
            speedGroup.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', b === btn));
            applyRate();
        });
    });
    // playbackRate se resetea al cargar un nuevo src: lo reaplicamos.
    video.addEventListener('loadedmetadata', applyRate);

    // ── Reproductor ───────────────────────────────────────────────────────────
    const showOverlay = (text, hint = '') => {
        overlayText.textContent = text;
        overlayHint.textContent = hint;
        overlay.classList.remove('hidden');
    };
    const hideOverlay = () => overlay.classList.add('hidden');

    const setActiveInList = () => {
        listEl.querySelectorAll('.vod-recording-item').forEach((el) => {
            el.classList.toggle('active', el.dataset.name === currentFile);
        });
    };

    const loadVideo = (file) => {
        if (!file) {
            showOverlay('Sin selección', 'Elige una grabación de la lista.');
            titleEl.textContent = '—';
            return;
        }
        currentFile = file;
        titleEl.textContent = parseRecordingName(file);
        history.replaceState(null, '', `?file=${encodeURIComponent(file)}`);
        setActiveInList();

        showOverlay('Preparando video…', 'La primera vez se convierte el archivo; puede tardar unos segundos.');
        video.src = `/api/recordings/${encodeURIComponent(file)}/stream`;
        video.load();
        video.play().catch(() => {});
    };

    video.addEventListener('loadeddata', hideOverlay);
    video.addEventListener('canplay', hideOverlay);
    video.addEventListener('error', () => {
        showOverlay('No se pudo cargar el video', 'El archivo puede no existir o estar dañado.');
    });

    // ── Eliminar (con confirmación) ───────────────────────────────────────────
    const deleteRecording = async (name) => {
        if (!confirm(`¿Eliminar ${parseRecordingName(name)}?`)) return;
        try {
            const r = await fetch(`/api/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);

            const wasCurrent = name === currentFile;
            await loadList();
            if (wasCurrent) {
                video.removeAttribute('src');
                video.load();
                const next = listEl.querySelector('.vod-recording-item');
                if (next) loadVideo(next.dataset.name);
                else { currentFile = null; titleEl.textContent = '—'; showOverlay('Sin grabaciones', 'No quedan grabaciones.'); }
            }
        } catch (err) {
            alert(`Error al eliminar: ${err.message}`);
        }
    };

    // ── Lista lateral ─────────────────────────────────────────────────────────
    const ICON_DL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    const ICON_DEL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

    const loadList = async () => {
        try {
            const resp = await fetch('/api/recordings');
            const json = await resp.json();
            if (!json.ok) throw new Error(json.error);
            listEl.innerHTML = '';
            if (json.recordings.length === 0) {
                listEl.innerHTML = '<p style="opacity:.6;padding:8px 12px;">No hay grabaciones.</p>';
                return;
            }
            json.recordings.forEach((rec) => {
                const item = document.createElement('div');
                item.className = 'vod-recording-item';
                item.dataset.name = rec.name;
                item.innerHTML = `
                    <div>
                        <span class="recording-name">${parseRecordingName(rec.name)}</span>
                        <span class="recording-meta">${rec.duration ? rec.duration + ' · ' : ''}${rec.sizeFormatted}</span>
                    </div>
                    <div class="recording-actions">
                        <a class="rec-btn rec-download" title="Descargar" href="/api/recordings/${encodeURIComponent(rec.name)}" download="${rec.name}">${ICON_DL}</a>
                        <button class="rec-btn rec-delete" title="Eliminar">${ICON_DEL}</button>
                    </div>`;
                item.addEventListener('click', () => loadVideo(rec.name));
                // Las acciones no deben disparar la reproducción del ítem.
                const dl = item.querySelector('.rec-download');
                dl.addEventListener('click', (e) => e.stopPropagation());
                const del = item.querySelector('.rec-delete');
                del.addEventListener('click', (e) => { e.stopPropagation(); deleteRecording(rec.name); });
                listEl.appendChild(item);
            });
            if (!currentFile) currentFile = json.recordings[0].name;
            setActiveInList();
        } catch (err) {
            listEl.innerHTML = `<p style="opacity:.6;padding:8px 12px;">Error: ${err.message}</p>`;
        }
    };

    (async () => {
        await loadList();
        loadVideo(currentFile);
    })();
});
