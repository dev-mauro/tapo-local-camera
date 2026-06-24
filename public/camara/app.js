document.addEventListener("DOMContentLoaded", async () => {
    const video = document.getElementById('videoElement');
    const delayBadge = document.getElementById('delay-badge');
    const usersCount = document.getElementById('users-count');
    const usersDropdown = document.getElementById('users-dropdown');

    // ── Operator name ─────────────────────────────────────────────────────────
    const userName = prompt("Para acceder al monitor, ingresa tu nombre de operador:", "Invitado") || "Anónimo";

    // ── Event config ──────────────────────────────────────────────────────────
    const EVENT_CONFIG = {
        motion_start:    { toastClass: 'toast-motion',  sound: 'motion'  },
        people_start:    { toastClass: 'toast-people',  sound: 'people'  },
        tamper_detected: { toastClass: 'toast-tamper',  sound: 'tamper'  },
        line_crossing:   { toastClass: 'toast-line',    sound: 'alert'   },
        field_detection: { toastClass: 'toast-field',   sound: 'alert'   },
        generic_alert:   { toastClass: 'toast-generic', sound: 'generic' },
    };

    // ── Control WebSocket (with auto-reconnect) ───────────────────────────────
    let networkPing = 0;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let controlWs = null;
    let controlReconnectDelay = 2000;
    let pingInterval = null;

    const connectControlWs = () => {
        controlWs = new WebSocket(`${protocol}//${window.location.host}/control`);

        controlWs.onopen = () => {
            controlReconnectDelay = 2000;
            controlWs.send(JSON.stringify({ type: 'join', name: userName }));
            clearInterval(pingInterval);
            pingInterval = setInterval(() => {
                if (controlWs.readyState === WebSocket.OPEN) {
                    controlWs.send(JSON.stringify({ type: 'ping', clientTime: Date.now() }));
                }
            }, 5000);
        };

        controlWs.onclose = () => {
            clearInterval(pingInterval);
            setTimeout(() => {
                controlReconnectDelay = Math.min(controlReconnectDelay * 2, 30000);
                connectControlWs();
            }, controlReconnectDelay);
        };

        controlWs.onerror = () => {}; // handled by onclose

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
                const notifEnabled = document.getElementById('toggle-notifications').checked;
                const soundEnabled = document.getElementById('toggle-sound').checked;
                if (notifEnabled) {
                    const cfg = EVENT_CONFIG[data.event] || { toastClass: 'toast-generic', sound: 'generic' };
                    showToast(data.label, new Date(data.timestamp).toLocaleTimeString(), cfg.toastClass);
                    if (soundEnabled) playSound(cfg.sound);
                }
            } else if (data.type === 'pong') {
                networkPing = (Date.now() - data.clientTime) / 2;
            } else if (data.type === 'server_fatal_error') {
                triggerFatalError(data.message);
            }
        };
    };

    connectControlWs();

    // ── Toast notifications ───────────────────────────────────────────────────
    const toastContainer = document.getElementById('toast-container');

    const TOAST_ICONS = {
        'toast-motion':  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
        'toast-people':  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        'toast-tamper':  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        'toast-line':    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="15 8 19 12 15 16"/></svg>',
        'toast-field':   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
        'toast-generic': '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    };

    const showToast = (title, subtitle, toastClass = 'toast-generic') => {
        const toast = document.createElement('div');
        toast.className = `toast ${toastClass}`;
        const icon = TOAST_ICONS[toastClass] || TOAST_ICONS['toast-generic'];
        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-subtitle">${subtitle}</div>
            </div>
            <button class="toast-dismiss">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>`;
        const dismiss = () => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        };
        toast.querySelector('.toast-dismiss').onclick = dismiss;
        toastContainer.appendChild(toast);
        setTimeout(dismiss, 6000);
    };

    // ── Sound engine ──────────────────────────────────────────────────────────
    let audioCtx = null;

    const playSound = (type) => {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const now = audioCtx.currentTime;

            const tone = (freq, endFreq, waveType, startDelay, duration, gainPeak) => {
                const osc = audioCtx.createOscillator();
                const g = audioCtx.createGain();
                osc.type = waveType;
                osc.frequency.setValueAtTime(freq, now + startDelay);
                if (endFreq !== freq) {
                    osc.frequency.exponentialRampToValueAtTime(endFreq, now + startDelay + duration * 0.35);
                }
                g.gain.setValueAtTime(0, now + startDelay);
                g.gain.linearRampToValueAtTime(gainPeak, now + startDelay + 0.03);
                g.gain.linearRampToValueAtTime(0, now + startDelay + duration);
                osc.connect(g);
                g.connect(audioCtx.destination);
                osc.start(now + startDelay);
                osc.stop(now + startDelay + duration);
            };

            switch (type) {
                case 'motion':
                    // Descending sweep 880→440 Hz
                    tone(880, 440, 'sine', 0, 0.3, 0.4);
                    break;
                case 'people':
                    // Two ascending tones: 440 Hz then 880 Hz
                    tone(440, 440, 'sine', 0,    0.18, 0.5);
                    tone(880, 880, 'sine', 0.22, 0.18, 0.5);
                    break;
                case 'tamper':
                    // Harsh square-wave burst
                    tone(220, 220, 'square', 0, 0.5, 0.24);
                    break;
                case 'alert':
                    // Three short pulses (line crossing / field detection)
                    tone(660, 660, 'sine', 0,    0.1, 0.4);
                    tone(660, 660, 'sine', 0.15, 0.1, 0.4);
                    tone(660, 660, 'sine', 0.30, 0.1, 0.4);
                    break;
                case 'generic':
                    tone(550, 550, 'sine', 0, 0.2, 0.3);
                    break;
            }
        } catch (e) {
            console.warn("Audio playback failed", e);
        }
    };

    // ── Settings persistence ──────────────────────────────────────────────────
    const toggleNotif = document.getElementById('toggle-notifications');
    const toggleSnd   = document.getElementById('toggle-sound');

    const loadSettings = () => {
        const s = JSON.parse(localStorage.getItem('monitor_settings') || '{"notif":true,"sound":true}');
        if (toggleNotif) toggleNotif.checked = s.notif;
        if (toggleSnd)   toggleSnd.checked   = s.sound;
    };
    const saveSettings = () => {
        localStorage.setItem('monitor_settings', JSON.stringify({
            notif: toggleNotif.checked,
            sound: toggleSnd.checked,
        }));
    };
    if (toggleNotif) toggleNotif.onchange = saveSettings;
    if (toggleSnd)   toggleSnd.onchange   = saveSettings;
    loadSettings();

    // ── Error overlay ─────────────────────────────────────────────────────────
    const errorOverlay = document.getElementById('error-overlay');
    const errorMessage = document.getElementById('error-message');
    const btnRetry = document.getElementById('btn-retry');
    let autoReconnect = true;

    const triggerFatalError = (msg) => {
        autoReconnect = false;
        clearTimeout(reconnectTimeout);
        errorMessage.innerText = msg;
        errorOverlay.style.display = 'flex';
    };

    btnRetry.addEventListener('click', () => window.location.reload());

    // ── Latency display ───────────────────────────────────────────────────────
    let getCustomLatencyFn = () => 0;

    setInterval(() => {
        const value = getCustomLatencyFn();
        delayBadge.innerText = `Delay: ${value.toFixed(1)}s`;
        if (value < 2)      delayBadge.style.backgroundColor = '#10b981';
        else if (value < 5) delayBadge.style.backgroundColor = '#f59e0b';
        else                delayBadge.style.backgroundColor = '#ef4444';
    }, 10000);

    // ── Video stall watchdog ──────────────────────────────────────────────────
    let lastBufferedEnd = -1;
    let stallSeconds = 0;
    setInterval(() => {
        if (errorOverlay.style.display === 'none' || !errorOverlay.style.display) {
            if (video.buffered.length > 0) {
                const currentEnd = video.buffered.end(video.buffered.length - 1);
                if (currentEnd === lastBufferedEnd) stallSeconds++;
                else { stallSeconds = 0; lastBufferedEnd = currentEnd; }
            } else {
                stallSeconds++;
            }
            if (stallSeconds >= 12) {
                triggerFatalError("Origen inaccesible o apagado. Esperando recuperación...");
            }
        }
    }, 1000);

    // ── Stream stats ──────────────────────────────────────────────────────────
    const statsOverlay  = document.getElementById('stats-overlay');
    const statBitrate   = document.getElementById('stat-bitrate');
    const statFps       = document.getElementById('stat-fps');
    const statDropped   = document.getElementById('stat-dropped');
    let streamStats = { speed: 0 };
    let lastTotalFrames = 0;
    let lastFpsCheck    = Date.now();

    const updateStatsDisplay = () => {
        if (statsOverlay.style.display === 'none') return;
        const now = Date.now();
        const dt  = (now - lastFpsCheck) / 1000;
        let fps     = 0;
        let dropped = 0;
        if (video.getVideoPlaybackQuality) {
            const q = video.getVideoPlaybackQuality();
            if (dt > 0) fps = (q.totalVideoFrames - lastTotalFrames) / dt;
            lastTotalFrames = q.totalVideoFrames;
            dropped = q.droppedVideoFrames;
        }
        lastFpsCheck = now;
        statBitrate.textContent = `${(streamStats.speed / 1024).toFixed(0)} KB/s`;
        statFps.textContent     = `${fps.toFixed(1)} FPS`;
        statDropped.textContent = `${dropped} dropped`;
    };
    setInterval(updateStatsDisplay, 2000);

    // ── mpegts.js player (with auto-reconnect) ────────────────────────────────
    let currentPlayer    = null;
    let reconnectDelay   = 2000;
    let reconnectTimeout = null;

    const destroyPlayer = () => {
        if (currentPlayer) {
            try { currentPlayer.destroy(); } catch (e) {}
            currentPlayer = null;
        }
    };

    const scheduleReconnect = () => {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30000);
            initPlayer();
        }, reconnectDelay);
    };

    const initPlayer = () => {
        if (!mpegts.getFeatureList().mseLivePlayback) {
            triggerFatalError("Tu navegador no soporta Media Source Extensions. Prueba con Chrome o Firefox.");
            return;
        }
        destroyPlayer();

        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: wsUrl });
        currentPlayer = player;

        player.attachMediaElement(video);
        player.load();
        player.play().catch(() => {});

        player.on(mpegts.Events.ERROR, (errorType, errorDetail) => {
            console.warn(`[Stream] Error ${errorType}: ${errorDetail} — reconnecting in ${reconnectDelay}ms`);
            destroyPlayer();
            if (autoReconnect) scheduleReconnect();
        });

        player.on(mpegts.Events.STATISTICS_INFO, (info) => {
            streamStats.speed = info.speed || 0;
        });

        getCustomLatencyFn = () => {
            let buf = 0;
            if (video.buffered.length > 0) {
                buf = video.buffered.end(video.buffered.length - 1) - video.currentTime;
            }
            return Math.max(0, buf + (networkPing / 1000));
        };

        video.addEventListener('playing', () => { reconnectDelay = 2000; }, { once: true });
    };

    initPlayer();

    // ── Stats toggle ──────────────────────────────────────────────────────────
    const btnStats = document.getElementById('btn-stats');
    btnStats.addEventListener('click', () => {
        const visible = statsOverlay.style.display !== 'none';
        statsOverlay.style.display = visible ? 'none' : 'flex';
        btnStats.classList.toggle('active', !visible);
    });

    // ── Snapshot ──────────────────────────────────────────────────────────────
    const btnSnapshot = document.getElementById('btn-snapshot');
    btnSnapshot.addEventListener('click', () => {
        if (!video.videoWidth) return;
        const canvas = document.createElement('canvas');
        canvas.width  = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        const a   = document.createElement('a');
        const now = new Date();
        const ts  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
        a.download = `snapshot_${ts}.png`;
        a.href     = canvas.toDataURL('image/png');
        a.click();
    });

    // ── Custom video controls ─────────────────────────────────────────────────
    const customControls  = document.getElementById('custom-controls');
    const btnPlayPause    = document.getElementById('btn-play-pause');
    const iconPlay        = document.getElementById('icon-play');
    const iconPause       = document.getElementById('icon-pause');
    const btnMute         = document.getElementById('btn-mute');
    const iconVolHigh     = document.getElementById('icon-vol-high');
    const iconVolMute     = document.getElementById('icon-vol-mute');
    const volumeSlider    = document.getElementById('volume-slider');
    const btnPip          = document.getElementById('btn-pip');
    const btnFullscreen   = document.getElementById('btn-fullscreen');
    const iconFullscreen  = document.getElementById('icon-fullscreen');
    const iconMinimize    = document.getElementById('icon-minimize');
    const videoContainer  = document.getElementById('video-container');

    let controlsTimeout;
    const hideControls = () => customControls.classList.remove('active');
    const showControls = () => {
        customControls.classList.add('active');
        clearTimeout(controlsTimeout);
        controlsTimeout = setTimeout(hideControls, 5000);
    };

    videoContainer.addEventListener('mousemove', showControls);
    videoContainer.addEventListener('mouseleave', hideControls);

    const updatePlayState = () => {
        iconPlay.style.display  = video.paused ? 'block' : 'none';
        iconPause.style.display = video.paused ? 'none'  : 'block';
    };
    btnPlayPause.addEventListener('click', () => {
        if (video.paused) video.play().catch(() => {});
        else video.pause();
    });
    video.addEventListener('play',  updatePlayState);
    video.addEventListener('pause', updatePlayState);

    const updateVolumeState = () => {
        const isMuted = video.muted || video.volume === 0;
        iconVolHigh.style.display = isMuted ? 'none'  : 'block';
        iconVolMute.style.display = isMuted ? 'block' : 'none';
        volumeSlider.value = isMuted ? 0 : video.volume;
    };
    btnMute.addEventListener('click', () => {
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 1;
    });
    volumeSlider.addEventListener('input', (e) => {
        video.volume = e.target.value;
        video.muted  = video.volume === 0;
    });
    video.addEventListener('volumechange', updateVolumeState);
    updateVolumeState();

    btnPip.addEventListener('click', async () => {
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
        } catch (e) {}
    });

    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            if (videoContainer.requestFullscreen) await videoContainer.requestFullscreen();
            else if (videoContainer.webkitRequestFullscreen) await videoContainer.webkitRequestFullscreen();
        } else {
            if (document.exitFullscreen) await document.exitFullscreen();
            else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
        }
    };
    btnFullscreen.addEventListener('click', toggleFullscreen);

    document.addEventListener('fullscreenchange', () => {
        iconFullscreen.style.display = document.fullscreenElement ? 'none'  : 'block';
        iconMinimize.style.display   = document.fullscreenElement ? 'block' : 'none';
    });

    // ── Progress bar & live-sync ──────────────────────────────────────────────
    const progressBarSlider = document.getElementById('progress-bar-slider');
    const timeCurrentLabel  = document.getElementById('time-current');

    const formatTimeOffset = (seconds) => {
        if (seconds >= -2) return "Live";
        const abs = Math.abs(Math.round(seconds));
        const m   = Math.floor(abs / 60);
        const s   = abs % 60;
        return `-${m}:${s.toString().padStart(2, '0')}`;
    };

    let isSeeking = false;
    progressBarSlider.addEventListener('mousedown', () => isSeeking = true);
    progressBarSlider.addEventListener('mouseup',   () => isSeeking = false);
    progressBarSlider.addEventListener('input', (e) => {
        video.currentTime = parseFloat(e.target.value);
        if (isLiveSyncEnabled) setLiveSync(false);
    });

    let isLiveSyncEnabled = true;
    const btnLiveSync = document.getElementById('btn-live-sync');

    const setLiveSync = (enabled) => {
        isLiveSyncEnabled = enabled;
        btnLiveSync.classList.toggle('sync-disabled', !enabled);
        if (enabled && video.buffered.length > 0) {
            video.currentTime = video.buffered.end(video.buffered.length - 1);
        }
    };

    btnLiveSync.addEventListener('click', () => setLiveSync(!isLiveSyncEnabled));

    setInterval(() => {
        if (isLiveSyncEnabled && !video.paused && video.buffered.length > 0) {
            const end   = video.buffered.end(video.buffered.length - 1);
            const drift = end - video.currentTime;
            if (drift > 1.5) {
                console.log(`[Sync] Resincronizando... Desfase: ${drift.toFixed(2)}s`);
                video.currentTime = end;
            }
        }
    }, 3000);

    video.addEventListener('timeupdate', () => {
        if (video.buffered.length > 0) {
            const start = video.buffered.start(0);
            const end   = video.buffered.end(video.buffered.length - 1);
            progressBarSlider.min = start;
            progressBarSlider.max = end;
            if (!isSeeking) progressBarSlider.value = video.currentTime;
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

    // ── PTZ D-Pad ─────────────────────────────────────────────────────────────
    const ptzButtons = document.querySelectorAll('.ptz-btn');

    const sendPtzMove = (direction) => {
        if (controlWs?.readyState === WebSocket.OPEN) {
            controlWs.send(JSON.stringify({ type: 'ptz_move', direction, speed: 0.5 }));
        }
    };
    const sendPtzStop = () => {
        if (controlWs?.readyState === WebSocket.OPEN) {
            controlWs.send(JSON.stringify({ type: 'ptz_stop' }));
        }
    };

    ptzButtons.forEach((btn) => {
        const direction = btn.dataset.dir;
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            btn.classList.add('ptz-pressing');
            sendPtzMove(direction);
        });
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            btn.classList.add('ptz-pressing');
            sendPtzMove(direction);
        }, { passive: false });
    });

    const stopAllPtz = () => {
        ptzButtons.forEach(btn => btn.classList.remove('ptz-pressing'));
        sendPtzStop();
    };
    document.addEventListener('mouseup',     stopAllPtz);
    document.addEventListener('touchend',    stopAllPtz);
    document.addEventListener('touchcancel', stopAllPtz);

    // ── Imaging settings modal ────────────────────────────────────────────────
    const imagingModal   = document.getElementById('imaging-modal');
    const imagingLoading = document.getElementById('imaging-loading');
    const imagingBody    = document.getElementById('imaging-body');
    const imagingError   = document.getElementById('imaging-error');
    const imagingErrMsg  = document.getElementById('imaging-error-msg');
    const imagingStatus  = document.getElementById('imaging-status');
    const btnApply       = document.getElementById('btn-apply-imaging');
    const btnOpenModal   = document.getElementById('btn-imaging-settings');
    const btnCloseModal  = document.getElementById('imaging-modal-close');

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

    let selectedIrCutFilter = 'AUTO';
    const irModeBtns = document.querySelectorAll('.ir-mode-btn');

    const setIrActive = (mode) => {
        selectedIrCutFilter = mode;
        irModeBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    };
    irModeBtns.forEach(btn => btn.addEventListener('click', () => setIrActive(btn.dataset.mode)));

    Object.entries(sliders).forEach(([key, el]) => {
        el.addEventListener('input', () => { sliderValues[key].textContent = el.value; });
    });

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
            const set = (key) => {
                const v = s[key];
                if (v !== undefined && v !== null) {
                    sliders[key].value = Math.round(v);
                    sliderValues[key].textContent = Math.round(v);
                }
            };
            set('brightness'); set('contrast'); set('colorSaturation'); set('sharpness');
            setIrActive(s.irCutFilter || 'AUTO');
            imagingLoading.style.display = 'none';
            imagingBody.style.display    = 'block';
        } catch (err) {
            imagingLoading.style.display = 'none';
            imagingErrMsg.textContent    = err.message;
            imagingError.style.display   = 'flex';
        }
    };

    const openImagingModal  = () => { imagingModal.style.display = 'flex'; loadImagingSettings(); };
    const closeImagingModal = () => { imagingModal.style.display = 'none'; };

    btnOpenModal.addEventListener('click', openImagingModal);
    btnCloseModal.addEventListener('click', closeImagingModal);
    imagingModal.addEventListener('click', (e) => { if (e.target === imagingModal) closeImagingModal(); });

    btnApply.addEventListener('click', async () => {
        btnApply.disabled = true;
        imagingStatus.className   = 'modal-status';
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
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            const json = await resp.json();
            if (!json.ok) throw new Error(json.error || 'Error del servidor');
            imagingStatus.className   = 'modal-status success';
            imagingStatus.textContent = '✓ Configuración guardada';
            setTimeout(() => { imagingStatus.textContent = ''; }, 3000);
        } catch (err) {
            imagingStatus.className   = 'modal-status error';
            imagingStatus.textContent = `✗ ${err.message}`;
        } finally {
            btnApply.disabled = false;
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (imagingModal.style.display !== 'none') closeImagingModal();
            if (recordingsModal.style.display !== 'none') closeRecordingsModal();
        }
    });

    // ── Recordings modal ──────────────────────────────────────────────────────
    const recordingsModal     = document.getElementById('recordings-modal');
    const recordingsLoading   = document.getElementById('recordings-loading');
    const recordingsBody      = document.getElementById('recordings-body');
    const recordingsList      = document.getElementById('recordings-list');
    const recordingsEmpty     = document.getElementById('recordings-empty');
    const recordingsError     = document.getElementById('recordings-error');
    const recordingsErrMsg    = document.getElementById('recordings-error-msg');
    const btnOpenRecordings   = document.getElementById('btn-recordings');
    const btnCloseRecordings  = document.getElementById('recordings-modal-close');

    const parseRecordingName = (filename) => {
        const m = filename.match(/camara_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})\.ts/);
        if (!m) return filename;
        return `${m[1]}  ${m[2].replace(/-/g, ':')}`;
    };

    const loadRecordings = async () => {
        recordingsLoading.style.display = 'flex';
        recordingsBody.style.display    = 'none';
        recordingsEmpty.style.display   = 'none';
        recordingsError.style.display   = 'none';
        try {
            const resp = await fetch('/api/recordings');
            const json = await resp.json();
            if (!json.ok) throw new Error(json.error);
            recordingsLoading.style.display = 'none';
            if (json.recordings.length === 0) {
                recordingsEmpty.style.display = 'flex';
            } else {
                recordingsList.innerHTML = '';
                json.recordings.forEach(rec => {
                    const item = document.createElement('div');
                    item.className = 'recording-item';
                    item.innerHTML = `
                        <div class="recording-info">
                            <span class="recording-name">${parseRecordingName(rec.name)}</span>
                            <span class="recording-meta">
                                ${rec.duration ? `<span class="rec-duration">${rec.duration}</span>` : ''}
                                ${rec.sizeFormatted}
                            </span>
                        </div>
                        <div class="recording-actions">
                            <a href="/api/recordings/${encodeURIComponent(rec.name)}" download="${rec.name}" class="rec-btn rec-download" title="Descargar">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            </a>
                            <button class="rec-btn rec-delete" data-name="${rec.name}" title="Eliminar">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                        </div>`;
                    item.querySelector('.rec-delete').addEventListener('click', async (e) => {
                        const name = e.currentTarget.dataset.name;
                        if (!confirm(`¿Eliminar ${parseRecordingName(name)}?`)) return;
                        try {
                            const r = await fetch(`/api/recordings/${encodeURIComponent(name)}`, { method: 'DELETE' });
                            const j = await r.json();
                            if (!j.ok) throw new Error(j.error);
                            item.remove();
                            if (recordingsList.children.length === 0) {
                                recordingsBody.style.display  = 'none';
                                recordingsEmpty.style.display = 'flex';
                            }
                        } catch (err) {
                            alert(`Error al eliminar: ${err.message}`);
                        }
                    });
                    recordingsList.appendChild(item);
                });
                recordingsBody.style.display = 'block';
            }
        } catch (err) {
            recordingsLoading.style.display = 'none';
            recordingsErrMsg.textContent    = err.message;
            recordingsError.style.display   = 'flex';
        }
    };

    const openRecordingsModal  = () => { recordingsModal.style.display = 'flex'; loadRecordings(); };
    const closeRecordingsModal = () => { recordingsModal.style.display = 'none'; };

    btnOpenRecordings.addEventListener('click', openRecordingsModal);
    btnCloseRecordings.addEventListener('click', closeRecordingsModal);
    recordingsModal.addEventListener('click', (e) => { if (e.target === recordingsModal) closeRecordingsModal(); });
});
