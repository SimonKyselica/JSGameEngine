/** Edits with the same key that follow each other this quickly become one undo step. */
const COALESCE_WINDOW_MS = 800;

/**
 * An undo/redo stack of state snapshots.
 *
 * Callers record the state as it was *before* a change. Undo and redo exchange the
 * current state for a recorded one, so nothing has to describe how to reverse an edit.
 */
export class History<T> {
  private readonly undoStack: T[] = [];
  private readonly redoStack: T[] = [];
  private lastKey: string | null = null;
  private lastTime = 0;

  constructor(
    private readonly limit = 100,
    private readonly now: () => number = () => performance.now(),
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Records the state before a change.
   *
   * @param coalesceKey Identifies a continuous edit, such as typing in one field. Quick
   * successive records with the same key are merged into the first one.
   */
  record(before: T, coalesceKey?: string): void {
    const time = this.now();
    const continues =
      coalesceKey !== undefined &&
      coalesceKey === this.lastKey &&
      time - this.lastTime < COALESCE_WINDOW_MS &&
      this.undoStack.length > 0;
    this.lastKey = coalesceKey ?? null;
    this.lastTime = time;
    this.redoStack.length = 0;
    if (continues) {
      return;
    }
    this.undoStack.push(before);
    if (this.undoStack.length > this.limit) {
      this.undoStack.shift();
    }
  }

  /** Returns the state to go back to, or `undefined` when there is nothing to undo. */
  undo(current: T): T | undefined {
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return undefined;
    }
    this.redoStack.push(current);
    this.lastKey = null;
    return previous;
  }

  /** Returns the state to go forward to, or `undefined` when there is nothing to redo. */
  redo(current: T): T | undefined {
    const next = this.redoStack.pop();
    if (next === undefined) {
      return undefined;
    }
    this.undoStack.push(current);
    this.lastKey = null;
    return next;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.lastKey = null;
  }
}
