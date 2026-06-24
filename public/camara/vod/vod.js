document.addEventListener('DOMContentLoaded', () => {
    const video        = document.getElementById('vod-video');
    const overlay      = document.getElementById('vod-overlay');
    const overlayText  = document.getElementById('vod-overlay-text');
    const overlayHint  = document.getElementById('vod-overlay-hint');
    const titleEl      = document.getElementById('vod-title');
    const listEl       = document.getElementById('vod-list');
    const downloadLink = document.getElementById('vod-download');
    const deleteBtn    = document.getElementById('vod-delete');

    let currentFile = new URLSearchParams(location.search).get('file');

    const parseRecordingName = (filename) => {
        const m = filename.match(/camara_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.ts/);
        if (!m) return filename;
        return `${m[1]}  ${m[2].replace(/-/g, ':')}`;
    };

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
        downloadLink.href = `/api/recordings/${encodeURIComponent(file)}`;
        downloadLink.setAttribute('download', file);

        // Refleja la selección en la URL sin recargar.
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
                    </div>`;
                item.addEventListener('click', () => loadVideo(rec.name));
                listEl.appendChild(item);
            });
            // Si no había archivo en la URL, abrir el más reciente.
            if (!currentFile) currentFile = json.recordings[0].name;
            setActiveInList();
        } catch (err) {
            listEl.innerHTML = `<p style="opacity:.6;padding:8px 12px;">Error: ${err.message}</p>`;
        }
    };

    deleteBtn.addEventListener('click', async () => {
        if (!currentFile) return;
        if (!confirm(`¿Eliminar ${parseRecordingName(currentFile)}?`)) return;
        try {
            const r = await fetch(`/api/recordings/${encodeURIComponent(currentFile)}`, { method: 'DELETE' });
            const j = await r.json();
            if (!j.ok) throw new Error(j.error);
            const deleted = currentFile;
            currentFile = null;
            video.removeAttribute('src');
            video.load();
            await loadList();
            // Cargar la siguiente disponible, si hay.
            const next = listEl.querySelector('.vod-recording-item');
            if (next) loadVideo(next.dataset.name);
            else { titleEl.textContent = '—'; showOverlay('Sin grabaciones', 'No quedan grabaciones.'); }
        } catch (err) {
            alert(`Error al eliminar: ${err.message}`);
        }
    });

    (async () => {
        await loadList();
        loadVideo(currentFile);
    })();
});
