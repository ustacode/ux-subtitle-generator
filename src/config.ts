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

const parsePositiveInt = (
  value: string | undefined,
  fallback?: number
): number | undefined => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
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
  maxTranscriptionsPerMinute?: number;
  maxTranscriptionsPerHour?: number;
  transcriberProvider: TranscriberProvider;
  translatorProvider?: TranslatorProvider;
  translationTarget?: string;
}

export const config: AppConfig = {
  port: parseNumber(process.env.PORT, 8080),
  openaiKey: process.env.OPENAI_API_KEY ?? "",
  sourceUrl: process.env.SOURCE_URL ?? "srt://localhost:9000",
  chunkFlushMs: parseNumber(process.env.CHUNK_FLUSH_MS, 2000),
  maxTranscriptionsPerMinute: parsePositiveInt(
    process.env.MAX_TRANSCRIPTIONS_PER_MINUTE,
    60
  ),
  maxTranscriptionsPerHour: parsePositiveInt(
    process.env.MAX_TRANSCRIPTIONS_PER_HOUR,
    3600
  ),
  transcriberProvider,
  translatorProvider,
  translationTarget,
};
