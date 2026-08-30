document.addEventListener('DOMContentLoaded', () => {
    const video       = document.getElementById('vod-video');
    const overlay     = document.getElementById('vod-overlay');
    const overlayText = document.getElementById('vod-overlay-text');
    const overlayHint = document.getElementById('vod-overlay-hint');
    const titleEl     = document.getElementById('vod-title');
    const listEl      = document.getElementById('vod-list');
    const listTitleEl = document.getElementById('vod-list-title');
    const btnBackDays = document.getElementById('vod-back-to-days');
    const speedGroup  = document.getElementById('vod-speed');

    const params = new URLSearchParams(location.search);
    let currentDay  = params.get('day');
    let currentFile = params.get('file');

    const formatDayLabel = (day) => {
        const [y, m, d] = day.split('-');
        return `${d}/${m}/${y}`;
    };
    const formatTimeLabel = (filename) => filename.replace('.ts', '').replace(/-/g, ':');

    // Suma segundos a un "HH:MM:SS" y devuelve la hora resultante (mismo formato).
    const addSecondsToTime = (hhmmss, deltaSecs) => {
        const [h, m, s] = hhmmss.split(':').map(Number);
        let total = h * 3600 + m * 60 + s + Math.round(deltaSecs || 0);
        total = ((total % 86400) + 86400) % 86400;
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    };

    // "inicio - fin" a partir del nombre del archivo (hora de inicio) y su duración.
    const formatRangeLabel = (rec) => {
        const start = formatTimeLabel(rec.name);
        if (!rec.durationSecs) return start;
        return `${start} - ${addSecondsToTime(start, rec.durationSecs)}`;
    };

    // Grabaciones del día actualmente listado, indexadas por nombre de archivo,
    // para poder armar el título "inicio - fin" al reproducir sin pedirlo de nuevo.
    let dayRecordingsByName = {};

    // Pide la duración de un video en segundo plano (ffprobe del lado del server).
    // No bloquea el listado: se llama después de pintar la lista.
    const fetchDuration = async (day, name) => {
        try {
            const resp = await fetch(`/api/recordings/${encodeURIComponent(day)}/${encodeURIComponent(name)}/duration`);
            const json = await resp.json();
            return json.ok ? json : null;
        } catch (e) {
            return null;
        }
    };

    // ── Velocidad de reproducción ─────────────────────────────────────────────
    // Los navegadores limitan video.playbackRate a 16x (Chrome lanza excepción
    // por encima de eso). Para 32x/64x no hay reproducción "real" posible con
    // <video> nativo, así que simulamos el avance encadenando seeks: en vez de
    // reproducir a 1x y saltar cada cierto intervalo (lo que se ve entrecortado),
    // mantenemos el video en pausa y calculamos el siguiente currentTime apenas
    // termina el seek anterior ('seeked'), tan rápido como el navegador pueda
    // decodificar. El resultado es un avance fluido, sin los saltos perceptibles
    // de un timer de intervalo fijo.
    const NATIVE_RATE_LIMIT = 16;
    let playbackRate = 1;
    let manualFFActive = false;
    let lastStepAt = 0;

    const stepManualFF = () => {
        if (!manualFFActive) return;
        if (video.ended || video.duration - video.currentTime <= 0.05) {
            stopManualFF();
            return;
        }
        const now = performance.now();
        const elapsed = lastStepAt ? (now - lastStepAt) / 1000 : 0.03;
        lastStepAt = now;
        const next = Math.min(video.currentTime + elapsed * playbackRate, video.duration);
        video.currentTime = next;
    };

    const onManualSeeked = () => stepManualFF();

    const startManualFF = () => {
        if (manualFFActive) return;
        manualFFActive = true;
        lastStepAt = 0;
        video.pause();
        video.addEventListener('seeked', onManualSeeked);
        stepManualFF();
    };

    const stopManualFF = () => {
        if (!manualFFActive) return;
        manualFFActive = false;
        video.removeEventListener('seeked', onManualSeeked);
    };

    // Mientras se simula 32x/64x el video se mantiene en pausa a propósito; si
    // el usuario presiona el botón nativo de play, lo revertimos para no
    // terminar con dos mecanismos de avance compitiendo entre sí.
    video.addEventListener('play', () => {
        if (manualFFActive) video.pause();
    });

    const applyRate = () => {
        if (playbackRate > NATIVE_RATE_LIMIT) {
            stopManualFF();
            startManualFF();
        } else {
            stopManualFF();
            video.playbackRate = playbackRate;
            if (video.paused && !video.ended) video.play().catch(() => {});
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

    // Solo aquí se pide el video pesado (stream), al seleccionarlo explícitamente.
    const loadVideo = (day, file) => {
        if (!day || !file) {
            showOverlay('Sin selección', 'Elige una grabación de la lista.');
            titleEl.textContent = '—';
            return;
        }
        stopManualFF();
        currentDay = day;
        currentFile = file;
        const rec = dayRecordingsByName[file];
        titleEl.textContent = `${formatDayLabel(day)}  ${rec ? formatRangeLabel(rec) : formatTimeLabel(file)}`;
        history.replaceState(null, '', `?day=${encodeURIComponent(day)}&file=${encodeURIComponent(file)}`);
        setActiveInList();

        showOverlay('Preparando video…', 'La primera vez se convierte el archivo; puede tardar unos segundos.');
        video.src = `/api/recordings/${encodeURIComponent(day)}/${encodeURIComponent(file)}/stream`;
        video.load();
        video.play().catch(() => {});
    };

    video.addEventListener('loadeddata', hideOverlay);
    video.addEventListener('canplay', hideOverlay);
    video.addEventListener('error', () => {
        showOverlay('No se pudo cargar el video', 'El archivo puede no existir o estar dañado.');
    });

    // ── Eliminar (con confirmación) ───────────────────────────────────────────
    const deleteRecording = async (day, name) => {
        if (!confirm(`¿Eliminar la grabación de las ${formatTimeLabel(name)}?`)) return;
        try {
            const r = await fetch(`/api/recordings/${encodeURIComponent(day)}/${encodeURIComponent(name)}`, { method: 'DELETE' });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);

            const wasCurrent = day === currentDay && name === currentFile;
            await loadDayFiles(day);
            if (wasCurrent) {
                video.removeAttribute('src');
                video.load();
                const next = listEl.querySelector('.vod-recording-item');
                if (next) loadVideo(day, next.dataset.name);
                else { currentFile = null; titleEl.textContent = '—'; showOverlay('Sin grabaciones', 'No quedan grabaciones este día.'); }
            }
        } catch (err) {
            alert(`Error al eliminar: ${err.message}`);
        }
    };

    // ── Nivel 1: días ─────────────────────────────────────────────────────────
    const ICON_DL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    const ICON_DEL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

    const loadDays = async () => {
        currentDay = null;
        btnBackDays.style.display = 'none';
        listTitleEl.textContent = 'Días con grabaciones';
        try {
            const resp = await fetch('/api/recordings/days');
            const json = await resp.json();
            if (!json.ok) throw new Error(json.error);
            listEl.innerHTML = '';
            if (json.days.length === 0) {
                listEl.innerHTML = '<p style="opacity:.6;padding:8px 12px;">No hay grabaciones.</p>';
                showOverlay('Sin grabaciones', 'No hay ningún día con grabaciones.');
                titleEl.textContent = '—';
                return;
            }
            json.days.forEach((d) => {
                const item = document.createElement('div');
                item.className = 'vod-recording-item';
                item.innerHTML = `
                    <div>
                        <span class="recording-name">${formatDayLabel(d.day)}</span>
                        <span class="recording-meta">${d.count} video${d.count === 1 ? '' : 's'} · ${d.totalSizeFormatted}</span>
                    </div>`;
                item.addEventListener('click', () => loadDayFiles(d.day));
                listEl.appendChild(item);
            });
        } catch (err) {
            listEl.innerHTML = `<p style="opacity:.6;padding:8px 12px;">Error: ${err.message}</p>`;
        }
    };

    // ── Nivel 2: videos de un día ─────────────────────────────────────────────
    const loadDayFiles = async (day) => {
        btnBackDays.style.display = 'flex';
        listTitleEl.textContent = formatDayLabel(day);
        try {
            const resp = await fetch(`/api/recordings/days/${encodeURIComponent(day)}`);
            const json = await resp.json();
            if (!json.ok) throw new Error(json.error);
            listEl.innerHTML = '';
            dayRecordingsByName = {};
            if (json.recordings.length === 0) {
                listEl.innerHTML = '<p style="opacity:.6;padding:8px 12px;">Sin grabaciones este día.</p>';
                return;
            }
            json.recordings.forEach((rec) => {
                dayRecordingsByName[rec.name] = rec;
                const item = document.createElement('div');
                item.className = 'vod-recording-item';
                item.dataset.name = rec.name;
                item.innerHTML = `
                    <div>
                        <span class="recording-name">${formatTimeLabel(rec.name)}</span>
                        <span class="recording-meta">${rec.sizeFormatted}</span>
                    </div>
                    <div class="recording-actions">
                        <a class="rec-btn rec-download" title="Descargar" href="/api/recordings/${encodeURIComponent(day)}/${encodeURIComponent(rec.name)}" download>${ICON_DL}</a>
                        <button class="rec-btn rec-delete" title="Eliminar">${ICON_DEL}</button>
                    </div>`;

                // Lista al instante (ls); la duración llega en segundo plano y
                // actualiza el texto (y el título del reproductor si aplica).
                fetchDuration(day, rec.name).then((info) => {
                    if (!info) return;
                    rec.durationSecs = info.durationSecs;
                    rec.duration = info.duration;
                    item.querySelector('.recording-name').textContent = formatRangeLabel(rec);
                    item.querySelector('.recording-meta').textContent = `${info.duration ? info.duration + ' · ' : ''}${rec.sizeFormatted}`;
                    if (day === currentDay && rec.name === currentFile) {
                        titleEl.textContent = `${formatDayLabel(day)}  ${formatRangeLabel(rec)}`;
                    }
                });

                item.addEventListener('click', () => loadVideo(day, rec.name));
                const dl = item.querySelector('.rec-download');
                dl.addEventListener('click', (e) => e.stopPropagation());
                const del = item.querySelector('.rec-delete');
                del.addEventListener('click', (e) => { e.stopPropagation(); deleteRecording(day, rec.name); });
                listEl.appendChild(item);
            });
            setActiveInList();
        } catch (err) {
            listEl.innerHTML = `<p style="opacity:.6;padding:8px 12px;">Error: ${err.message}</p>`;
        }
    };

    btnBackDays.addEventListener('click', loadDays);

    (async () => {
        if (currentDay && currentFile) {
            await loadDayFiles(currentDay);
            loadVideo(currentDay, currentFile);
        } else {
            await loadDays();
        }
    })();
});
