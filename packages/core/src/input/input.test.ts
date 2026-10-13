// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Vec2 } from '../math/vec2';
import { CameraView } from '../renderer/cameraView';
import { attachDomInput } from './domInput';
import { Input, InputState, MouseButton } from './input';

function createInput(view: CameraView | null = null): { state: InputState; input: Input } {
  const state = new InputState();
  return { state, input: new Input(state, () => view) };
}

describe('Input keyboard', () => {
  it('distinguishes held, pressed and released keys', () => {
    const { state, input } = createInput();
    state.handleKeyDown('Space');
    expect(input.isKeyDown('Space')).toBe(true);
    expect(input.wasKeyPressed('Space')).toBe(true);
    expect(input.wasKeyReleased('Space')).toBe(false);

    state.endFrame();
    expect(input.isKeyDown('Space')).toBe(true);
    expect(input.wasKeyPressed('Space')).toBe(false);

    state.handleKeyUp('Space');
    expect(input.isKeyDown('Space')).toBe(false);
    expect(input.wasKeyReleased('Space')).toBe(true);
    state.endFrame();
    expect(input.wasKeyReleased('Space')).toBe(false);
  });

  it('ignores key repeat and releases of keys that were not down', () => {
    const { state, input } = createInput();
    state.handleKeyDown('KeyA');
    state.endFrame();
    state.handleKeyDown('KeyA');
    expect(input.wasKeyPressed('KeyA')).toBe(false);
    state.handleKeyUp('KeyB');
    expect(input.wasKeyReleased('KeyB')).toBe(false);
  });

  it('combines opposing keys into axes', () => {
    const { state, input } = createInput();
    expect(input.getAxis('horizontal')).toBe(0);
    state.handleKeyDown('KeyD');
    expect(input.getAxis('horizontal')).toBe(1);
    state.handleKeyDown('ArrowLeft');
    expect(input.getAxis('horizontal')).toBe(0);
    state.handleKeyUp('KeyD');
    expect(input.getAxis('horizontal')).toBe(-1);
    state.handleKeyDown('ArrowUp');
    expect(input.getAxis('vertical')).toBe(1);
    state.handleKeyUp('ArrowUp');
    state.handleKeyDown('KeyS');
    expect(input.getAxis('vertical')).toBe(-1);
  });
});

