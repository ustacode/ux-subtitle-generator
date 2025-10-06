import express from "express";
import http from "http";
import { config } from "./config.js";
import path from "path";
import { AudioIngestor } from "./services/AudioIngestor.js";
import { ChunkBuffer } from "./services/ChunkBuffer.js";
import { SubtitleBroadcaster } from "./services/SubtitleBroadcaster.js";
import {
  createTranscriber,
  createTranslator,
} from "./agents/index.js";
import type { Translator } from "./agents/Translator.js";
import { SlidingWindowRateLimiter } from "./utils/rateLimiter.js";
import { filterSilence } from "./utils/audio.js";

const app = express();
const server = http.createServer(app);
const broadcaster = new SubtitleBroadcaster(server);

console.log(
  `\n[Server] Starting with config: ${JSON.stringify({
    port: config.port,
    sourceUrl: config.sourceUrl,
    chunkFlushMs: config.chunkFlushMs,
    silenceThreshold: config.silenceThreshold,
    maxTranscriptionsPerMinute: config.maxTranscriptionsPerMinute ?? null,
    maxTranscriptionsPerHour: config.maxTranscriptionsPerHour ?? null,
    transcriberProvider: config.transcriberProvider,
    translatorProvider: config.translatorProvider ?? null,
    translationTarget: config.translationTarget ?? null,
  })}`
);

const transcriber = createTranscriber({
  provider: config.transcriberProvider,
  apiKey: config.openaiKey,
});

let translator: Translator | undefined;

const limiterWindows = [
  config.maxTranscriptionsPerMinute
    ? { windowMs: 60_000, limit: config.maxTranscriptionsPerMinute }
    : undefined,
  config.maxTranscriptionsPerHour
    ? { windowMs: 3_600_000, limit: config.maxTranscriptionsPerHour }
    : undefined,
].filter(Boolean) as Array<{ windowMs: number; limit: number }>;

const transcriptionLimiter =
  limiterWindows.length > 0
    ? new SlidingWindowRateLimiter(limiterWindows)
    : undefined;

if (config.translationTarget && config.translatorProvider) {
  try {
    translator = createTranslator({
      provider: config.translatorProvider,
      apiKey: config.openaiKey,
    });
  } catch (error) {
    console.error("Failed to initialize translator agent:", error);
  }
}

if (translator && config.translationTarget) {
  console.log(
    `\n🌐 Translation enabled — target language: ${config.translationTarget}`
  );
}

// serve public widget
app.use(express.static(path.resolve("src/public")));

const ingestor = new AudioIngestor(config.sourceUrl);
const buffer = new ChunkBuffer(
  async (audio) => {
    try {
      console.debug(
        `\n[Pipeline] Sending audio chunk (${audio.length} bytes) to transcriber`
      );

      const cleanedAudio = filterSilence(audio, {
        threshold: config.silenceThreshold,
      });

      if (cleanedAudio.length === 0) {
        console.debug(
          `\n[Pipeline] Skipping chunk after silence filtering (original ${audio.length} bytes)`
        );
        return;
      }

      if (cleanedAudio.length !== audio.length) {
        console.debug(
          `\n[Pipeline] Filtered chunk size ${cleanedAudio.length} bytes (original ${audio.length} bytes)`
        );
      }

      if (transcriptionLimiter) {
        await transcriptionLimiter.acquire("transcriptions");
      }

      const transcription = await transcriber.transcribe(cleanedAudio);
      if (!transcription) return;

      let finalText = transcription;
      let translatedText: string | undefined;

      if (translator && config.translationTarget) {
        console.debug(
          `\n[Pipeline] Translating text to ${config.translationTarget}: "${transcription}"`
        );
        translatedText = await translator.translate(
          transcription,
          config.translationTarget
        );
        if (translatedText) {
          finalText = translatedText;
        }
      }

      console.debug(
        `\n[Pipeline] Broadcasting text: "${finalText}"${
          translatedText ? ` (original: "${transcription}")` : ""
        }`
      );
      broadcaster.broadcast(
        translatedText
          ? { text: finalText, originalText: transcription }
          : { text: finalText }
      );
    } catch (error) {
      console.error("Failed to process audio chunk:", error);
    }
  },
  config.chunkFlushMs
);

ingestor.on("chunk", (chunk) => buffer.push(chunk));
ingestor.on("end", (code) => {
  buffer.flush();
  console.log(`\nAudio ingestion ended with code ${code}`);
});
ingestor.on("error", (error) =>
  console.error("Audio ingestion error:", error)
);
ingestor.start();

server.listen(config.port, () =>
  console.log(`\n🚀 Server running on port ${config.port}`)
);
