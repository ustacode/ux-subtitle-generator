import { spawn } from "child_process";
import { EventEmitter } from "events";

export class AudioIngestor extends EventEmitter {
  constructor(private sourceUrl: string) {
    super();
  }

  start() {
    const args = [
      "-i",
      this.sourceUrl,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      "pipe:1",
    ];

    console.log(
      `\n[AudioIngestor] Spawning ffmpeg with args: ffmpeg ${args
        .map((part) => (part.includes(" ") ? `"${part}"` : part))
        .join(" ")}`
    );

    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stdout.on("data", (chunk) => {
      this.emit("chunk", chunk);
    });
    ffmpeg.stderr.on("data", (d) => {
      console.debug(`\n[AudioIngestor] ffmpeg stderr: ${d}`);
      process.stderr.write(d);
    });
    ffmpeg.on("close", (code) => {
      console.log(`\n[AudioIngestor] ffmpeg process closed with code ${code}`);
      this.emit("end", code ?? 0);
    });
    ffmpeg.on("error", (error) => {
      console.error(`\n[AudioIngestor] Failed to spawn ffmpeg:`, error);
      this.emit("error", error as Error);
    });
  }
}
