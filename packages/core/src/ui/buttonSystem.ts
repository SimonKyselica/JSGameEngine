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

/**
 * Works out which button the pointer is on and what it does there, and tells the scripts.
 *
 * Of the buttons under the pointer the one drawn on top gets it: a button on the screen
 * before one in the world, then the higher sorting order of its own sprite or text, then
 * the one created later. A button that is not interactable gets no callbacks, but it still
 * shields the buttons behind it.
 */
export class ButtonSystem {
  private hovered: EntityId | null = null;
  private pressed: EntityId | null = null;
  /** The entities this system gave a {@link ButtonState}. There are never more than two. */
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

  /** Looks at the pointer once. Called every frame, before the scripts are updated. */
  update(): void {
    const { input } = this;
    const wasPressed = input.buttonsPressed.has(PRIMARY_BUTTON);
    const wasReleased = input.buttonsReleased.has(PRIMARY_BUTTON);
    // A finger can touch, lift and so leave between two frames. The press says where it was.
    const target = input.pointerInside || wasPressed ? this.pick() : null;

    if (target !== this.hovered) {
      const left = this.hovered;
      this.hovered = target;
      if (left !== null) {
        this.send(left, 'onPointerExit');
      }
      if (target !== null) {
        this.send(target, 'onPointerEnter');
      }
    }
    if (wasPressed && this.hovered !== null) {
      this.pressed = this.hovered;
      this.send(this.pressed, 'onPointerDown');
    }
    if (wasReleased && this.pressed !== null) {
      const released = this.pressed;
      this.pressed = null;
      if (this.isUsable(released)) {
        this.send(released, 'onPointerUp');
        if (released === this.hovered) {
          this.send(released, 'onClick');
        }
      }
    }
    // A button that was destroyed or disabled while held down is no longer being pressed.
    if (this.pressed !== null && !this.isUsable(this.pressed)) {
      this.pressed = null;
    }
    this.markStates();
  }

  /** Forgets what the pointer was doing. Called when the scene stops. */
  stop(): void {
    this.hovered = null;
    this.pressed = null;
    this.markStates();
  }

  /** The interactable button under the pointer that is drawn on top, if there is one. */
  private pick(): EntityId | null {
    const { scene, input } = this;
    // Most games in most frames have no button at all, and then the view is not needed.
    if (scene.registry.count(Button) === 0) {
      return null;
    }
    const view = this.getCameraView();
    if (!view) {
      return null;
    }
    const { pointer, viewportSize } = input;
    view.viewportToWorld(pointer.x, pointer.y, viewportSize.x, viewportSize.y, this.pointerWorld);

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

  /** Writes what the pointer is doing into the scene, where the renderer reads it. */
  private markStates(): void {
    const { registry } = this.scene;
    const { marked, hovered, pressed } = this;
    for (let index = marked.length - 1; index >= 0; index--) {
      const id = marked[index]!;
      if (id !== hovered && id !== pressed) {
        registry.remove(id, ButtonState);
        marked.splice(index, 1);
      }
    }
    this.mark(hovered);
    this.mark(pressed);
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
    state.hovered = id === this.hovered;
    state.pressed = id === this.pressed;
  }
}
