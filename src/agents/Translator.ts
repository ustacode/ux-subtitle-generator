import fetch, { Response } from "node-fetch";

export interface Translator {
  translate(text: string, targetLang: string): Promise<string>;
}

export class OpenAITranslator implements Translator {
  private static totalCharsSent = 0;
  private static totalRequests = 0;
  private static requestHistory: number[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-4o-mini",
    private readonly apiUrl = "https://api.openai.com/v1/chat/completions",
    private readonly systemPrompt = "You are a translation engine. Return concise translations without commentary."
  ) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required for OpenAITranslator");
    }
  }

  async translate(text: string, targetLang: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed || !targetLang.trim()) {
      return text;
    }

    const payload = {
      model: this.model,
      temperature: 0,
      messages: [
        { role: "system", content: this.systemPrompt },
        {
          role: "user",
          content: `Translate the following text to ${targetLang.trim()} and return only the translated sentence.\n\n${trimmed}`,
        },
      ],
    };

    console.debug(
      `\n[Translator] Translating to ${targetLang} via ${this.model}: "${trimmed}"`
    );

    OpenAITranslator.recordUsage(trimmed.length);

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    await this.assertSuccess(response);

    type ChatCompletion = {
      choices?: Array<{ message?: { content?: string | null } | null }>;
    };

    const data = (await response.json()) as ChatCompletion;
    const translation = data.choices?.[0]?.message?.content?.trim();
    if (translation) {
      console.debug(`\n[Translator] Translation response: "${translation}"`);
    } else {
      console.debug("\n[Translator] No translation provided, falling back");
    }
    return translation && translation.length > 0 ? translation : text;
  }

  private static recordUsage(chars: number): void {
    const now = Date.now();
    this.totalRequests += 1;
    this.totalCharsSent += chars;
    this.requestHistory.push(now);

    const hourAgo = now - 3_600_000;
    this.requestHistory = this.requestHistory.filter((ts) => ts >= hourAgo);

    const minuteAgo = now - 60_000;
    const perMinute = this.requestHistory.filter((ts) => ts >= minuteAgo).length;
    const perHour = this.requestHistory.length;

    console.debug(
      `[Translator] Stats — requests: total ${this.totalRequests}, last min ${perMinute}, last hour ${perHour}; characters total ${this.totalCharsSent}`
    );
  }

  private async assertSuccess(response: Response): Promise<void> {
    if (response.ok) {
      return;
    }

    let detail = "";
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      detail = payload.error?.message ?? "";
    } catch {
      detail = await response.text();
    }

    throw new Error(
      `OpenAI translation failed (${response.status} ${response.statusText})${
        detail ? `: ${detail}` : ""
      }`
    );
  }
}
