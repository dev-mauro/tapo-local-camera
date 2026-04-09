const { Cam } = require('onvif');

// Parse RTSP URL to extract camera credentials and IP
// Example: rtsp://user:password@192.168.1.34:554/stream1
function parseCameraUrl(rtspUrl) {
    try {
        const parsed = new URL(rtspUrl.replace(/^rtsp:\/\//, 'http://'));
        return {
            hostname: parsed.hostname,
            username: decodeURIComponent(parsed.username),
            password: decodeURIComponent(parsed.password),
        };
    } catch (e) {
        console.error('[PTZ] Failed to parse RTSP_URL:', e.message);
        return null;
    }
}

class PtzController {
    constructor() {
        this.cam = null;
        this.profileToken = null;
        this.ready = false;
    }

    init(rtspUrl) {
        const credentials = parseCameraUrl(rtspUrl);
        if (!credentials) {
            console.error('[PTZ] Cannot initialize: invalid RTSP_URL');
            return;
        }

        const { hostname, username, password } = credentials;
        console.log(`[PTZ] Connecting to camera at ${hostname} via ONVIF (user: ${username})...`);

        // Tapo cameras typically use port 2020 for ONVIF
        this.cam = new Cam({
            hostname,
            username,
            password,
            port: 2020,
            timeout: 10000,
        }, (err) => {
            if (err) {
                console.error('[PTZ] ONVIF connection error:', err.message || err);
                return;
            }

            // Get the first PTZ-capable profile token
            this.cam.getProfiles((err, profiles) => {
                if (err) {
                    console.error('[PTZ] Failed to get profiles:', err.message || err);
                    return;
                }

                // Pick first profile that has a PTZ configuration
                const ptzProfile = profiles.find(p => p.PTZConfiguration) || profiles[0];
                if (ptzProfile) {
                    this.profileToken = ptzProfile.$.token;
                    this.ready = true;
                    console.log(`[PTZ] Ready. Profile token: "${this.profileToken}"`);
                } else {
                    console.error('[PTZ] No PTZ-capable profile found on camera.');
                }
            });
        });
    }

    /**
     * Move camera continuously in the given direction.
     * Uses the onvif lib's flat options format: { x, y, zoom, profileToken }
     * x/y range: -1.0 to 1.0 (pan left/right, tilt up/down)
     *
     * @param {'up'|'down'|'left'|'right'} direction
     * @param {number} speed  0.0 – 1.0
     */
    move(direction, speed = 0.5) {
        if (!this.ready) {
            console.warn('[PTZ] Not ready yet. Ignoring move command.');
            return;
        }

        // Clamp speed
        const s = Math.min(1, Math.max(0, speed));

        // The onvif lib's continuousMove uses flat x/y/zoom keys
        let x = 0;
        let y = 0;

        switch (direction) {
            case 'up':    y =  s; break;
            case 'down':  y = -s; break;
            case 'right': x =  s; break;
            case 'left':  x = -s; break;
            default:
                console.warn('[PTZ] Unknown direction:', direction);
                return;
        }

        console.log(`[PTZ] continuousMove → direction: ${direction}, x: ${x}, y: ${y}`);

        this.cam.continuousMove({
            profileToken: this.profileToken,
            x,
            y,
            zoom: 0,
        }, (err) => {
            if (err) console.error('[PTZ] continuousMove error:', err.message || err);
        });
    }

    stop() {
        if (!this.ready) return;

        console.log('[PTZ] Sending stop');

        this.cam.stop({
            profileToken: this.profileToken,
            panTilt: true,
            zoom: false,
        }, (err) => {
            if (err) console.error('[PTZ] stop error:', err.message || err);
        });
    }
}

module.exports = new PtzController();
