## Overview

**Ux Subtitle Generator Service** is a cloud-based, real-time subtitle generation service for livestreams.
It ingests an **SRTLA / RTMP stream**, extracts live audio, transcribes it (and optionally translates it), and broadcasts subtitles to a live **HTML widget** that can be displayed in **OBS**.

The system is **fully modular** — every layer (ingestion, transcription, translation, broadcasting) is **replaceable and decoupled**.

---

## 🎯 Design Goals

* 🧩 **Pluggable agents** for transcription and translation.
* ☁️ **No local GPU or storage.** Uses APIs and streams.
* ⚡ **Real-time FFmpeg ingestion** from SRT/RTMP.
* 🪶 **Lightweight, low-latency (<2–3 s)** pipeline.
* 🧱 **Clean, typed interfaces** for future backends (Whisper, Deepgram, Google STT, local ASR).
* 🔧 **Codex-friendly modular structure** for easy extension.

---

## 🗂️ Project Structure

```
/src
  ├── index.ts                      # Main entrypoint (Express / WebSocket)
  ├── config.ts                     # Env vars, constants
  ├── agents/
  │     ├── Transcriber.ts          # Interface + default OpenAI implementation
  │     ├── Translator.ts           # Interface + default OpenAI implementation
  │     └── index.ts                # Agent factory / registry
  ├── services/
  │     ├── AudioIngestor.ts        # FFmpeg ingestion + chunk streaming
  │     ├── SubtitleBroadcaster.ts  # WebSocket broadcasting
  │     └── ChunkBuffer.ts          # Handles audio buffering logic
  ├── public/
  │     └── widget.html             # Subtitle overlay for OBS
  └── utils/
        └── helpers.ts              # Utility functions
```

---

## 🧩 Agent Interfaces

### 🗣️ Transcriber Agent

Handles speech-to-text from live PCM audio chunks.

```ts
export interface Transcriber {
  transcribe(audio: Buffer): Promise<string>;
}
```

#### Default Implementation — `OpenAIWhisperTranscriber`

Uses OpenAI Whisper API (`whisper-1` model).

```ts
import fetch from "node-fetch";

export class OpenAIWhisperTranscriber implements Transcriber {
  async transcribe(audio: Buffer): Promise<string> {
    const formData = new FormData();
    formData.append("file", new Blob([audio]), "chunk.wav");
    formData.append("model", "whisper-1");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });

    const data = await res.json();
    return data.text || "";
  }
}
```

#### Future Implementations

* `DeepgramTranscriber` — WebSocket streaming.
* `GoogleSTTTranscriber` — bidirectional streaming.
* `LocalWhisperTranscriber` — GPU inference (faster-whisper).
* `AssemblyAITranscriber` — HTTP streaming.

---

### 🌐 Translator Agent

Optional step: translates text into another language.

```ts
export interface Translator {
  translate(text: string, targetLang: string): Promise<string>;
}
```

#### Default Implementation — `OpenAITranslator`

Uses GPT-4o-mini (cheap, fast).

```ts
export class OpenAITranslator implements Translator {
  async translate(text: string, targetLang: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a translation engine." },
          { role: "user", content: `Translate to ${targetLang}: ${text}` }
        ]
      })
    });
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  }
}
```

#### Future Implementations

* `LibreTranslateAgent`
* `NLLBTranslator`
* `LocalTransformerTranslator`

---

## 🎧 Realtime Audio Ingest Architecture

### Goal

Convert **SRTLA / RTMP** livestreams into live audio chunks (`PCM s16le`) for transcription — **no temp files**.

### 1. FFmpeg Piping

Use FFmpeg to pull the stream and send raw audio to stdout:

```bash
ffmpeg -i "srt://belabox-ip:port" \
  -vn -ac 1 -ar 16000 -f s16le pipe:1
```

Or for RTMP:

```bash
ffmpeg -i "rtmp://belabox.cloud/live/streamkey" \
  -vn -ac 1 -ar 16000 -f s16le pipe:1
```

### 2. AudioIngestor Service

Spawns FFmpeg as a subprocess and emits audio buffers:

