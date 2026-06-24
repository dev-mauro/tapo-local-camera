# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

A Node.js server that bridges a Tapo IP camera to a browser-based live monitor. **go2rtc** is the single RTSP consumer of the camera: it serves the live video to the browser over **WebRTC** (sub-second latency, native audio) and exposes a local RTSP re-stream that an FFmpeg process records to disk. Camera control (PTZ pan/tilt, imaging settings, motion events) is handled separately via the ONVIF protocol on port 2020.

WebRTC is strictly live (no DVR back-buffer); past footage is viewed through the Recordings modal.

## Running the server

Requires a `.env` file with `RTSP_URL=rtsp://user:password@192.168.x.x:554/stream1`.

First-time setup downloads the go2rtc binary into `bin/`:

```bash
npm run setup:go2rtc
npm start
```

go2rtc ports (overridable in `.env`): API/WebRTC signaling `1984`, RTSP re-stream `8554`, WebRTC ICE `8555`. The browser connects to go2rtc's WebRTC signaling on `GO2RTC_API_PORT` directly (separate port from the app's `3000`), so that port must be reachable from clients on the LAN.

The browser UI is at `http://localhost:3000/camara`.

There are no tests (`npm test` exits 1 by design).

## Architecture

### Startup sequence (`src/server/index.js`)

1. `Go2rtcManager` is created with the camera's `RTSP_URL` and `start()`ed — it becomes the only consumer of the camera's RTSP feed.
2. `FfmpegManager` is created pointing at go2rtc's **local** RTSP re-stream (`rtsp://127.0.0.1:8554/<stream>`), not the camera.
3. `recorder.init()` — registers a segmented `.ts` recording output on that FFmpeg.
4. `controlSocket.init()` — creates the `/control` WebSocket and triggers the ONVIF connection chain (PTZ → imaging → events).
5. `ffmpegManager.start()` — started after a 2s delay so go2rtc's re-stream is up (FFmpeg auto-retries regardless).

### Go2rtcManager (`src/core/go2rtcManager.js`)

Spawns and supervises the `go2rtc` binary (resolved from `GO2RTC_BIN` or `bin/go2rtc[.exe]`, else PATH). Generates a YAML config in the OS temp dir from the RTSP URL and ports. Auto-restarts on exit (5s delay). Exposes `localRtspUrl` for the recorder.

### FFmpegManager (`src/core/ffmpegManager.js`)

A single FFmpeg process handles recording, reading from go2rtc's local re-stream. Outputs are collected via `addOutput()` before `start()`. Auto-restarts on non-zero exit codes (5-second delay).

### Streaming (WebRTC via go2rtc)

There is no Node-side streamer. The browser (`public/camara/app.js`) opens a WebRTC `RTCPeerConnection` and performs SDP/ICE signaling against go2rtc's WebSocket API at `ws://<host>:<GO2RTC_API_PORT>/api/ws?src=<stream>`. The port/stream name are injected via the dynamic `GET /camara/config.js` route. The player auto-reconnects with exponential backoff on connection failure.

### WebSocket routing (`src/server/index.js`)

The HTTP server's `upgrade` event only routes `/control` → `ControlSocket.wss` (PTZ commands, user presence, ping/pong). WebRTC signaling goes directly to go2rtc on its own port.

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

Single-page vanilla JS app. Video is played via native **WebRTC** into the `<video>` element (no external player library). The control WebSocket and the WebRTC player both auto-reconnect with exponential backoff (max 30s). DVR-style controls (seek bar, live-sync button) are hidden because WebRTC has no back-buffer. PTZ can be driven with the on-screen D-pad or the keyboard arrow keys. `EVENT_CONFIG` in `app.js` maps each ONVIF event type to a toast CSS class and a sound profile. Sounds use the Web Audio API oscillator: descending sweep (motion), two ascending tones (people), square-wave buzz (tamper), triple pulse (line/field). Stats overlay shows live bitrate (from `RTCPeerConnection.getStats()` inbound-rtp) and FPS (`video.getVideoPlaybackQuality()`). Notification and sound preferences are persisted in `localStorage`.
