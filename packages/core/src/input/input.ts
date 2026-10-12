import { Vec2 } from '../math/vec2';
import type { CameraView } from '../renderer/cameraView';

/** Mouse button numbers as reported by the browser. */
export const MouseButton = {
  /** The main button, usually the left one. */
  Left: 0,
  /** The wheel button. */
  Middle: 1,
  /** The secondary button, usually the right one. */
  Right: 2,
} as const;

/** The axes `Input.getAxis` knows. */
export type AxisName = 'horizontal' | 'vertical';

const AXIS_KEYS: Readonly<Record<AxisName, { negative: string[]; positive: string[] }>> = {
  horizontal: { negative: ['KeyA', 'ArrowLeft'], positive: ['KeyD', 'ArrowRight'] },
  vertical: { negative: ['KeyS', 'ArrowDown'], positive: ['KeyW', 'ArrowUp'] },
};

/**
 * The raw input state. The host (player or editor) feeds it with events through the
 * `handle*` methods; game code reads it through {@link Input}.
 */
export class InputState {
  readonly keysDown = new Set<string>();
  readonly keysPressed = new Set<string>();
  readonly keysReleased = new Set<string>();
  readonly buttonsDown = new Set<number>();
  readonly buttonsPressed = new Set<number>();
  readonly buttonsReleased = new Set<number>();
  /** Pointer position in CSS pixels relative to the viewport's top-left corner. */
  readonly pointer = new Vec2();
  /** Viewport size in CSS pixels, needed to convert the pointer to world space. */
  readonly viewportSize = new Vec2(1, 1);
  /** Wheel movement accumulated this frame; positive scrolls down. */
  scrollDelta = 0;

  /** @param code A `KeyboardEvent.code` value such as `KeyW`, `Space` or `ArrowLeft`. */
  handleKeyDown(code: string): void {
    // Held keys repeat their keydown event; only the first one counts as a press.
    if (!this.keysDown.has(code)) {
      this.keysDown.add(code);
      this.keysPressed.add(code);
    }
  }

  handleKeyUp(code: string): void {
    if (this.keysDown.delete(code)) {
      this.keysReleased.add(code);
    }
  }

  handlePointerMove(x: number, y: number, viewportWidth: number, viewportHeight: number): void {
    this.pointer.set(x, y);
    this.viewportSize.set(viewportWidth, viewportHeight);
  }

  handlePointerDown(button: number): void {
    if (!this.buttonsDown.has(button)) {
      this.buttonsDown.add(button);
      this.buttonsPressed.add(button);
    }
  }

  handlePointerUp(button: number): void {
    if (this.buttonsDown.delete(button)) {
      this.buttonsReleased.add(button);
    }
  }

  handleWheel(deltaY: number): void {
    this.scrollDelta += deltaY;
  }

  /** Clears the per-frame state. Called by the game at the end of every frame. */
  endFrame(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.buttonsPressed.clear();
    this.buttonsReleased.clear();
    this.scrollDelta = 0;
  }

  /**
   * Releases everything that is held down. Called when the page loses focus, because the
   * matching key-up events will never arrive.
   */
  releaseAll(): void {
    for (const code of [...this.keysDown]) {
      this.handleKeyUp(code);
    }
    for (const button of [...this.buttonsDown]) {
      this.handlePointerUp(button);
    }
  }

  /** Forgets all state without reporting releases. */
  reset(): void {
    this.keysDown.clear();
    this.buttonsDown.clear();
    this.endFrame();
  }
}

/**
 * Keyboard and mouse input as seen by scripts (`this.input`).
 * Keys are identified by their `KeyboardEvent.code`, for example `KeyW`, `Space`, `ArrowLeft`.
 */
export class Input {
  constructor(
    private readonly state: InputState,
    private readonly getCameraView: () => CameraView | null,
  ) {}

  /** True while the key is held down. */
  isKeyDown(code: string): boolean {
    return this.state.keysDown.has(code);
  }

  /** True only during the frame in which the key went down. */
  wasKeyPressed(code: string): boolean {
    return this.state.keysPressed.has(code);
  }

  /** True only during the frame in which the key was let go. */
  wasKeyReleased(code: string): boolean {
    return this.state.keysReleased.has(code);
  }

  /** True while the mouse button is held down. See {@link MouseButton}. */
  isMouseButtonDown(button: number): boolean {
    return this.state.buttonsDown.has(button);
  }

  /** True only during the frame in which the mouse button went down. */
  wasMouseButtonPressed(button: number): boolean {
    return this.state.buttonsPressed.has(button);
  }

  /** True only during the frame in which the mouse button was let go. */
  wasMouseButtonReleased(button: number): boolean {
    return this.state.buttonsReleased.has(button);
  }

  /** Pointer position in pixels from the top-left corner of the game view. */
  get mousePosition(): Vec2 {
    return this.state.pointer.clone();
  }

  /** Pointer position in world space, as seen through the primary camera. */
  get mouseWorldPosition(): Vec2 {
    const view = this.getCameraView();
    const { pointer, viewportSize } = this.state;
    if (!view) {
      return new Vec2();
    }
    return view.viewportToWorld(pointer.x, pointer.y, viewportSize.x, viewportSize.y);
  }

  /** Mouse wheel movement during this frame; positive scrolls down. */
  get scrollDelta(): number {
    return this.state.scrollDelta;
  }

  /**
   * A value from -1 to 1 for a pair of opposing keys.
   * `horizontal` uses A/D and the left/right arrows, `vertical` uses S/W and down/up.
   */
  getAxis(axis: AxisName): number {
    const keys = AXIS_KEYS[axis];
    const negative = keys.negative.some((code) => this.state.keysDown.has(code));
    const positive = keys.positive.some((code) => this.state.keysDown.has(code));
    return (positive ? 1 : 0) - (negative ? 1 : 0);
  }
}