describe('Input mouse', () => {
  it('tracks buttons like keys', () => {
    const { state, input } = createInput();
    state.handlePointerDown(MouseButton.Left);
    state.handlePointerDown(MouseButton.Left);
    expect(input.isMouseButtonDown(MouseButton.Left)).toBe(true);
    expect(input.wasMouseButtonPressed(MouseButton.Left)).toBe(true);
    expect(input.isMouseButtonDown(MouseButton.Right)).toBe(false);
    state.endFrame();
    expect(input.wasMouseButtonPressed(MouseButton.Left)).toBe(false);
    state.handlePointerUp(MouseButton.Left);
    state.handlePointerUp(MouseButton.Middle);
    expect(input.wasMouseButtonReleased(MouseButton.Left)).toBe(true);
    expect(input.wasMouseButtonReleased(MouseButton.Middle)).toBe(false);
  });

  it('reports the pointer in viewport pixels and in world space', () => {
    const view = new CameraView(new Vec2(10, 0), 0, 5, 2);
    const { state, input } = createInput(view);
    state.handlePointerMove(150, 25, 200, 100);
    expect(input.mousePosition.toArray()).toEqual([150, 25]);
    expect(input.mouseWorldPosition.equals(new Vec2(15, 2.5))).toBe(true);

    input.mousePosition.x = 999;
    expect(input.mousePosition.x).toBe(150);
  });

  it('knows whether the pointer is over the game', () => {
    const { state } = createInput();
    expect(state.pointerInside).toBe(false);
    state.handlePointerMove(150, 25, 200, 100);
    expect(state.pointerInside).toBe(true);
    state.handlePointerLeave();
    expect(state.pointerInside).toBe(false);
    // Where it was last seen is kept.
    expect(state.pointer.toArray()).toEqual([150, 25]);
    state.handlePointerMove(10, 10, 200, 100);
    state.reset();
    expect(state.pointerInside).toBe(false);
  });

  it('lists the fingers on a touch screen, with where they are on the screen and in the world', () => {
    const view = new CameraView(new Vec2(10, 0), 0, 5, 2);
    const { state, input } = createInput(view);
    expect(input.touches).toEqual([]);
    expect(input.touchCount).toBe(0);

    state.handleTouchStart(7, 150, 25, 200, 100);
    state.handleTouchStart(9, 50, 50, 200, 100);
    expect(input.touchCount).toBe(2);
    const [first, second] = input.touches;
    expect(first).toMatchObject({ id: 7, began: true, ended: false });
    expect(first!.position.toArray()).toEqual([150, 25]);
    expect(first!.worldPosition.equals(new Vec2(15, 2.5))).toBe(true);
    expect(second!.id).toBe(9);
    // Every call describes the frame anew, so changing what it returned changes nothing.
    first!.position.x = 999;
    expect(input.touches[0]!.position.x).toBe(150);
  });

  it('follows a finger from the frame it comes down to the frame it is lifted', () => {
    const { state, input } = createInput();
    state.handleTouchStart(3, 10, 10, 200, 100);
    expect(input.touches[0]).toMatchObject({ began: true, ended: false });
    state.endFrame();

    state.handleTouchMove(3, 40, 20);
    expect(input.touches[0]).toMatchObject({ began: false, ended: false });
    expect(input.touches[0]!.position.toArray()).toEqual([40, 20]);
    state.endFrame();

    state.handleTouchEnd(3);
    // Lifted fingers are listed for one more frame, and no longer counted.
    expect(input.touches[0]).toMatchObject({ began: false, ended: true });
    expect(input.touchCount).toBe(0);
    state.endFrame();
    expect(input.touches).toEqual([]);
  });

  it('reports a tap that began and ended within one frame as both', () => {
    const { state, input } = createInput();
    state.handleTouchStart(1, 10, 10, 200, 100);
    state.handleTouchEnd(1);
    expect(input.touches[0]).toMatchObject({ began: true, ended: true });
    state.endFrame();
    expect(input.touches).toEqual([]);
  });

  it('ignores movement and lifting of fingers it has not seen come down', () => {
    const { state, input } = createInput();
    state.handleTouchMove(5, 10, 10);
    state.handleTouchEnd(5);
    expect(input.touches).toEqual([]);
  });

  it('lifts every finger when the page loses the focus, and forgets them on a reset', () => {
    const { state, input } = createInput();
    state.handleTouchStart(1, 10, 10, 200, 100);
    state.handleTouchStart(2, 20, 20, 200, 100);
    state.releaseAll();
    expect(input.touches.map((touch) => touch.ended)).toEqual([true, true]);

    state.handleTouchStart(3, 30, 30, 200, 100);
    state.handlePointerMove(30, 30, 200, 100, true);
    state.reset();
    expect(input.touches).toEqual([]);
    expect(state.pointerFromTouch).toBe(false);
  });

  it('reports the origin as world position when there is no camera', () => {
    const { state, input } = createInput(null);
    state.handlePointerMove(150, 25, 200, 100);
    expect(input.mouseWorldPosition.toArray()).toEqual([0, 0]);
  });

  it('accumulates wheel movement for one frame', () => {
    const { state, input } = createInput();
    state.handleWheel(30);
    state.handleWheel(-10);
    expect(input.scrollDelta).toBe(20);
    state.endFrame();
    expect(input.scrollDelta).toBe(0);
  });
});

describe('InputState', () => {
  it('releases everything that is held, reporting the releases', () => {
    const { state, input } = createInput();
    state.handleKeyDown('KeyW');
    state.handlePointerDown(0);
    state.endFrame();
    state.releaseAll();
    expect(input.isKeyDown('KeyW')).toBe(false);
    expect(input.wasKeyReleased('KeyW')).toBe(true);
    expect(input.wasMouseButtonReleased(0)).toBe(true);
  });

  it('resets without reporting releases', () => {
    const { state, input } = createInput();
    state.handleKeyDown('KeyW');
    state.handlePointerDown(0);
    state.reset();
    expect(input.isKeyDown('KeyW')).toBe(false);
    expect(input.wasKeyReleased('KeyW')).toBe(false);
    expect(input.isMouseButtonDown(0)).toBe(false);
  });
});

