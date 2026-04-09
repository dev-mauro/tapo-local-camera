/**
 * Imaging Controller — wraps the ONVIF imaging API.
 * Handles brightness, contrast, saturation, sharpness and IR cut filter.
 */
class ImagingController {
    constructor() {
        this.cam = null;
        this.ready = false;
        /** Cached settings fetched from camera */
        this.currentSettings = null;
    }

    /**
     * Attach the already-connected Cam instance (shared with PTZ).
     * Called once the camera is online and its profile is known.
     */
    attachCam(cam) {
        this.cam = cam;
        this.ready = true;
        console.log('[Imaging] Controller ready.');
    }

    /**
     * Fetch current imaging settings from camera.
     * @returns {Promise<object>}
     */
    getSettings() {
        return new Promise((resolve, reject) => {
            if (!this.ready) return reject(new Error('Imaging not ready'));
            this.cam.getImagingSettings((err, settings) => {
                if (err) return reject(err);
                this.currentSettings = settings;
                resolve(settings);
            });
        });
    }

    /**
     * Apply partial settings update. Only the provided keys are sent.
     * @param {object} patch  e.g. { brightness: 60, irCutFilter: 'OFF' }
     * @returns {Promise<void>}
     */
    applySettings(patch) {
        return new Promise((resolve, reject) => {
            if (!this.ready) return reject(new Error('Imaging not ready'));

            // Validate irCutFilter value
            if (patch.irCutFilter && !['AUTO', 'ON', 'OFF'].includes(patch.irCutFilter)) {
                return reject(new Error(`Invalid irCutFilter value: ${patch.irCutFilter}`));
            }

            console.log('[Imaging] Applying settings:', JSON.stringify(patch));

            this.cam.setImagingSettings(patch, (err) => {
                if (err) return reject(err);
                // Update local cache
                if (this.currentSettings) {
                    Object.assign(this.currentSettings, patch);
                }
                resolve();
            });
        });
    }
}

module.exports = new ImagingController();
