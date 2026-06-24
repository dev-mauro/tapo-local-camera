/**
 * ONVIF Events module — subscribes to camera events via Pull-Point
 * and broadcasts relevant alerts to connected WebSocket clients.
 */
class CameraEvents {
    constructor() {
        this.cam = null;
        this.ready = false;
        this.broadcastFn = null;

        // Per-type debounce state
        this._states = {
            motion: { last: false, timer: null },
            people: { last: false, timer: null },
            tamper: { last: false, timer: null },
            line:   { last: false, timer: null },
            field:  { last: false, timer: null },
        };
    }

    setBroadcast(fn) {
        this.broadcastFn = fn;
    }

    attachCam(cam) {
        this.cam = cam;
        this.ready = true;
        console.log('[Events] Starting ONVIF Pull-Point subscription...');

        cam.on('event', (message) => this._handleEvent(message));

        cam.on('eventsError', (err) => {
            const msg = err.message || String(err);
            // 'socket hang up' is normal for long-polling with no events
            if (msg.includes('socket hang up')) return;
            console.error('[Events] Pull-Point error:', msg);
        });
    }

    _handleEvent(message) {
        try {
            const topicRaw = message?.topic?._ || message?.topic || '';
            const topic = String(topicRaw);
            const items = message?.message?.message?.data?.simpleItem;
            const itemArr = Array.isArray(items) ? items : (items ? [items] : []);

            const getBool = (key) => {
                for (const item of itemArr) {
                    const name = item?.$?.Name || item?.Name || '';
                    const value = item?.$?.Value ?? item?.Value;
                    if (name === key) return String(value).toLowerCase() === 'true';
                }
                return null;
            };

            if (topic.includes('CellMotionDetector') || topic.includes('MotionDetector') || topic.includes('Motion')) {
                const val = getBool('IsMotion');
                this._dispatch('motion', val !== null ? val : true, topic);
            } else if (topic.includes('PeopleDetector') || topic.includes('People')) {
                const val = getBool('IsPeople');
                this._dispatch('people', val !== null ? val : true, topic);
            } else if (topic.includes('TamperDetector') || topic.includes('Tamper')) {
                const val = getBool('IsTamper');
                this._dispatch('tamper', val !== null ? val : true, topic);
            } else if (topic.includes('LineCrossing') || topic.includes('LineDetector')) {
                const val = getBool('IsLineCrossing') ?? getBool('IsCrossing');
                this._dispatch('line', val !== null ? val : true, topic);
            } else if (topic.includes('FieldDetection') || topic.includes('FieldDetector')) {
                const val = getBool('IsInside') ?? getBool('IsField');
                this._dispatch('field', val !== null ? val : true, topic);
            } else {
                console.log(`[Events] Unhandled topic: ${topic}`);
            }
        } catch (err) {
            console.error('[Events] Error parsing event message:', err.message);
        }
    }

    _dispatch(type, isActive, topic) {
        const state = this._states[type];
        if (isActive === state.last) return;
        state.last = isActive;

        const EVENT_DEFS = {
            motion: { event: 'motion_start',    label: 'Movimiento detectado' },
            people: { event: 'people_start',    label: 'Persona detectada'    },
            tamper: { event: 'tamper_detected', label: 'Cámara manipulada'    },
            line:   { event: 'line_crossing',   label: 'Cruce de línea'       },
            field:  { event: 'field_detection', label: 'Intrusión en zona'    },
        };

        if (isActive) {
            const def = EVENT_DEFS[type];
            console.log(`[Events] 🚨 ${def.label}`);
            this._broadcast({
                type:      'camera_event',
                event:     def.event,
                label:     def.label,
                topic,
                timestamp: Date.now(),
            });
        } else {
            console.log(`[Events] ✅ ${type} CLEARED (Silent)`);
        }

        // Auto-reset after 30s silence (some cameras don't send a cleared event)
        clearTimeout(state.timer);
        if (isActive) {
            state.timer = setTimeout(() => { state.last = false; }, 30000);
        }
    }

    _broadcast(payload) {
        if (typeof this.broadcastFn === 'function') {
            this.broadcastFn(payload);
        }
    }
}

module.exports = new CameraEvents();
