import express from "express";
import http from "http";
import path from "path";
import { existsSync, readFileSync } from "fs";
import { config } from "./config.js";
import { AudioIngestor } from "./services/AudioIngestor.js";
import { ChunkBuffer } from "./services/ChunkBuffer.js";
import { SubtitleBroadcaster } from "./services/SubtitleBroadcaster.js";
import { SubtitleService } from "./services/SubtitleService.js";
import { createTranscriber, createTranslator } from "./agents/index.js";
import type { Translator } from "./agents/Translator.js";
import { SlidingWindowRateLimiter } from "./utils/rateLimiter.js";
import { filterSilence } from "./utils/audio.js";
import { KickCommandListener } from "./services/KickCommandListener.js";

interface KickRuntimeSettings {
  channelSlug: string;
  commandPrefix?: string;
}

const loadKickRuntimeSettings = (): KickRuntimeSettings | undefined => {
  const settingsPath = path.resolve(process.cwd(), "kick-settings.json");
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<KickRuntimeSettings>;
    const channelSlug =
      typeof parsed.channelSlug === "string" ? parsed.channelSlug.trim() : "";

    if (!channelSlug) {
      console.warn(
        "[Kick] Ignoring kick-settings.json because channelSlug is missing."
      );
      return undefined;
    }

    const commandPrefix =
      typeof parsed.commandPrefix === "string" &&
      parsed.commandPrefix.trim().length > 0
        ? parsed.commandPrefix.trim()
        : undefined;

    return { channelSlug, commandPrefix };
  } catch (error) {
    console.error("[Kick] Failed to parse kick-settings.json:", error);
    return undefined;
  }
};

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
        `\n[Pipeline] Broadcasting text: "${finalText}"${translatedText ? ` (original: "${transcription}")` : ""
        }`
      );
      broadcaster.broadcast(
        translatedText
          ? { text: finalText, originalText: transcription, targetLang: config.translationTarget }
          : { text: finalText }
      );
    } catch (error) {
      console.error("Failed to process audio chunk:", error);
    }
  },
  config.chunkFlushMs
);

const subtitleService = new SubtitleService(ingestor, buffer);

subtitleService.on("started", () =>
  console.log("\n[SubtitleService] Pipeline started")
);
subtitleService.on("stopped", ({ code, byCommand }) => {
  const origin = byCommand ? "command" : "process";
  console.log(
    `\n[SubtitleService] Pipeline stopped by ${origin}${typeof code === "number" ? ` (code ${code})` : ""
    }`
  );
});
subtitleService.on("reset", () =>
  console.log("\n[SubtitleService] Pipeline reset")
);
subtitleService.on("error", (error) =>
  console.error("[SubtitleService] Pipeline error:", error)
);

subtitleService.start();

const kickSettings = loadKickRuntimeSettings();

if (config.kick && kickSettings) {
  const kickListener = new KickCommandListener({
    clientId: config.kick.clientId,
    clientSecret: config.kick.clientSecret,
  });

  kickListener.on("error", (error) =>
    console.error("[Kick] Listener error:", error)
  );
  kickListener.on("disconnected", (reason) =>
    console.warn(`[Kick] Listener disconnected: ${reason}`)
  );
  kickListener.on("connected", () =>
    console.log(
      `[Kick] Listening for commands on "${kickSettings.channelSlug}" with prefix "!${
        kickSettings.commandPrefix ?? "ux"
      }".`
    )
  );
  kickListener.on("command", async ({ action, username }) => {
    try {
      if (action === "start") {
        const started = subtitleService.start();
        console.log(
          `[Kick] Start command from ${username} — ${
            started ? "started" : "already running"
          }`
        );
      } else if (action === "stop") {
        const stopped = subtitleService.stop();
        console.log(
          `[Kick] Stop command from ${username} — ${
            stopped ? "stopping" : "already stopped"
          }`
        );
      } else if (action === "reset") {
        const reset = await subtitleService.reset();
        console.log(
          `[Kick] Reset command from ${username} — ${
            reset ? "restarted pipeline" : "failed to reset"
          }`
        );
      }
    } catch (error) {
      console.error("[Kick] Failed to handle command:", error);
    }
  });

  kickListener
    .start({
      channelSlug: kickSettings.channelSlug,
      commandPrefix: kickSettings.commandPrefix,
    })
    .catch((error) => console.error("[Kick] Failed to start listener:", error));

  kickListener
    .getAccessToken()
    .then((token) => {
      const expiryInfo =
        token.expiresIn > 0 ? `expires in ${token.expiresIn}s` : "no expiry";
      console.log(`[Kick] OAuth token acquired (${expiryInfo}).`);
    })
    .catch((error) => console.error("[Kick] Failed to fetch OAuth token:", error));
} else if (config.kick && !kickSettings) {
  console.warn(
    "[Kick] Client credentials detected but kick-settings.json is missing or invalid. Skipping Kick command listener."
  );
}

server.listen(config.port, () =>
  console.log(`\n🚀 Server running on port ${config.port}`)
);
