const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
    RTSP_URL: process.env.RTSP_URL,
    PORT: process.env.PORT || 3000,

    // ── go2rtc (servidor de medios WebRTC) ────────────────────────────────────
    STREAM_NAME: process.env.STREAM_NAME || 'camara',
    GO2RTC_API_PORT: parseInt(process.env.GO2RTC_API_PORT || '1984', 10),
    GO2RTC_RTSP_PORT: parseInt(process.env.GO2RTC_RTSP_PORT || '8554', 10),
    GO2RTC_WEBRTC_PORT: parseInt(process.env.GO2RTC_WEBRTC_PORT || '8555', 10),
    // Ruta al binario de go2rtc. Si está vacío, se busca en <proyecto>/bin/.
    GO2RTC_BIN: process.env.GO2RTC_BIN || '',

    // ── Logging ────────────────────────────────────────────────────────────
    LOG_TO_FILE: process.env.LOG_TO_FILE !== 'false',

    // ── Watchers ───────────────────────────────────────────────────────────
    RECORDING_CHECK_INTERVAL_MS: parseInt(process.env.RECORDING_CHECK_INTERVAL_MS || '15000', 10),
    RECORDING_STALL_THRESHOLD_MS: parseInt(process.env.RECORDING_STALL_THRESHOLD_MS || '30000', 10),
    STORAGE_CHECK_INTERVAL_MS: parseInt(process.env.STORAGE_CHECK_INTERVAL_MS || '30000', 10),
    STORAGE_LOW_THRESHOLD_PERCENT: parseInt(process.env.STORAGE_LOW_THRESHOLD_PERCENT || '10', 10),

    // ── Eventos de cámara (ONVIF) ──────────────────────────────────────────
    // Tiempo mínimo entre alertas del mismo tipo, para que una sola persona/objeto
    // moviéndose por el encuadre (que puede generar varios ciclos start/stop) no
    // dispare notificaciones repetidas.
    EVENT_ALERT_COOLDOWN_MS: parseInt(process.env.EVENT_ALERT_COOLDOWN_MS || '60000', 10),
};
