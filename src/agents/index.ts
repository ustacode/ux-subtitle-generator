import { OpenAIWhisperTranscriber, Transcriber } from "./Transcriber.js";
import { OpenAITranslator, Translator } from "./Translator.js";

export type TranscriberProvider = "openai-whisper";
export type TranslatorProvider = "openai";

export interface TranscriberOptions {
  provider?: TranscriberProvider;
  apiKey: string;
  model?: string;
  apiUrl?: string;
}

export interface TranslatorOptions {
  provider?: TranslatorProvider;
  apiKey: string;
  model?: string;
  apiUrl?: string;
  systemPrompt?: string;
}

export const createTranscriber = (options: TranscriberOptions): Transcriber => {
  const provider = options.provider ?? "openai-whisper";

  switch (provider) {
    case "openai-whisper":
      return new OpenAIWhisperTranscriber(
        options.apiKey,
        options.model,
        options.apiUrl
      );
    default:
      throw new Error(`Unsupported transcriber provider: ${provider}`);
  }
};

export const createTranslator = (options: TranslatorOptions): Translator => {
  const provider = options.provider ?? "openai";

  switch (provider) {
    case "openai":
      return new OpenAITranslator(
        options.apiKey,
        options.model,
        options.apiUrl,
        options.systemPrompt
      );
    default:
      throw new Error(`Unsupported translator provider: ${provider}`);
  }
};
