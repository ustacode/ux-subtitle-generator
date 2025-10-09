import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { EventEmitter } from "events";

export class AudioIngestor extends EventEmitter {
  private process?: ChildProcessWithoutNullStreams;

  constructor(private sourceUrl: string) {
    super();
  }

  start() {
    if (this.process) {
      console.warn("[AudioIngestor] Attempt to start while already running");
      return;
    }

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
    this.process = ffmpeg;

    ffmpeg.stdout.on("data", (chunk) => {
      this.emit("chunk", chunk);
    });
    ffmpeg.stderr.on("data", (d) => {
      console.debug(`\n[AudioIngestor] ffmpeg stderr: ${d}`);
      process.stderr.write(d);
    });
    ffmpeg.on("close", (code) => {
      this.process = undefined;
      console.log(`\n[AudioIngestor] ffmpeg process closed with code ${code}`);
      this.emit("end", code ?? 0);
    });
    ffmpeg.on("error", (error) => {
      this.process = undefined;
      console.error(`\n[AudioIngestor] Failed to spawn ffmpeg:`, error);
      this.emit("error", error as Error);
    });
  }

  stop(signal: NodeJS.Signals | number = "SIGTERM") {
    if (!this.process) {
      console.warn("[AudioIngestor] Attempt to stop while not running");
      return false;
    }
    const stopped = this.process.kill(signal);
    if (!stopped) {
      console.error("[AudioIngestor] Failed to signal ffmpeg process to stop");
      return false;
    }
    console.log("[AudioIngestor] Stop signal sent to ffmpeg process");
    return true;
  }

  get isRunning(): boolean {
    return Boolean(this.process);
  }
}
