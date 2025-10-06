# Ux Subtitle Generator Service

Real-time subtitle generator for livestreams.

## Features
- Ingest SRTLA / RTMP streams with FFmpeg
- Transcribe audio using OpenAI Whisper API
- Broadcast live captions via WebSocket
- Optional live translation via OpenAI GPT-4o-mini
- Easily embed subtitles in OBS (Browser Source)

## Usage
1. Copy `.env.example` → `.env` and fill API key + stream URL (optionally set `TRANSLATION_TARGET`).
2. Run `npm install`
3. Start dev mode: `npm run dev`
4. Add OBS Browser Source → `http://localhost:8080/widget.html`

## Configuration
- `OPENAI_API_KEY`: required for transcription/translation.
- `SOURCE_URL`: SRT/RTMP input stream.
- `CHUNK_FLUSH_MS`: audio window (ms) sent to the transcriber, defaults to 2000.
- `SILENCE_THRESHOLD`: normalized RMS threshold (default 0.015). Frames below this level are dropped before sending to OpenAI.
- `MAX_TRANSCRIPTIONS_PER_MINUTE` / `MAX_TRANSCRIPTIONS_PER_HOUR`: optional rate limits for OpenAI calls (defaults to 60 per minute and 3600 per hour). Set to blank to disable.
- `TRANSLATION_TARGET`: optional language label (e.g. `Spanish`, `fr-FR`) to enable translation.
- `TRANSCRIBER_PROVIDER` / `TRANSLATOR_PROVIDER`: switch agent backends (default `openai-*`).

## Debugging FFmpeg Ingestion
Run the same FFmpeg command locally to verify your stream:
```bash
ffmpeg -i "srt://belabox-ip:port" -vn -ac 1 -ar 16000 -f s16le pipe:1
```
or replace the input with your RTMP endpoint:
```bash
ffmpeg -i "rtmp://belabox.cloud/live/streamkey" -vn -ac 1 -ar 16000 -f s16le pipe:1
```
You should see raw PCM bytes streaming to stdout (binary). Use `-loglevel debug` for additional FFmpeg diagnostics.

## Replaceable Agents
- `/src/agents/Transcriber.ts` → swap in Deepgram / Google / Local Whisper
- `/src/agents/Translator.ts` → add translation if needed
