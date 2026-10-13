import type { EntityId } from '../ecs/registry';
import type { InputState } from '../input/input';
import { Mat3 } from '../math/mat3';
import { Vec2 } from '../math/vec2';
import type { CameraView } from '../renderer/cameraView';
import { Button, ButtonState, SpriteRenderer, TextRenderer } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import type { PointerCallback } from '../scripting/behaviour';

/** The mouse button that presses buttons. A finger on a touch screen reports the same one. */
const PRIMARY_BUTTON = 0;

const SIZE_SCRATCH = new Mat3();

/**
 * The matrix that maps the unit square, centered on the origin, to the area of a button in
 * world space. For a button on the screen that is the place where the camera shows it.
 */
export function getButtonMatrix(entity: Entity, button: Readonly<Button>, out = new Mat3()): Mat3 {
  return entity.scene
    .getWorldMatrix(entity, out)
    .multiply(SIZE_SCRATCH.set(button.size.x, 0, 0, button.size.y, 0, 0));
}

/** The id of the mouse among the pointers. Fingers have the ids the browser gave them. */
const MOUSE_POINTER = -1;

/** What one pointer, the mouse or a finger, is doing with the buttons. */
interface PointerState {
  /** The button the pointer is on. A finger is only ever on the button it is pressing. */
  hovered: EntityId | null;
  /** The button the pointer pressed and has not let go of yet. */
  pressed: EntityId | null;
}

/**
 * Works out which buttons the mouse and the fingers on a touch screen are on, and what they
 * do there, and tells the scripts.
 *
 * Of the buttons under a pointer the one drawn on top gets it: a button on the screen
 * before one in the world, then the higher sorting order of its own sprite or text, then
 * the one created later. A button that is not interactable gets no callbacks, but it still
 * shields the buttons behind it.
 *
 * Every finger can press a button of its own, so two buttons can be held at once. A button
 * that is already held by one pointer ignores the others.
 */
export class ButtonSystem {
  private readonly pointers = new Map<number, PointerState>();
  /** The entities this system gave a {@link ButtonState}. */
  private readonly marked: EntityId[] = [];
  private readonly matrix = new Mat3();
  private readonly pointerWorld = new Vec2();
  private readonly pointerLocal = new Vec2();

  /**
   * @param getCameraView The view the game is drawn through, to find the pointer in the world.
   * @param raise Calls a callback on the scripts of a button's entity.
   */
  constructor(
    private readonly scene: Scene,
    private readonly input: InputState,
    private readonly getCameraView: () => CameraView | null,
    private readonly raise: (entity: Entity, callback: PointerCallback) => void,
  ) {}

  /** Looks at the pointers once. Called every frame, before the scripts are updated. */
  update(): void {
    const { input, pointers } = this;

    // While the pointer is a finger there is no mouse: the finger is handled as a touch
    // below, and would otherwise press every button twice.
    const mousePresent = !input.pointerFromTouch;
    const wasPressed = mousePresent && input.buttonsPressed.has(PRIMARY_BUTTON);
    const mouse = this.pointerOf(MOUSE_POINTER);
    // A press says where the mouse was even if it has left the game again since.
    const onGame = mousePresent && (input.pointerInside || wasPressed);
    this.hover(mouse, onGame ? this.pick(input.pointer.x, input.pointer.y) : null);
    if (wasPressed) {
      this.press(mouse);
    }
    if (input.buttonsReleased.has(PRIMARY_BUTTON)) {
      this.release(mouse, true);
    }

    for (const touch of input.touches.values()) {
      let pointer = pointers.get(touch.id);
      if (touch.began) {
        const target = this.pick(touch.x, touch.y);
        // A finger only gets a button that no other pointer is holding.
        if (target !== null && !this.isPressed(target)) {
          pointer = this.pointerOf(touch.id);
          this.hover(pointer, target);
          this.press(pointer);
        }
      } else if (pointer && pointer.pressed !== null) {
        // A finger that slides off its button stops looking pressed, and can slide back.
        const under = this.pick(touch.x, touch.y);
        this.hover(pointer, under === pointer.pressed ? under : null);
      }
      if (pointer && (touch.ended || pointer.pressed === null)) {
        // A touch that was taken away is let go of, but it has not chosen anything.
        this.release(pointer, !touch.cancelled);
        this.hover(pointer, null);
        pointers.delete(touch.id);
      }
    }

    for (const [id, pointer] of pointers) {
      // A button that was destroyed or disabled while held down is no longer being pressed.
      if (pointer.pressed !== null && !this.isUsable(pointer.pressed)) {
        pointer.pressed = null;
      }
      // A finger the input has forgotten, as when the page lost the focus, is gone.
      if (id !== MOUSE_POINTER && !input.touches.has(id)) {
        pointers.delete(id);
      }
    }
    this.markStates();
  }

  /** Forgets what the pointers were doing. Called when the scene stops. */
  stop(): void {
    this.pointers.clear();
    this.markStates();
  }

  private pointerOf(id: number): PointerState {
    let pointer = this.pointers.get(id);
    if (!pointer) {
      pointer = { hovered: null, pressed: null };
      this.pointers.set(id, pointer);
    }
    return pointer;
  }