describe('attachDomInput', () => {
  function setup(): { state: InputState; viewport: HTMLElement; detach: () => void } {
    const viewport = document.createElement('div');
    document.body.append(viewport);
    viewport.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 400, height: 200 }) as DOMRect;
    const state = new InputState();
    return { state, viewport, detach: attachDomInput(state, viewport) };
  }

  it('feeds keyboard events into the state', () => {
    const { state, detach } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    expect(state.keysDown.has('KeyW')).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
    expect(state.keysDown.has('KeyW')).toBe(false);
    detach();
  });

  it('stops the page from scrolling on game keys only', () => {
    const { detach } = setup();
    const space = new KeyboardEvent('keydown', { code: 'Space', cancelable: true });
    const letter = new KeyboardEvent('keydown', { code: 'KeyA', cancelable: true });
    window.dispatchEvent(space);
    window.dispatchEvent(letter);
    expect(space.defaultPrevented).toBe(true);
    expect(letter.defaultPrevented).toBe(false);
    detach();
  });

  it('leaves keys alone while the user types in a form field', () => {
    const { state, detach } = setup();
    const field = document.createElement('input');
    document.body.append(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    expect(state.keysDown.size).toBe(0);
    detach();
  });

  it('reports pointer positions relative to the viewport', () => {
    const { state, viewport, detach } = setup();
    viewport.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 150 }));
    expect(state.pointer.toArray()).toEqual([200, 100]);
    expect(state.viewportSize.toArray()).toEqual([400, 200]);

    viewport.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 110, clientY: 60, button: 2 }),
    );
    expect(state.pointer.toArray()).toEqual([10, 10]);
    expect(state.buttonsDown.has(2)).toBe(true);
    window.dispatchEvent(new PointerEvent('pointerup', { button: 2 }));
    expect(state.buttonsDown.has(2)).toBe(false);
    detach();
  });

  it('notices the pointer leaving the viewport, which is also what lifting a finger does', () => {
    const { state, viewport, detach } = setup();
    viewport.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 150 }));
    expect(state.pointerInside).toBe(true);
    viewport.dispatchEvent(new PointerEvent('pointerleave'));
    expect(state.pointerInside).toBe(false);
    viewport.dispatchEvent(new PointerEvent('pointerdown', { clientX: 110, clientY: 60 }));
    expect(state.pointerInside).toBe(true);
    detach();
    viewport.dispatchEvent(new PointerEvent('pointerleave'));
    expect(state.pointerInside).toBe(true);
  });

  it('reports fingers as touches, and lets the first one drive the pointer as well', () => {
    const { state, viewport, detach } = setup();
    const touch = (
      type: string,
      id: number,
      x: number,
      y: number,
      isPrimary: boolean,
    ): PointerEvent =>
      new PointerEvent(type, {
        pointerType: 'touch',
        pointerId: id,
        clientX: x,
        clientY: y,
        isPrimary,
        button: 0,
        bubbles: true,
      });

    viewport.dispatchEvent(touch('pointerdown', 11, 150, 80, true));
    expect([...state.touches.values()]).toEqual([
      { id: 11, x: 50, y: 30, began: true, ended: false, cancelled: false },
    ]);
    // The first finger is also the mouse, for games that only know the mouse.
    expect(state.pointer.toArray()).toEqual([50, 30]);
    expect(state.buttonsDown.has(0)).toBe(true);
    expect(state.pointerFromTouch).toBe(true);

    // A second finger is a touch and nothing else: it does not move or release the "mouse".
    viewport.dispatchEvent(touch('pointerdown', 12, 300, 150, false));
    viewport.dispatchEvent(touch('pointermove', 12, 310, 160, false));
    expect(state.touches.get(12)).toMatchObject({ x: 210, y: 110 });
    expect(state.pointer.toArray()).toEqual([50, 30]);
    window.dispatchEvent(touch('pointerup', 12, 310, 160, false));
    expect(state.touches.get(12)).toMatchObject({ ended: true, cancelled: false });
    expect(state.buttonsDown.has(0)).toBe(true);

    // A touch the system takes away has ended, and so has the press of the first finger.
    window.dispatchEvent(touch('pointercancel', 11, 150, 80, true));
    expect(state.touches.get(11)).toMatchObject({ ended: true, cancelled: true });
    expect(state.buttonsDown.has(0)).toBe(false);

    // Moving the mouse afterwards makes the pointer a mouse again.
    viewport.dispatchEvent(new PointerEvent('pointermove', { clientX: 120, clientY: 70 }));
    expect(state.pointerFromTouch).toBe(false);
    detach();
  });

  it('captures the wheel and suppresses the context menu', () => {
    const { state, viewport, detach } = setup();
    const wheel = new WheelEvent('wheel', { deltaY: 40, cancelable: true });
    const menu = new MouseEvent('contextmenu', { cancelable: true });
    viewport.dispatchEvent(wheel);
    viewport.dispatchEvent(menu);
    expect(state.scrollDelta).toBe(40);
    expect(wheel.defaultPrevented).toBe(true);
    expect(menu.defaultPrevented).toBe(true);
    detach();
  });

  it('releases held input when the window loses focus', () => {
    const { state, detach } = setup();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new Event('blur'));
    expect(state.keysDown.size).toBe(0);
    expect(state.keysReleased.has('KeyW')).toBe(true);
    detach();
  });

  it('stops listening once detached', () => {
    const { state, viewport, detach } = setup();
    detach();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    viewport.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
    expect(state.keysDown.size).toBe(0);
    expect(state.buttonsDown.size).toBe(0);
  });
});
