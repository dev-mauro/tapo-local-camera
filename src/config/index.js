require('dotenv').config();

// Parse CLI arguments (e.g., --stream=ws)
const args = process.argv.slice(2).reduce((acc, arg) => {
    const [key, value] = arg.split('=');
    if (key.startsWith('--')) {
        acc[key.slice(2)] = value || true;
    }
    return acc;
}, {});

module.exports = {
    RTSP_URL: process.env.RTSP_URL,
    PORT: process.env.PORT || 3000,
    STREAM_STRATEGY: args.stream || process.env.STREAM_STRATEGY || 'ws', // Defaults to ws
};
