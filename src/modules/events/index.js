/**
 * ONVIF Events module — subscribes to camera events via Pull-Point
 * and broadcasts relevant alerts to connected WebSocket clients.
 *
 * Relevant topic: tns1:RuleEngine/CellMotionDetector/Motion
 * The event message contains a SimpleItem { Name:'IsMotion', Value:'true'|'false' }
 */
class CameraEvents {
    constructor() {
        this.cam = null;
        this.ready = false;
        /** Injected after init — used to broadcast to WS clients */
        this.broadcastFn = null;
        /** Debounce: don't spam identical motion-start events */
        this._lastMotionState = false;
        this._motionDebounceTimer = null;
    }

    /**
     * Provide a broadcast callback (called with a JSON-serializable payload).
     * @param {function} fn
     */
    setBroadcast(fn) {
        this.broadcastFn = fn;
    }

    /**
     * Attach the connected ONVIF Cam instance and start listening.
     * @param {import('onvif').Cam} cam
     */
    attachCam(cam) {
        this.cam = cam;
        this.ready = true;

        console.log('[Events] Starting ONVIF Pull-Point subscription...');

        // The library automatically manages pull-point subscription lifecycle
        // as long as there is at least one 'event' listener on the cam instance.
        cam.on('event', (message) => {
            this._handleEvent(message);
        });

        cam.on('eventsError', (err) => {
            const msg = err.message || String(err);
            // 'socket hang up' is normal for long-polling when no events occur for a long time
            if (msg.includes('socket hang up')) return;
            console.error('[Events] Pull-Point error:', msg);
        });
    }

    /**
     * Parse and dispatch an ONVIF notification message.
     * @param {object} message  linerase'd NotificationMessage
     */
    _handleEvent(message) {
        try {
            const topicRaw = message?.topic?._ || message?.topic || '';
            const topic = String(topicRaw);

            // Motion detection
            if (topic.includes('CellMotionDetector') || topic.includes('MotionDetector') || topic.includes('Motion')) {
                const items = message?.message?.message?.data?.simpleItem;
                // Can be a single object or an array
                const itemArr = Array.isArray(items) ? items : (items ? [items] : []);

                let isMotion = null;
                for (const item of itemArr) {
                    const name = item?.$?.Name || item?.Name || '';
                    const value = item?.$?.Value ?? item?.Value;
                    if (name === 'IsMotion') {
                        isMotion = String(value).toLowerCase() === 'true';
                        break;
                    }
                }

                if (isMotion === null) {
                    // Some cameras emit motion without IsMotion flag — treat presence as trigger
                    isMotion = true;
                }

                this._dispatchMotion(isMotion, topic);
                return;
            }

            // Log unhandled topics for discovery
            console.log(`[Events] Unhandled topic: ${topic}`);

        } catch (err) {
            console.error('[Events] Error parsing event message:', err.message);
        }
    }

    /**
     * Debounced dispatch of motion state changes.
     */
    _dispatchMotion(isMotion, topic) {
        if (isMotion === this._lastMotionState) return; // Already in this state
        this._lastMotionState = isMotion;

        if (isMotion) {
            console.log('[Events] 🚨 Motion DETECTED');
            this._broadcast({
                type: 'camera_event',
                event: 'motion_start',
                label: 'Movimiento detectado',
                topic,
                timestamp: Date.now(),
            });
        } else {
            // User requested to remove cleared notifications as they are noisy/unreliable
            console.log('[Events] ✅ Motion CLEARED (Silent)');
        }

        // Auto-reset state after 30s silence (some cameras don't send motion_end)
        clearTimeout(this._motionDebounceTimer);
        if (isMotion) {
            this._motionDebounceTimer = setTimeout(() => {
                this._lastMotionState = false;
            }, 30000);
        }
    }

    _broadcast(payload) {
        if (typeof this.broadcastFn === 'function') {
            this.broadcastFn(payload);
        }
    }
}

module.exports = new CameraEvents();
