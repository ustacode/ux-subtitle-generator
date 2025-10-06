import * as dotenv from "dotenv";
import type {
  TranscriberProvider,
  TranslatorProvider,
} from "./agents/index.js";
dotenv.config();

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFloatSafe = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const optionalString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const translationTarget =
  optionalString(process.env.TRANSLATION_TARGET) ??
  optionalString(process.env.TARGET_LANG);

const toTranscriberProvider = (
  value: string | undefined
): TranscriberProvider => {
  if (!value || value === "openai-whisper") {
    return "openai-whisper";
  }
  throw new Error(`Unsupported transcriber provider: ${value}`);
};

const toTranslatorProvider = (
  value: string | undefined,
  target?: string
): TranslatorProvider | undefined => {
  if (!target) {
    return undefined;
  }
  if (!value || value === "openai") {
    return "openai";
  }
  throw new Error(`Unsupported translator provider: ${value}`);
};

const transcriberProvider = toTranscriberProvider(
  optionalString(process.env.TRANSCRIBER_PROVIDER)
);

const translatorProvider = toTranslatorProvider(
  optionalString(process.env.TRANSLATOR_PROVIDER),
  translationTarget
);

export interface AppConfig {
  port: number;
  openaiKey: string;
  sourceUrl: string;
  chunkFlushMs: number;
  silenceThreshold: number;
  transcriberProvider: TranscriberProvider;
  translatorProvider?: TranslatorProvider;
  translationTarget?: string;
}

export const config: AppConfig = {
  port: parseNumber(process.env.PORT, 8080),
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  sourceUrl: process.env.SOURCE_URL ?? "srt://localhost:9000",
  chunkFlushMs: parseNumber(process.env.CHUNK_FLUSH_MS, 2000),
  silenceThreshold: parseFloatSafe(process.env.SILENCE_THRESHOLD, 0.015),
  transcriberProvider,
  translatorProvider,
  translationTarget,
};
