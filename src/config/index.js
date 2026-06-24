require('dotenv').config();

module.exports = {
    RTSP_URL: process.env.RTSP_URL,
    PORT: process.env.PORT || 3000,
};
