# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Node.js server that bridges a Tapo IP camera to a browser-based live monitor. It pulls the camera's RTSP stream via FFmpeg, transcodes/repackages it, and delivers it to clients over WebSocket (low-latency MPEG-TS) or HLS. Camera control (PTZ pan/tilt, imaging settings, motion events) is handled separately via the ONVIF protocol on port 2020.

## Running the server

Requires a `.env` file with `RTSP_URL=rtsp://user:password@192.168.x.x:554/stream1`.

```bash
npm start
```

The browser UI is at `http://localhost:3000/camara`.

There are no tests (`npm test` exits 1 by design).

## Architecture

### Startup sequence (`src/server/index.js`)

All modules must be initialized in this order because FFmpeg accumulates outputs before being started:

1. `FfmpegManager` is created with the RTSP URL.
2. `recorder.init()` — registers a segmented `.ts` recording output.
3. `controlSocket.init()` — creates the `/control` WebSocket and triggers the ONVIF connection chain (PTZ → imaging → events).
4. Active streamer (`WsStreamer` or `HlsStreamer`) `init()` — registers the streaming output.
5. `ffmpegManager.start()` — spawns the single FFmpeg process with all accumulated outputs simultaneously.
6. `activeStreamer.onProcessStart(process)` — WsStreamer attaches to FFmpeg's `stdout` pipe.

### FFmpegManager (`src/core/ffmpegManager.js`)

A single FFmpeg process serves all outputs (recording + streaming) at once by collecting argument arrays via `addOutput()` before `start()`. This is the critical design constraint: all modules must register their outputs before `ffmpegManager.start()` is called. Auto-restarts on non-zero exit codes (5-second delay). Detects Tapo's "stream occupied" error and broadcasts it via `global.broadcastError`.

### Streaming (`src/modules/streamers/WsStreamer.js`)

FFmpeg writes MPEG-TS to `pipe:1` (stdout); the streamer broadcasts raw binary chunks to all `/ws` WebSocket clients. The frontend uses mpegts.js, which auto-reconnects with exponential backoff on error.

### WebSocket routing (single port, `src/server/index.js`)

The HTTP server's `upgrade` event manually routes WebSocket upgrades:
- `/control` → `ControlSocket.wss` (PTZ commands, user presence, ping/pong)
- `/ws` → `WsStreamer.wss` (binary MPEG-TS stream)

### ONVIF module chain (`src/modules/`)

All three ONVIF-based modules share a single `Cam` instance created by the PTZ controller:

- `ptz/index.js`: Parses credentials from `RTSP_URL`, connects to camera at port 2020, retrieves the first PTZ-capable profile token, then calls `imaging.attachCam(cam)` and `cameraEvents.attachCam(cam)`.
- `imaging/index.js`: Wraps `getImagingSettings` / `setImagingSettings` for brightness, contrast, saturation, sharpness, and IR cut filter (`AUTO`/`ON`/`OFF`).
- `events/index.js`: Subscribes to ONVIF Pull-Point events and dispatches by topic type: `motion_start`, `people_start`, `tamper_detected`, `line_crossing`, `field_detection`. Each type has independent debounce state and auto-resets after 30 seconds of silence (some Tapo cameras don't send cleared events). Unknown topics are logged for discovery.

### Recorder (`src/modules/recorder/index.js`)

Records to `recordings/camara_YYYY-MM-DD_HH-MM-SS.ts` in 1-hour segments using FFmpeg's `segment` muxer. Uses `.ts` container because it never corrupts on abrupt shutdown, unlike MP4. Strips the "Session by TP Link" metadata title via `-map_metadata -1`.

### Recordings API (`src/modules/recordings/index.js`)

Express router mounted at `/api/recordings`. Serves files from the `recordings/` directory: `GET /` lists all `.ts` files, `GET /:filename` triggers a download, `DELETE /:filename` removes the file. Uses `path.basename` to prevent path traversal.

### Frontend (`public/camara/`)

Single-page vanilla JS app (mpegts.js only — no HLS). The control WebSocket and the stream player both auto-reconnect with exponential backoff (max 30s). `EVENT_CONFIG` in `app.js` maps each ONVIF event type to a toast CSS class and a sound profile. Sounds use the Web Audio API oscillator: descending sweep (motion), two ascending tones (people), square-wave buzz (tamper), triple pulse (line/field). Stats overlay shows live bitrate and FPS using `mpegts.Events.STATISTICS_INFO` + `video.getVideoPlaybackQuality()`. Notification and sound preferences are persisted in `localStorage`.