  /** Moves a pointer onto a button, or off every button, and tells those it leaves and enters. */
  private hover(pointer: PointerState, target: EntityId | null): void {
    if (target === pointer.hovered) {
      return;
    }
    const left = pointer.hovered;
    pointer.hovered = target;
    if (left !== null) {
      this.send(left, 'onPointerExit');
    }
    if (target !== null) {
      this.send(target, 'onPointerEnter');
    }
  }

  /** Presses the button a pointer is on, unless another pointer is holding it already. */
  private press(pointer: PointerState): void {
    const target = pointer.hovered;
    if (target === null || this.isPressed(target)) {
      return;
    }
    pointer.pressed = target;
    this.send(target, 'onPointerDown');
  }

  /**
   * Lets go of the button a pointer holds. With `deliberate` it was clicked if the pointer
   * is still on it.
   */
  private release(pointer: PointerState, deliberate: boolean): void {
    const released = pointer.pressed;
    if (released === null) {
      return;
    }
    pointer.pressed = null;
    if (this.isUsable(released)) {
      this.send(released, 'onPointerUp');
      if (deliberate && released === pointer.hovered) {
        this.send(released, 'onClick');
      }
    }
  }

  private isPressed(id: EntityId): boolean {
    for (const pointer of this.pointers.values()) {
      if (pointer.pressed === id) {
        return true;
      }
    }
    return false;
  }

  private isHovered(id: EntityId): boolean {
    for (const pointer of this.pointers.values()) {
      if (pointer.hovered === id) {
        return true;
      }
    }
    return false;
  }

  /** The interactable button at a place in the viewport that is drawn on top, if there is one. */
  private pick(x: number, y: number): EntityId | null {
    const { scene, input } = this;
    // Most games in most frames have no button at all, and then the view is not needed.
    if (scene.registry.count(Button) === 0) {
      return null;
    }
    const view = this.getCameraView();
    if (!view) {
      return null;
    }
    const { viewportSize } = input;
    view.viewportToWorld(x, y, viewportSize.x, viewportSize.y, this.pointerWorld);

    let best: EntityId | null = null;
    let bestIsInteractable = false;
    let bestLayer = -1;
    let bestOrder = -Infinity;
    for (const [id, button] of scene.registry.view(Button)) {
      const entity = scene.getEntity(id);
      if (!entity.activeInHierarchy || !getButtonMatrix(entity, button, this.matrix).invert()) {
        continue;
      }
      const local = this.matrix.transformPoint(this.pointerWorld, this.pointerLocal);
      if (Math.abs(local.x) > 0.5 || Math.abs(local.y) > 0.5) {
        continue;
      }
      const layer = scene.isOnScreen(entity) ? 1 : 0;
      const order = this.getSortingOrder(id);
      // Later buttons are drawn over earlier ones with the same order, hence ">=".
      if (layer > bestLayer || (layer === bestLayer && order >= bestOrder)) {
        best = id;
        bestIsInteractable = button.interactable;
        bestLayer = layer;
        bestOrder = order;
      }
    }
    return bestIsInteractable ? best : null;
  }

  /** The sorting order a button is drawn with: that of its own sprite or text, else 0. */
  private getSortingOrder(id: EntityId): number {
    const { registry } = this.scene;
    const sprite = registry.get(id, SpriteRenderer)?.sortingOrder;
    const text = registry.get(id, TextRenderer)?.sortingOrder;
    if (sprite === undefined) {
      return text ?? 0;
    }
    return text === undefined ? sprite : Math.max(sprite, text);
  }

  /** True while the entity exists and has an active button that can be pressed. */
  private isUsable(id: EntityId): boolean {
    const { scene } = this;
    return (
      scene.registry.isAlive(id) &&
      scene.registry.get(id, Button)?.interactable === true &&
      scene.getEntity(id).activeInHierarchy
    );
  }

  private send(id: EntityId, callback: PointerCallback): void {
    // A callback may have destroyed the entity that the next one would go to.
    if (this.scene.registry.isAlive(id)) {
      this.raise(this.scene.getEntity(id), callback);
    }
  }

  /** Writes what the pointers are doing into the scene, where the renderer reads it. */
  private markStates(): void {
    const { registry } = this.scene;
    const { marked } = this;
    for (let index = marked.length - 1; index >= 0; index--) {
      const id = marked[index]!;
      if (!this.isHovered(id) && !this.isPressed(id)) {
        registry.remove(id, ButtonState);
        marked.splice(index, 1);
      }
    }
    for (const pointer of this.pointers.values()) {
      this.mark(pointer.hovered);
      this.mark(pointer.pressed);
    }
  }

  private mark(id: EntityId | null): void {
    const { registry } = this.scene;
    if (id === null || !registry.isAlive(id)) {
      return;
    }
    let state = registry.get(id, ButtonState);
    if (!state) {
      state = registry.add(id, ButtonState, new ButtonState());
      this.marked.push(id);
    }
    state.hovered = this.isHovered(id);
    state.pressed = this.isPressed(id);
  }
}
