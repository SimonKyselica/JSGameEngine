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

/** One finger on a touch screen, as the host reported it. */
export interface TouchState {
  readonly id: number;
  /** Position in CSS pixels relative to the viewport's top-left corner. */
  x: number;
  y: number;
  /** True during the frame in which the finger touched down. */
  began: boolean;
  /** True during the frame in which the finger was lifted, after which the touch is gone. */
  ended: boolean;
  /**
   * True when the touch ended without the finger being lifted on purpose: the system took
   * it for a gesture of its own, or the page lost the focus. Such a touch chooses nothing.
   */
  cancelled: boolean;
}

/** A finger on the screen, as scripts see it in `Input.touches`. */
export interface TouchPoint {
  /** A number that stays the same for as long as this finger is down. */
  readonly id: number;
  /** Where the finger is, in pixels from the top-left corner of the game view. */
  readonly position: Vec2;
  /** Where the finger is in world space, as seen through the primary camera. */
  readonly worldPosition: Vec2;
  /** True only during the frame in which the finger touched the screen. */
  readonly began: boolean;
  /**
   * True only during the frame in which the finger was lifted. It is the last frame the
   * touch is listed in. A quick tap can begin and end in the same frame.
   */
  readonly ended: boolean;
}

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
  /**
   * False until the pointer has been seen over the viewport, and again after it has left.
   * A finger leaves when it is lifted, so on a touch screen nothing stays hovered.
   */
  pointerInside = false;
  /**
   * True while the pointer is a finger. The first finger on the screen moves the pointer
   * and presses the left button, so that a game written for the mouse works on a phone.
   */
  pointerFromTouch = false;
  /** The fingers on the screen, by their id, in the order they came down. */
  readonly touches = new Map<number, TouchState>();
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

  /** @param fromTouch True when the pointer that moved is a finger rather than a mouse. */
  handlePointerMove(
    x: number,
    y: number,
    viewportWidth: number,
    viewportHeight: number,
    fromTouch = false,
  ): void {
    this.pointer.set(x, y);
    this.viewportSize.set(viewportWidth, viewportHeight);
    this.pointerInside = true;
    this.pointerFromTouch = fromTouch;
  }

  /** A finger touched the viewport at a position in CSS pixels. */
  handleTouchStart(
    id: number,
    x: number,
    y: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    this.viewportSize.set(viewportWidth, viewportHeight);
    this.touches.set(id, { id, x, y, began: true, ended: false, cancelled: false });
  }

  /** A finger that is down moved. Fingers the state does not know are ignored. */
  handleTouchMove(id: number, x: number, y: number): void {
    const touch = this.touches.get(id);
    if (touch && !touch.ended) {
      touch.x = x;
      touch.y = y;
    }
  }

  /** A finger was lifted. */
  handleTouchEnd(id: number): void {
    const touch = this.touches.get(id);
    if (touch) {
      touch.ended = true;
    }
  }

  /** The system took a touch away. It ends like a lifted finger, but it is not a tap. */
  handleTouchCancel(id: number): void {
    const touch = this.touches.get(id);
    if (touch) {
      touch.ended = true;
      touch.cancelled = true;
    }
  }

  /** The pointer left the viewport. Its last position is kept. */
  handlePointerLeave(): void {
    this.pointerInside = false;
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
    for (const touch of this.touches.values()) {
      touch.began = false;
      if (touch.ended) {
        this.touches.delete(touch.id);
      }
    }
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
    for (const touch of this.touches.values()) {
      touch.ended = true;
      touch.cancelled = true;
    }
  }

  /** Forgets all state without reporting releases. */
  reset(): void {
    this.keysDown.clear();
    this.buttonsDown.clear();
    this.pointerInside = false;
    this.pointerFromTouch = false;
    this.touches.clear();
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
   * The fingers on a touch screen, in the order they came down. Each call returns new
   * objects that describe this frame. The list is empty on a device without a touch screen:
   * the mouse is not a touch.
   *
   * The first finger also moves the mouse pointer and presses the left mouse button, so a
   * game written for the mouse works on a phone without touches.
   */
  get touches(): TouchPoint[] {
    const view = this.getCameraView();
    const { viewportSize } = this.state;
    const result: TouchPoint[] = [];
    for (const touch of this.state.touches.values()) {
      result.push({
        id: touch.id,
        position: new Vec2(touch.x, touch.y),
        worldPosition: view
          ? view.viewportToWorld(touch.x, touch.y, viewportSize.x, viewportSize.y)
          : new Vec2(),
        began: touch.began,
        ended: touch.ended,
      });
    }
    return result;
  }

  /** How many fingers are on the screen now, not counting those lifted in this frame. */
  get touchCount(): number {
    let count = 0;
    for (const touch of this.state.touches.values()) {
      if (!touch.ended) {
        count++;
      }
    }
    return count;
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
