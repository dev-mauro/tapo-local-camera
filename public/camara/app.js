document.addEventListener("DOMContentLoaded", async () => {
    const video = document.getElementById('videoElement');
    const badge = document.getElementById('strategy-badge');
    const delayBadge = document.getElementById('delay-badge');
    const usersCount = document.getElementById('users-count');
    const usersDropdown = document.getElementById('users-dropdown');

    // 1. Preguntar Nombre
    const userName = prompt("Para acceder al monitor, ingresa tu nombre de operador:", "Invitado") || "Anónimo";

    // 2. Control Socket Setup
    let networkPing = 0;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const controlWs = new WebSocket(`${protocol}//${window.location.host}/control`);

    controlWs.onopen = () => {
        controlWs.send(JSON.stringify({ type: 'join', name: userName }));
        // Ping recurrente para medir red
        setInterval(() => {
            if (controlWs.readyState === WebSocket.OPEN) {
                controlWs.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
            }
        }, 5000);
    };

    controlWs.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'users_update') {
            usersCount.innerText = data.count;
            usersDropdown.innerHTML = '';
            data.list.forEach(name => {
                const el = document.createElement('div');
                el.className = 'user-item';
                el.innerText = name;
                usersDropdown.appendChild(el);
            });
        } else if (data.type === 'camera_event') {
            // Handle motion notifications
            const notifEnabled = document.getElementById('toggle-notifications').checked;
            const soundEnabled = document.getElementById('toggle-sound').checked;

            if (notifEnabled) {
                const toastType = data.event === 'motion_start' ? 'motion' : 'clear';
                showToast(data.label, new Date(data.timestamp).toLocaleTimeString(), toastType);
                
                if (soundEnabled && data.event === 'motion_start') {
                    playNotificationSound();
                }
            }
        } else if (data.type === 'pong') {
            // (Round-Trip-Time / 2)
            networkPing = (Date.now() - data.clientTime) / 2;
        } else if (data.type === 'server_fatal_error') {
            // Error impulsado directamente por consola del servidor (ej. Cámara Ocupada)
            const errorOverlay = document.getElementById('error-overlay');
            const errorMessage = document.getElementById('error-message');
            const badgeCustom = document.getElementById('strategy-badge');
            
            errorMessage.innerText = data.message;
            errorOverlay.style.display = 'flex';
            badgeCustom.innerText = 'OFFLINE';
            badgeCustom.style.backgroundColor = '#ef4444';
        }
    };

    // --- Notification & Toast Logic ---
    const toastContainer = document.getElementById('toast-container');
    
    // Audio Context for beep sound (lazy init on first user interaction)
    let audioCtx = null;
    const playNotificationSound = () => {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
            osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1); // A4

            gain.gain.setValueAtTime(0, audioCtx.currentTime);
            gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.05);
            gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);

            osc.connect(gain);
            gain.connect(audioCtx.destination);

            osc.start();
            osc.stop(audioCtx.currentTime + 0.3);
        } catch (e) {
            console.warn("Audio playback failed", e);
        }
    };

    const showToast = (title, subtitle, type = 'motion') => {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type === 'motion' ? 'motion' : 'clear'}`;
        
        const icon = type === 'motion' ? 
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' :
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';

        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-subtitle">${subtitle}</div>
            </div>
            <button class="toast-dismiss">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        `;

        const dismiss = () => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        };

        toast.querySelector('.toast-dismiss').onclick = dismiss;
        toastContainer.appendChild(toast);

        // Auto-remove
        setTimeout(dismiss, 6000);
    };

    // Load/Save notification settings
    const toggleNotif = document.getElementById('toggle-notifications');
    const toggleSnd = document.getElementById('toggle-sound');

    const loadSettings = () => {
        const settings = JSON.parse(localStorage.getItem('monitor_settings') || '{"notif":true, "sound":true}');
        if (toggleNotif) toggleNotif.checked = settings.notif;
        if (toggleSnd) toggleSnd.checked = settings.sound;
    };

    const saveSettings = () => {
        localStorage.setItem('monitor_settings', JSON.stringify({
            notif: toggleNotif.checked,
            sound: toggleSnd.checked
        }));
    };

    if (toggleNotif) toggleNotif.onchange = saveSettings;
    if (toggleSnd) toggleSnd.onchange = saveSettings;
    loadSettings();


    // 3. Emulador / Cálculo de Latencia (Actualizar cada 10s visualmente)
    let getCustomLatencyFn = () => 0; 
    
    setInterval(() => {
        const value = getCustomLatencyFn();
        delayBadge.innerText = `Delay: ${(value).toFixed(1)}s`;
        
        // Color coding de latencia
        if (value < 2) delayBadge.style.backgroundColor = '#10b981'; // Green
        else if (value < 5) delayBadge.style.backgroundColor = '#f59e0b'; // Yellow
        else delayBadge.style.backgroundColor = '#ef4444'; // Red
    }, 10000);

    const errorOverlay = document.getElementById('error-overlay');
    const errorMessage = document.getElementById('error-message');
    const btnRetry = document.getElementById('btn-retry');

    const triggerFatalError = (msg) => {
        errorMessage.innerText = msg;
        errorOverlay.style.display = 'flex';
        badge.innerText = 'OFFLINE';
        badge.style.backgroundColor = '#ef4444';
    };

    btnRetry.addEventListener('click', () => window.location.reload());

    // Watchdog de flujo de video para detectar Cámara Apagada de forma contundente
    let lastBufferedEnd = -1;
    let stallSeconds = 0;
    setInterval(() => {
        if (!errorOverlay.style.display || errorOverlay.style.display === 'none') {
            if (video.buffered.length > 0) {
                const currentEnd = video.buffered.end(video.buffered.length - 1);
                if (currentEnd === lastBufferedEnd) stallSeconds++;
                else { stallSeconds = 0; lastBufferedEnd = currentEnd; }
            } else {
                stallSeconds++; // Si inicia vacio y no llegan datos, también suma
            }

            // A los 12 segundos ininterrumpidos congelado, decláralo muerto
            if (stallSeconds >= 12) {
                triggerFatalError("Origen inaccesible o apagado. Esperando recuperación...");
            }
        }
    }, 1000);

    try {
        // Fetch which strategy the server is running
        const response = await fetch('/api/strategy');
        const data = await response.json();
        
        if (data.strategy === 'hls') {
            badge.innerText = 'MODE: HLS';
            badge.style.backgroundColor = '#8b5cf6'; // Purple

            if (Hls.isSupported()) {
                const hls = new Hls({
                    liveDurationInfinity: true,
                    liveSyncDuration: 3,
                    liveMaxLatencyDuration: 10,
                });
                hls.loadSource('/hls/stream.m3u8');
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    const p = video.play();
                    if(p !== undefined) p.catch(e=>{});
                });
                hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) triggerFatalError(`HLS Error: ${data.type}`);
                });
                
                // Función Latencia HLS (Ya provee un estimador directo)
                getCustomLatencyFn = () => hls.latency || 0;

            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = '/hls/stream.m3u8';
                video.addEventListener('loadedmetadata', () => {
                    const p = video.play();
                    if(p !== undefined) p.catch(e=>{});
                });
            }

        } else if (data.strategy === 'ws') {
            badge.innerText = 'MODE: LOW-LNCY (WS)';
            badge.style.backgroundColor = '#10b981'; // Green

            if (mpegts.getFeatureList().mseLivePlayback) {
                const wsUrl = `${protocol}//${window.location.host}/ws`;
                const player = mpegts.createPlayer({
                    type: 'mpegts',         // Formato contenedor
                    isLive: true,
                    url: wsUrl
                });

                player.attachMediaElement(video);
                player.load();
                // Hacemos catch aquí y le decimos a javascript que ignore abortings para no manchar la consola
                const playPromise = player.play();
                if (playPromise !== undefined) {
                    playPromise.catch(e => { /* Ignore aborts */ });
                }

                player.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
                    triggerFatalError(`${errorType}: ${errorDetail}`);
                });

                // Función Latencia WS (Buffer devorado por reproductor + viaje de red)
                getCustomLatencyFn = () => {
                    let internalBufferDelay = 0;
                    if (video.buffered.length > 0) {
                        internalBufferDelay = video.buffered.end(video.buffered.length - 1) - video.currentTime;
                    }
                    // Retornar en segundos
                    return Math.max(0, internalBufferDelay + (networkPing / 1000));
                };
            }
        }
    } catch (e) {
        console.error("Failed to connect", e);
        triggerFatalError("No se pudo contactar al servidor: " + e.message);
    }

    // --- Custom Video Controls Logic ---
    const customControls = document.getElementById('custom-controls');
    const btnPlayPause = document.getElementById('btn-play-pause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const btnMute = document.getElementById('btn-mute');
    const iconVolHigh = document.getElementById('icon-vol-high');
    const iconVolMute = document.getElementById('icon-vol-mute');
    const volumeSlider = document.getElementById('volume-slider');
    const btnPip = document.getElementById('btn-pip');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const iconFullscreen = document.getElementById('icon-fullscreen');
    const iconMinimize = document.getElementById('icon-minimize');
    const videoContainer = document.getElementById('video-container');

    // Idle timeout para esconder controles
    let controlsTimeout;
    const hideControls = () => customControls.classList.remove('active');
    const showControls = () => {
        customControls.classList.add('active');
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(hideControls, 5000);
    };

    videoContainer.addEventListener('mousemove', showControls);
    videoContainer.addEventListener('mouseleave', hideControls);

    // Play/Pause
    const updatePlayState = () => {
        if (video.paused) {
            iconPlay.style.display = 'block';
            iconPause.style.display = 'none';
        } else {
            iconPlay.style.display = 'none';
            iconPause.style.display = 'block';
        }
    };
    btnPlayPause.addEventListener('click', () => {
        if (video.paused) {
            const p = video.play();
            if (p !== undefined) p.catch(e => { /* Ignore aborts */ });
        } else {
            video.pause();
        }
    });
    video.addEventListener('play', updatePlayState);
    video.addEventListener('pause', updatePlayState);

    // Volume & Mute
    const updateVolumeState = () => {
        const isMuted = video.muted || video.volume === 0;
        iconVolHigh.style.display = isMuted ? 'none' : 'block';
        iconVolMute.style.display = isMuted ? 'block' : 'none';
        volumeSlider.value = isMuted ? 0 : video.volume;
    };
    btnMute.addEventListener('click', () => {
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 1;
    });
    volumeSlider.addEventListener('input', (e) => {
        video.volume = e.target.value;
        video.muted = video.volume === 0;
    });
    video.addEventListener('volumechange', updateVolumeState);
    updateVolumeState(); // Inicializa la UI acorde al atributo html

    // PIP
    btnPip.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else if (document.pictureInPictureEnabled) {
                await video.requestPictureInPicture();
            }
        } catch (error) {
            console.error("PIP Error:", error);
        }
    });

    // Fullscreen
    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            if (videoContainer.requestFullscreen) {
                await videoContainer.requestFullscreen();
            } else if (videoContainer.webkitRequestFullscreen) { // Safari
                await videoContainer.webkitRequestFullscreen();
            }
        } else {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { // Safari
                await document.webkitExitFullscreen();
            }
        }
    };
    btnFullscreen.addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            iconFullscreen.style.display = 'none';
            iconMinimize.style.display = 'block';
        } else {
            iconFullscreen.style.display = 'block';
            iconMinimize.style.display = 'none';
        }
    });

    // Logic for Memory/Buffer Progress Bar
    const progressBarSlider = document.getElementById('progress-bar-slider');
    const timeCurrentLabel = document.getElementById('time-current');
    
    // Format helper
    const formatTimeOffset = (seconds) => {
        if (seconds >= -2) return "Live";
        const abs = Math.abs(Math.round(seconds));
        const m = Math.floor(abs / 60);
        const s = abs % 60;
        return `-${m}:${s.toString().padStart(2, '0')}`;
    };

    let isSeeking = false;

    progressBarSlider.addEventListener('mousedown', () => isSeeking = true);
    progressBarSlider.addEventListener('mouseup', () => isSeeking = false);
    
    progressBarSlider.addEventListener('input', (e) => {
        video.currentTime = parseFloat(e.target.value);
        // Desactivar auto-sync si el usuario retrocede intencionalmente
        if (isLiveSyncEnabled) {
            setLiveSync(false);
        }
    });

    // --- Auto-Sync Logic ---
    let isLiveSyncEnabled = true;
    const btnLiveSync = document.getElementById('btn-live-sync');
    
    const setLiveSync = (enabled) => {
        isLiveSyncEnabled = enabled;
        if (enabled) {
            btnLiveSync.classList.remove('sync-disabled');
            // Al activarlo, saltamos al vivo inmediatamente
            if (video.buffered.length > 0) {
                video.currentTime = video.buffered.end(video.buffered.length - 1);
            }
        } else {
            btnLiveSync.classList.add('sync-disabled');
        }
    };

    btnLiveSync.addEventListener('click', () => {
        setLiveSync(!isLiveSyncEnabled);
    });

    // Intervalo de sincronización (cada 3 segundos)
    setInterval(() => {
        if (isLiveSyncEnabled && !video.paused && video.buffered.length > 0) {
            const end = video.buffered.end(video.buffered.length - 1);
            const drift = end - video.currentTime;
            
            // Si hay un desfase mayor a 1.5 segundos, forzamos el salto
            if (drift > 1.5) {
                console.log(`[Sync] Resincronizando... Desfase: ${drift.toFixed(2)}s`);
                video.currentTime = end;
            }
        }
    }, 3000);

    video.addEventListener('timeupdate', () => {
        if (video.buffered.length > 0) {
            const start = video.buffered.start(0);
            const end = video.buffered.end(video.buffered.length - 1);
            
            progressBarSlider.min = start;
            progressBarSlider.max = end;
            
            if (!isSeeking) {
                progressBarSlider.value = video.currentTime;
            }

            // Offset de la posición actual contra el fin (LiveEdge)
            const offset = video.currentTime - end;
            if (offset >= -2) {
                timeCurrentLabel.innerText = "Live";
                timeCurrentLabel.classList.add('time-live');
            } else {
                timeCurrentLabel.innerText = formatTimeOffset(offset);
                timeCurrentLabel.classList.remove('time-live');
            }
        }
    });

    // --- PTZ D-Pad Controls ---
    const ptzButtons = document.querySelectorAll('.ptz-btn');

    const sendPtzMove = (direction) => {
        if (controlWs.readyState === WebSocket.OPEN) {
            controlWs.send(JSON.stringify({ type: 'ptz_move', direction, speed: 0.5 }));
        }
    };

    const sendPtzStop = () => {
        if (controlWs.readyState === WebSocket.OPEN) {
            controlWs.send(JSON.stringify({ type: 'ptz_stop' }));
        }
    };

    ptzButtons.forEach((btn) => {
        const direction = btn.dataset.dir;

        // Mouse events
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            btn.classList.add('ptz-pressing');
            sendPtzMove(direction);
        });

        // Touch events (mobile / tablet)
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            btn.classList.add('ptz-pressing');
            sendPtzMove(direction);
        }, { passive: false });
    });

    // Stop on any mouse/touch up — global so dragging outside still stops
    const stopAllPtz = (e) => {
        ptzButtons.forEach(btn => btn.classList.remove('ptz-pressing'));
        sendPtzStop();
    };

    document.addEventListener('mouseup', stopAllPtz);
    document.addEventListener('touchend', stopAllPtz);
    document.addEventListener('touchcancel', stopAllPtz);

    // --- Imaging Settings Modal ---
    const imagingModal   = document.getElementById('imaging-modal');
    const imagingLoading = document.getElementById('imaging-loading');
    const imagingBody    = document.getElementById('imaging-body');
    const imagingError   = document.getElementById('imaging-error');
    const imagingErrMsg  = document.getElementById('imaging-error-msg');
    const imagingStatus  = document.getElementById('imaging-status');
    const btnApply       = document.getElementById('btn-apply-imaging');
    const btnOpenModal   = document.getElementById('btn-imaging-settings');
    const btnCloseModal  = document.getElementById('imaging-modal-close');

    // Slider refs
    const sliders = {
        brightness:      document.getElementById('slider-brightness'),
        contrast:        document.getElementById('slider-contrast'),
        colorSaturation: document.getElementById('slider-saturation'),
        sharpness:       document.getElementById('slider-sharpness'),
    };
    const sliderValues = {
        brightness:      document.getElementById('val-brightness'),
        contrast:        document.getElementById('val-contrast'),
        colorSaturation: document.getElementById('val-saturation'),
        sharpness:       document.getElementById('val-sharpness'),
    };

    // IR cut mode state
    let selectedIrCutFilter = 'AUTO';
    const irModeBtns = document.querySelectorAll('.ir-mode-btn');

    const setIrActive = (mode) => {
        selectedIrCutFilter = mode;
        irModeBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    };

    irModeBtns.forEach(btn => {
        btn.addEventListener('click', () => setIrActive(btn.dataset.mode));
    });

    // Live-update slider value labels
    Object.entries(sliders).forEach(([key, el]) => {
        el.addEventListener('input', () => {
            sliderValues[key].textContent = el.value;
        });
    });

    // Populate modal with camera data
    const loadImagingSettings = async () => {
        imagingLoading.style.display = 'flex';
        imagingBody.style.display    = 'none';
        imagingError.style.display   = 'none';
        imagingStatus.textContent    = '';
        imagingStatus.className      = 'modal-status';

        try {
            const resp = await fetch('/api/imaging');
            const json = await resp.json();

            if (!json.ok) throw new Error(json.error || 'Error desconocido');

            const s = json.settings;
            console.log('[Imaging] Settings received:', s);

            // Populate sliders — fall back to 50 if value is missing
            const set = (key) => {
                const v = s[key];
                if (v !== undefined && v !== null) {
                    sliders[key].value = Math.round(v);
                    sliderValues[key].textContent = Math.round(v);
                }
            };
            set('brightness');
            set('contrast');
            set('colorSaturation');
            set('sharpness');

            // IR Cut Filter
            if (s.irCutFilter) {
                setIrActive(s.irCutFilter);
            } else {
                setIrActive('AUTO');
            }

            imagingLoading.style.display = 'none';
            imagingBody.style.display    = 'block';

        } catch (err) {
            console.error('[Imaging] Load error:', err);
            imagingLoading.style.display = 'none';
            imagingErrMsg.textContent    = err.message;
            imagingError.style.display   = 'flex';
        }
    };

    // Open / Close
    const openModal = () => {
        imagingModal.style.display = 'flex';
        loadImagingSettings();
    };
    const closeModal = () => {
        imagingModal.style.display = 'none';
    };

    btnOpenModal.addEventListener('click', openModal);
    btnCloseModal.addEventListener('click', closeModal);
    imagingModal.addEventListener('click', (e) => {
        if (e.target === imagingModal) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && imagingModal.style.display !== 'none') closeModal();
    });

    // Apply changes
    btnApply.addEventListener('click', async () => {
        btnApply.disabled = true;
        imagingStatus.className = 'modal-status';
        imagingStatus.textContent = 'Aplicando...';

        const payload = {
            brightness:      parseInt(sliders.brightness.value, 10),
            contrast:        parseInt(sliders.contrast.value, 10),
            colorSaturation: parseInt(sliders.colorSaturation.value, 10),
            sharpness:       parseInt(sliders.sharpness.value, 10),
            irCutFilter:     selectedIrCutFilter,
        };

        try {
            const resp = await fetch('/api/imaging', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(payload),
            });
            const json = await resp.json();

            if (!json.ok) throw new Error(json.error || 'Error del servidor');

            imagingStatus.className = 'modal-status success';
            imagingStatus.textContent = '✓ Configuración guardada';
            setTimeout(() => { imagingStatus.textContent = ''; }, 3000);

        } catch (err) {
            console.error('[Imaging] Apply error:', err);
            imagingStatus.className = 'modal-status error';
            imagingStatus.textContent = `✗ ${err.message}`;
        } finally {
            btnApply.disabled = false;
        }
    });

});
