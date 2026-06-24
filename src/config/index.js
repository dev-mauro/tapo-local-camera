const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
    RTSP_URL: process.env.RTSP_URL,
    PORT: process.env.PORT || 3000,
};