```ts
import { spawn } from "child_process";
import { EventEmitter } from "events";

export class AudioIngestor extends EventEmitter {
  constructor(private sourceUrl: string) {
    super();
  }

  start() {
    const ffmpeg = spawn("ffmpeg", [
      "-i", this.sourceUrl,
      "-vn", "-ac", "1", "-ar", "16000",
      "-f", "s16le", "pipe:1"
    ]);

    ffmpeg.stdout.on("data", chunk => {
      this.emit("chunk", chunk);
    });

    ffmpeg.on("close", code => this.emit("end", code));
  }
}
```

### 3. ChunkBuffer Service

Collects small buffers (~2 s) and sends them to the transcriber.

```ts
export class ChunkBuffer {
  private buffers: Buffer[] = [];
  private lastFlush = Date.now();

  constructor(private onFlush: (audio: Buffer) => void) {}

  push(chunk: Buffer) {
    this.buffers.push(chunk);
    const elapsed = Date.now() - this.lastFlush;
    if (elapsed > 2000) {
      const audio = Buffer.concat(this.buffers);
      this.buffers = [];
      this.lastFlush = Date.now();
      this.onFlush(audio);
    }
  }
}
```

### 4. Putting It Together

```ts
const ingestor = new AudioIngestor("srt://belabox-ip:port");
const buffer = new ChunkBuffer(async audio => {
  const text = await transcriber.transcribe(audio);
  broadcaster.broadcast({ text });
});

ingestor.on("chunk", chunk => buffer.push(chunk));
ingestor.start();
```

---

## 📡 SubtitleBroadcaster Service

Handles WebSocket connections and sends real-time updates.

```ts
import { WebSocketServer } from "ws";

export class SubtitleBroadcaster {
  private clients = new Set<WebSocket>();

  constructor(server: any) {
    const wss = new WebSocketServer({ server });
    wss.on("connection", ws => {
      this.clients.add(ws);
      ws.on("close", () => this.clients.delete(ws));
    });
  }

  broadcast(payload: any) {
    const msg = JSON.stringify(payload);
    for (const ws of this.clients) ws.send(msg);
  }
}
```

---

## 🪶 Widget (OBS Browser Source)

`/public/widget.html`

```html
<!DOCTYPE html>
<html>
  <body style="background:transparent;color:white;font-size:30px;text-shadow:2px 2px 4px #000;">
    <div id="subtitles"></div>
    <script>
      const ws = new WebSocket("wss://uxsubtitles.com/ws");
      ws.onmessage = e => {
        const { text } = JSON.parse(e.data);
        document.getElementById("subtitles").innerText = text;
      };
    </script>
  </body>
</html>
```

---

## 🔧 Configuration

`.env` example:

```
PORT=8080
OPENAI_API_KEY=sk-xxxx
SOURCE_URL=srt://belabox-ip:port
```

---

## 🚀 Deployment

* Use **Render** or **Fly.io** for full WebSocket support.
* Dockerfile should include:

  * `node:20-alpine`
  * `ffmpeg`
* Expose port `$PORT`.

---

## 🔁 Extensibility

| Layer       | Replaceable | How                                                    |
| ----------- | ----------- | ------------------------------------------------------ |
| Ingest      | ✅           | Replace FFmpeg command or source URL (RTSP, HLS, etc.) |
| Transcriber | ✅           | Swap in a new agent implementing `Transcriber`         |
| Translator  | ✅           | Swap in a new agent implementing `Translator`          |
| Broadcaster | ✅           | Replace WS with SSE or Socket.io                       |
| Widget      | ✅           | Customize HTML / CSS / animation                       |

---

## 🪄 Notes for Codex

When implementing:

1. Use **TypeScript ES Modules** (`"type": "module"` in package.json).
2. Scaffold each agent in `/src/agents/` with clear exports.
3. Implement `index.ts` to:

   * Load config
   * Initialize Express + WebSocket server
   * Create `AudioIngestor`, `ChunkBuffer`, `Transcriber`, `SubtitleBroadcaster`
   * Stream → Transcribe → Broadcast loop
4. Serve `/public` statically for widget access.
5. Keep each layer **stateless and loosely coupled** — only communicate through async events or interfaces.
