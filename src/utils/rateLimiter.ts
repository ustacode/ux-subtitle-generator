export interface RateLimitWindow {
  windowMs: number;
  limit: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SlidingWindowRateLimiter {
  private readonly windows: RateLimitWindow[];
  private history: number[] = [];

  constructor(windows: RateLimitWindow[]) {
    this.windows = windows
      .filter((window) => window.limit > 0 && window.windowMs > 0)
      .sort((a, b) => a.windowMs - b.windowMs);
  }

  async acquire(label?: string): Promise<void> {
    if (this.windows.length === 0) {
      return;
    }

    for (;;) {
      const now = Date.now();
      const maxWindow = this.windows[this.windows.length - 1].windowMs;
      this.history = this.history.filter((ts) => now - ts < maxWindow);

      let waitMs = 0;

      for (const { windowMs, limit } of this.windows) {
        const windowStart = now - windowMs;
        const inWindow = this.history.filter((ts) => ts >= windowStart);
        if (inWindow.length >= limit) {
          const earliest = inWindow[0];
          const candidate = windowMs - (now - earliest) + 5;
          if (candidate > waitMs) {
            waitMs = candidate;
          }
        }
      }

      if (waitMs <= 0) {
        this.history.push(now);
        return;
      }

      const labelText = label ? ` for ${label}` : "";
      console.warn(
        `[RateLimiter] Throttling${labelText}; waiting ${waitMs} ms before next request`
      );
      await sleep(waitMs);
    }
  }
}
