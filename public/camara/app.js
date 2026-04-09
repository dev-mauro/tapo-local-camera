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
    });

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

});
