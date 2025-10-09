import { EventEmitter } from "events";
import { AudioIngestor } from "./AudioIngestor.js";
import { ChunkBuffer } from "./ChunkBuffer.js";

interface StopOptions {
  flush?: boolean;
  signal?: NodeJS.Signals | number;
}

interface StoppedEventPayload {
  code?: number;
  byCommand: boolean;
}

export declare interface SubtitleService {
  on(event: "started", listener: () => void): this;
  on(event: "stopped", listener: (payload: StoppedEventPayload) => void): this;
  on(event: "reset", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  emit(event: "started"): boolean;
  emit(event: "stopped", payload: StoppedEventPayload): boolean;
  emit(event: "reset"): boolean;
  emit(event: "error", error: Error): boolean;
}

export class SubtitleService extends EventEmitter {
  private running = false;
  private stopRequested = false;

  constructor(
    private readonly ingestor: AudioIngestor,
    private readonly buffer: ChunkBuffer
  ) {
    super();

    this.ingestor.on("chunk", (chunk) => {
      if (!this.running) return;
      this.buffer.push(chunk);
    });

    this.ingestor.on("end", (code) => {
      if (!this.stopRequested) {
        this.buffer.flush();
      }
      const wasRunning = this.running;
      this.running = false;
      const byCommand = this.stopRequested;
      this.stopRequested = false;
      this.emit("stopped", { code, byCommand });
      if (wasRunning && !byCommand) {
        console.warn(
          `[SubtitleService] Audio ingestor ended unexpectedly (code: ${code})`
        );
      }
    });

    this.ingestor.on("error", (error) => {
      this.running = false;
      this.stopRequested = false;
      this.emit("error", error);
    });
  }

  start(): boolean {
    if (this.running) {
      console.warn("[SubtitleService] Ignoring start command, already running");
      return false;
    }
    this.buffer.reset();
    this.running = true;
    this.stopRequested = false;
    this.ingestor.start();
    this.emit("started");
    return true;
  }

  stop(options: StopOptions = {}): boolean {
    if (!this.running) {
      console.warn("[SubtitleService] Ignoring stop command, service idle");
      return false;
    }

    const { flush = true, signal = "SIGTERM" } = options;
    this.stopRequested = true;
    this.running = false;
    if (flush) {
      this.buffer.flush();
    } else {
      this.buffer.reset();
    }
    const stopped = this.ingestor.stop(signal);
    if (!stopped) {
      this.stopRequested = false;
      this.running = true;
      return false;
    }
    return true;
  }

  async reset(): Promise<boolean> {
    if (!this.running) {
      this.buffer.reset();
      this.emit("reset");
      return true;
    }
    const stopResult = await new Promise<boolean>((resolve) => {
      const onStopped = () => {
        this.off("stopped", onStopped);
        resolve(true);
      };
      this.on("stopped", onStopped);
      const stopped = this.stop({ flush: false });
      if (!stopped) {
        this.off("stopped", onStopped);
        resolve(false);
      }
    });

    if (!stopResult) {
      console.error("[SubtitleService] Reset aborted — failed to stop service");
      return false;
    }

    const restarted = this.start();
    if (restarted) {
      this.emit("reset");
    }
    return restarted;
  }

  isRunning(): boolean {
    return this.running && this.ingestor.isRunning;
  }
}
