/** Schedules animation frames. Replaceable so the loop can be driven by hand in tests. */
export interface FrameScheduler {
  requestFrame(callback: (timeMs: number) => void): number;
  cancelFrame(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/**
 * Calls a function once per animation frame with the time since the previous frame.
 * The first frame after a start reports zero, so pauses never produce a time jump.
 */
export class GameLoop {
  private handle: number | null = null;
  private lastTime: number | null = null;

  constructor(
    private readonly onFrame: (deltaSeconds: number) => void,
    private readonly scheduler: FrameScheduler = browserScheduler,
  ) {}

  get isRunning(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) {
      return;
    }
    this.lastTime = null;
    this.handle = this.scheduler.requestFrame(this.frame);
  }

  stop(): void {
    if (this.handle !== null) {
      this.scheduler.cancelFrame(this.handle);
      this.handle = null;
    }
  }

  private readonly frame = (timeMs: number): void => {
    const deltaSeconds = this.lastTime === null ? 0 : (timeMs - this.lastTime) / 1000;
    this.lastTime = timeMs;
    // Schedule first: the callback may stop the loop, and that must cancel this request.
    this.handle = this.scheduler.requestFrame(this.frame);
    this.onFrame(Math.max(deltaSeconds, 0));
  };
}
