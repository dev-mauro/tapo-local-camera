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
};
