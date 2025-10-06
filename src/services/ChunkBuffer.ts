export class ChunkBuffer {
  private buffers: Buffer[] = [];
  private lastFlush = Date.now();

  constructor(
    private readonly onFlush: (audio: Buffer) => Promise<void> | void,
    private readonly flushIntervalMs = 2000
  ) {}

  push(chunk: Buffer): void {
    this.buffers.push(chunk);
    const elapsed = Date.now() - this.lastFlush;
    if (elapsed >= this.flushIntervalMs) {
      console.debug(
        `[ChunkBuffer] Flush interval reached (${elapsed} ms >= ${this.flushIntervalMs} ms)`
      );
      this.flush();
    }
  }

  flush(): void {
    if (this.buffers.length === 0) return;
    const audio = Buffer.concat(this.buffers);
    this.buffers = [];
    this.lastFlush = Date.now();
    console.debug(
      `\n[ChunkBuffer] Flushing audio buffer (${audio.length} bytes)`
    );
    void this.onFlush(audio);
  }

  reset(): void {
    this.buffers = [];
    this.lastFlush = Date.now();
    console.debug("\n[ChunkBuffer] Reset buffer state");
  }
}
