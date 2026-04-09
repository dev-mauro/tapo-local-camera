const fs = require('fs');
const path = require('path');

class HlsStreamer {
    init(app, server, ffmpegManager) {
        const hlsDir = path.join(__dirname, '../../../public/hls');
        if (!fs.existsSync(hlsDir)) {
            fs.mkdirSync(hlsDir, { recursive: true });
        }

        // Add FFmpeg options for HLS segmenting
        ffmpegManager.addOutput([
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-ar', '44100',
            '-b:a', '128k',
            '-f', 'hls',
            '-hls_time', '2',             // 2 seconds per segment (low latency)
            '-hls_list_size', '3',        // Keep only 3 segments in the playlist
            '-hls_flags', 'delete_segments', // Delete old segments
            path.join(hlsDir, 'stream.m3u8')
        ]);

        console.log("HLS Streamer module initialized.");
    }
}

module.exports = new HlsStreamer();
