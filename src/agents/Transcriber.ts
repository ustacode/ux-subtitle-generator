import FormData from "form-data";
import fetch, { Response, type BodyInit } from "node-fetch";

export interface Transcriber {
  transcribe(audio: Buffer): Promise<string>;
}

export class OpenAIWhisperTranscriber implements Transcriber {
  private static totalBytesSent = 0;

  constructor(
    private readonly apiKey: string,
    private readonly model = "whisper-1",
    private readonly apiUrl = "https://api.openai.com/v1/audio/transcriptions"
  ) {
    if (!apiKey) {
      throw new Error("OpenAI API key is required for OpenAIWhisperTranscriber");
    }
  }

  async transcribe(audio: Buffer): Promise<string> {
    if (audio.length === 0) {
      return "";
    }

    const formData = new FormData();
    formData.append("file", audio, {
      filename: "chunk.wav",
      contentType: "audio/wav",
    });
    formData.append("model", this.model);

    console.debug(
      `\n[Transcriber] Calling OpenAI Whisper (${this.model}) with ${
        audio.length
      } bytes (~${(audio.length / 1024 / 1024).toFixed(3)} MiB)`
    );

    OpenAIWhisperTranscriber.totalBytesSent += audio.length;
    console.debug(
      `[Transcriber] Total audio uploaded this session: ${
        OpenAIWhisperTranscriber.totalBytesSent
      } bytes (~${(
        OpenAIWhisperTranscriber.totalBytesSent /
        1024 /
        1024
      ).toFixed(3)} MiB)`
    );

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData as unknown as BodyInit,
    });

    await this.assertSuccess(response);

    const data = (await response.json()) as { text?: string };
    const text = data.text ?? "";
    console.debug(`\n[Transcriber] Received transcription: "${text}"`);
    return text;
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
      `OpenAI Whisper transcription failed (${response.status} ${response.statusText})${
        detail ? `: ${detail}` : ""
      }`
    );
  }

}
