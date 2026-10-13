import { describe, expect, it } from 'vitest';
import type { AssetDatabase } from '../assets/assetDatabase';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import {
  Button,
  ButtonState,
  Camera,
  ScreenAnchor,
  SpriteRenderer,
  TextRenderer,
} from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import {
  addScript,
  attachScript,
  createTestProject,
  startTestGame,
  type RunningGame,
} from '../testing/fixtures';
import { getButtonMatrix } from './buttonSystem';

/** Logs every pointer callback of its entity as "name:callback". */
const REPORTER = `
  import { Behaviour } from 'rowan';
  export default class Reporter extends Behaviour {
    onPointerEnter() { this.log(this.entity.name + ':enter'); }
    onPointerExit() { this.log(this.entity.name + ':exit'); }
    onPointerDown() { this.log(this.entity.name + ':down'); }
    onPointerUp() { this.log(this.entity.name + ':up'); }
    onClick() { this.log(this.entity.name + ':click'); }
  }`;

/**
 * The games in these tests are 1280x720 pixels and look at the origin through a camera
 * that shows 10 world units from top to bottom: 72 pixels per unit.
 */
const PIXELS_PER_UNIT = 72;

interface ButtonGame extends RunningGame {
  scene: Scene;
  /** Moves the pointer to a place in the world, as the camera at the origin shows it. */
  pointAt(x: number, y: number): void;
  /** Moves the pointer to a place on the screen, in pixels from its center with Y up. */
  pointAtPixel(x: number, y: number): void;
  press(): void;
  release(): void;
  /** Puts a finger down at a place in the world, moves it there, or lifts it. */
  touch(id: number, x: number, y: number): void;
  slide(id: number, x: number, y: number): void;
  lift(id: number): void;
  /** Runs one frame and returns what was logged during it. */
  frame(): string[];
}

/** Starts a game with a camera and whatever `build` adds. `addButton` makes a reporting button. */
async function startButtonGame(
  build: (
    scene: Scene,
    addButton: (name: string, x: number, y: number, size?: [number, number]) => Entity,
    assets: AssetDatabase,
  ) => void,
): Promise<ButtonGame> {
  const project = createTestProject((scene, { assets }) => {
    scene.createEntity('Camera').addComponent(Camera, { orthographicSize: 5 });
    const reporter = addScript(assets, 'Reporter.ts', REPORTER);
    const addButton = (name: string, x: number, y: number, size = [2, 1]): Entity => {
      const entity = scene.createEntity(name);
      entity.transform.position.set(x, y);
      entity.addComponent(Button, { size: new Vec2(size[0], size[1]) });
      attachScript(entity, reporter);
      return entity;
    };
    build(scene, addButton, assets);
  });
  const game = await startTestGame(project);
  const { input } = game.game;
  let seen = game.messages().length;
  return {
    ...game,
    scene: game.game.scene,
    pointAt: (x, y) =>
      input.handlePointerMove(640 + x * PIXELS_PER_UNIT, 360 - y * PIXELS_PER_UNIT, 1280, 720),
    pointAtPixel: (x, y) => input.handlePointerMove(640 + x, 360 - y, 1280, 720),
    press: () => input.handlePointerDown(0),
    release: () => input.handlePointerUp(0),
    touch: (id, x, y) =>
      input.handleTouchStart(id, 640 + x * PIXELS_PER_UNIT, 360 - y * PIXELS_PER_UNIT, 1280, 720),
    slide: (id, x, y) =>
      input.handleTouchMove(id, 640 + x * PIXELS_PER_UNIT, 360 - y * PIXELS_PER_UNIT),
    lift: (id) => input.handleTouchEnd(id),
    frame() {
      game.step();
      const messages = game.messages().slice(seen);
      seen += messages.length;
      return messages;
    },
  };
}

describe('ButtonSystem', () => {
  it('tells the scripts when the pointer moves onto a button and off it again', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    // Until the pointer has been seen, it is not on anything.
    expect(game.frame()).toEqual([]);

    game.pointAt(2.9, 1.4);
    expect(game.frame()).toEqual(['Play:enter']);
    expect(game.frame()).toEqual([]);
    game.pointAt(3.1, 1.4);
    expect(game.frame()).toEqual(['Play:exit']);
    game.pointAt(2, 1.6);
    expect(game.frame()).toEqual([]);
  });

  it('reports a press, its release and the click, in that order', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    game.pointAt(2, 1);
    game.press();
    expect(game.frame()).toEqual(['Play:enter', 'Play:down']);
    expect(game.frame()).toEqual([]);
    game.release();
    expect(game.frame()).toEqual(['Play:up', 'Play:click']);
  });

  it('does not click when the press ends somewhere else', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    game.pointAt(2, 1);
    game.press();
    game.frame();
    game.pointAt(-4, -4);
    expect(game.frame()).toEqual(['Play:exit']);
    game.release();
    // The button is told that it was let go, but nothing was chosen.
    expect(game.frame()).toEqual(['Play:up']);
  });

  it('does not click when the press began somewhere else', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    game.pointAt(-4, -4);
    game.press();
    game.frame();
    game.pointAt(2, 1);
    expect(game.frame()).toEqual(['Play:enter']);
    game.release();
    expect(game.frame()).toEqual([]);
  });

  it('counts a tap that begins and ends between two frames', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    // A finger touches, lifts and so leaves before the game looks at the pointer again.
    game.pointAt(2, 1);
    game.press();
    game.release();
    game.game.input.handlePointerLeave();
    expect(game.frame()).toEqual(['Play:enter', 'Play:down', 'Play:up', 'Play:click']);
    expect(game.frame()).toEqual(['Play:exit']);
  });

  it('lets go of a button when the pointer leaves the game', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    game.pointAt(2, 1);
    game.frame();
    game.game.input.handlePointerLeave();
    expect(game.frame()).toEqual(['Play:exit']);
  });

  it('reacts to the left mouse button only', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    game.pointAt(2, 1);
    game.frame();
    for (const button of [1, 2]) {
      game.game.input.handlePointerDown(button);
      expect(game.frame()).toEqual([]);
      game.game.input.handlePointerUp(button);
      expect(game.frame()).toEqual([]);
    }
  });

  it('gives the pointer to the button that is drawn on top', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      addButton('Low', 0, 0).addComponent(SpriteRenderer, { sortingOrder: 1 });
      addButton('High', 0, 0).addComponent(TextRenderer, { sortingOrder: 5 });
      addButton('Middle', 0, 0).addComponent(SpriteRenderer, { sortingOrder: 3 });
    });
    game.pointAt(0, 0);
    expect(game.frame()).toEqual(['High:enter']);

    // With the same order, the one created later is drawn later, so it is on top.
    game.scene.findByName('High')!.requireComponent(TextRenderer).sortingOrder = 3;
    expect(game.frame()).toEqual(['High:exit', 'Middle:enter']);
    game.scene.findByName('Middle')!.active = false;
    expect(game.frame()).toEqual(['High:enter']);
  });

  it('puts a button on the screen before any button in the world', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      addButton('Hud', 0, 0, [200, 100]).addComponent(ScreenAnchor);
      addButton('World', 0, 0).addComponent(SpriteRenderer, { sortingOrder: 100 });
    });
    game.pointAt(0, 0);
    expect(game.frame()).toEqual(['Hud:enter']);
  });

  it('gives a disabled button nothing, but lets it shield the buttons behind it', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      addButton('Behind', 0, 0, [4, 4]);
      addButton('Disabled', 0, 0).requireComponent(Button).interactable = false;
    });
    game.pointAt(0, 0);
    game.press();
    expect(game.frame()).toEqual([]);
    game.release();
    // Beside the disabled button, the one behind it is reachable.
    game.pointAt(0, 1.5);
    expect(game.frame()).toEqual(['Behind:enter']);
  });

  it('leaves a button that stops being interactable under the pointer', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Play', 2, 1));
    game.pointAt(2, 1);
    game.press();
    game.frame();
    game.scene.findByName('Play')!.requireComponent(Button).interactable = false;
    expect(game.frame()).toEqual(['Play:exit']);
    // The press was dropped with it: letting go now means nothing.
    game.release();
    expect(game.frame()).toEqual([]);
  });

  it('forgets a button that is destroyed or deactivated while it is held down', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      addButton('Gone', 2, 1);
      addButton('Asleep', -2, 1);
    });
    game.pointAt(2, 1);
    game.press();
    game.frame();
    game.scene.findByName('Gone')!.destroy();
    game.release();
    expect(game.frame()).toEqual([]);

    game.pointAt(-2, 1);
    game.press();
    expect(game.frame()).toEqual(['Asleep:enter', 'Asleep:down']);
    game.scene.findByName('Asleep')!.active = false;
    game.release();
    // An inactive entity gets no callbacks, as with every other callback.
    expect(game.frame()).toEqual([]);
    expect(game.messages().filter((message) => message.startsWith('error'))).toEqual([]);
  });

  it('follows the position, rotation and scale of the entity', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      const entity = addButton('Sign', 3, 0, [4, 1]);
      entity.transform.rotation = Math.PI / 2;
      entity.transform.scale.set(0.5, 2);
    });
    // 4x1 scaled to 2x2 and turned a quarter turn: the area reaches 1 unit up and down,
    // and 1 unit to each side.
    game.pointAt(3.9, 0.9);
    expect(game.frame()).toEqual(['Sign:enter']);
    game.pointAt(4.1, 0);
    expect(game.frame()).toEqual(['Sign:exit']);
    const sign = game.scene.findByName('Sign')!;
    const area = getButtonMatrix(sign, sign.requireComponent(Button));
    expect(area.transformPoint(new Vec2(0.5, 0.5)).equals(new Vec2(2, 1))).toBe(true);
  });

  it('keeps a button on the screen under the same pixels wherever the camera looks', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      const entity = addButton('Pause', -100, -40, [160, 60]);
      entity.addComponent(ScreenAnchor, { horizontal: 'right', vertical: 'top' });
    });
    // 100 pixels in from the right edge and 40 down from the top edge of a 1280x720 screen.
    game.pointAtPixel(540 + 79, 320 + 29);
    expect(game.frame()).toEqual(['Pause:enter']);

    const camera = game.scene.findByName('Camera')!;
    camera.transform.position.set(500, -300);
    camera.transform.rotation = 1;
    camera.requireComponent(Camera).orthographicSize = 40;
    expect(game.frame()).toEqual([]);
    game.pointAtPixel(540 + 81, 320 + 29);
    expect(game.frame()).toEqual(['Pause:exit']);
  });

  it('raises the callbacks before the scripts are updated in the same frame', async () => {
    const game = await startButtonGame((_scene, addButton, assets) => {
      const entity = addButton('Play', 2, 1);
      const tracer = `
        import { Behaviour } from 'rowan';
        export default class Tracer extends Behaviour {
          onUpdate() { this.log('update'); }
          onClick() { this.log('click seen by a second script'); }
        }`;
      attachScript(entity, addScript(assets, 'Tracer.ts', tracer));
    });
    game.frame();
    game.pointAt(2, 1);
    game.press();
    game.release();
    expect(game.frame()).toEqual([
      'Play:enter',
      'Play:down',
      'Play:up',
      'Play:click',
      'click seen by a second script',
      'update',
    ]);
  });

  it('keeps working while time stands still, as a pause menu needs', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Resume', 0, 0));
    game.game.time.timeScale = 0;
    game.pointAt(0, 0);
    game.press();
    game.release();
    expect(game.frame()).toEqual(['Resume:enter', 'Resume:down', 'Resume:up', 'Resume:click']);
  });

  it('reports a callback that throws and carries on', async () => {
    const game = await startButtonGame((_scene, addButton, assets) => {
      const broken = `
        import { Behaviour } from 'rowan';
        export default class Broken extends Behaviour {
          onClick() { throw new Error('nothing to load'); }
        }`;
      const entity = addButton('Play', 2, 1);
      attachScript(entity, addScript(assets, 'Broken.ts', broken));
    });
    game.pointAt(2, 1);
    game.press();
    game.release();
    expect(game.frame()).toEqual([
      'Play:enter',
      'Play:down',
      'Play:up',
      'Play:click',
      'error: onClick failed on "Play": nothing to load',
    ]);
    game.pointAt(9, 9);
    expect(game.frame()).toEqual(['Play:exit']);
  });

  it('lets a finger press a button: enter, down, and on lifting up, click and exit', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, 2, 1);
    expect(game.frame()).toEqual(['Jump:enter', 'Jump:down']);
    expect(game.frame()).toEqual([]);
    game.lift(1);
    expect(game.frame()).toEqual(['Jump:up', 'Jump:click', 'Jump:exit']);
    expect(game.frame()).toEqual([]);
  });

  it('lets two fingers hold two buttons at once', async () => {
    const game = await startButtonGame((_scene, addButton) => {
      addButton('Left', -4, 0);
      addButton('Jump', 4, 0);
    });
    game.touch(1, -4, 0);
    expect(game.frame()).toEqual(['Left:enter', 'Left:down']);
    game.touch(2, 4, 0);
    expect(game.frame()).toEqual(['Jump:enter', 'Jump:down']);
    // The first finger is still down while the second one comes and goes.
    game.lift(2);
    expect(game.frame()).toEqual(['Jump:up', 'Jump:click', 'Jump:exit']);
    game.lift(1);
    expect(game.frame()).toEqual(['Left:up', 'Left:click', 'Left:exit']);
  });

  it('does not click when a finger slides off the button before it is lifted', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, 2, 1);
    game.frame();
    game.slide(1, 6, 4);
    expect(game.frame()).toEqual(['Jump:exit']);
    // Sliding back makes it the pressed button again.
    game.slide(1, 2, 1);
    expect(game.frame()).toEqual(['Jump:enter']);
    game.slide(1, 6, 4);
    game.frame();
    game.lift(1);
    expect(game.frame()).toEqual(['Jump:up']);
  });

  it('ignores a finger that comes down beside the buttons and slides onto one', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, -6, -3);
    game.frame();
    game.slide(1, 2, 1);
    game.lift(1);
    expect(game.frame()).toEqual([]);
  });

  it('gives a button that one finger holds to no second pointer', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, 2, 1);
    game.frame();
    game.touch(2, 2.2, 1.1);
    expect(game.frame()).toEqual([]);
    game.lift(2);
    expect(game.frame()).toEqual([]);
    game.lift(1);
    expect(game.frame()).toEqual(['Jump:up', 'Jump:click', 'Jump:exit']);
  });

  it('counts a tap that comes and goes between two frames', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, 2, 1);
    game.lift(1);
    expect(game.frame()).toEqual(['Jump:enter', 'Jump:down', 'Jump:up', 'Jump:click', 'Jump:exit']);
  });

  it('presses a button once when the first finger also acts as the mouse', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    // What the page reports for the first finger: a touch, and the pointer it drives.
    game.touch(1, 2, 1);
    game.game.input.handlePointerMove(640 + 2 * 72, 360 - 72, 1280, 720, true);
    game.press();
    expect(game.frame()).toEqual(['Jump:enter', 'Jump:down']);
    game.lift(1);
    game.release();
    game.game.input.handlePointerLeave();
    expect(game.frame()).toEqual(['Jump:up', 'Jump:click', 'Jump:exit']);
  });

  it('lets go without a click when the system takes a touch away', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, 2, 1);
    game.frame();
    game.game.input.handleTouchCancel(1);
    expect(game.frame()).toEqual(['Jump:up', 'Jump:exit']);
  });

  it('shows a button as pressed while a finger is on it', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    const jump = game.scene.findByName('Jump')!;
    game.touch(1, 2, 1);
    game.frame();
    expect(jump.getComponent(ButtonState)).toMatchObject({ hovered: true, pressed: true });
    game.slide(1, 7, 4);
    game.frame();
    expect(jump.getComponent(ButtonState)).toMatchObject({ hovered: false, pressed: true });
    game.lift(1);
    game.frame();
    expect(jump.hasComponent(ButtonState)).toBe(false);
  });

  it('lets go of everything when the page loses the focus', async () => {
    const game = await startButtonGame((_scene, addButton) => addButton('Jump', 2, 1));
    game.touch(1, 2, 1);
    game.frame();
    game.game.input.releaseAll();
    // The finger never came up as far as the page knows, so nothing was chosen.
    expect(game.frame()).toEqual(['Jump:up', 'Jump:exit']);
    expect(game.scene.findByName('Jump')!.hasComponent(ButtonState)).toBe(false);
  });

  it('does not ask for the camera view in a game without buttons', async () => {
    const project = createTestProject((scene) => {
      scene.createEntity('Camera').addComponent(Camera);
    });
    const game = await startTestGame(project);
    let views = 0;
    const original = game.game.getCameraView.bind(game.game);
    game.game.getCameraView = () => {
      views++;
      return original();
    };
    game.game.input.handlePointerMove(100, 100, 1280, 720);
    game.game.input.handlePointerDown(0);
    game.step(3);
    // Building a view allocates, and this would otherwise happen in every frame of every game.
    expect(views).toBe(0);
  });

  it('does nothing in a scene without a camera', async () => {
    const game = await startButtonGame((scene, addButton) => {
      addButton('Play', 0, 0, [100, 100]);
      scene.findByName('Camera')!.destroy();
    });
    game.pointAt(0, 0);
    game.press();
    expect(game.frame()).toEqual([]);
  });
});

describe('button looks', () => {
  /** A button with a sprite, a child sprite and a child text, each in a color of its own. */
  async function startTintGame(): Promise<ButtonGame & { colors: () => string[] }> {
    const game = await startButtonGame((scene, addButton) => {
      const button = addButton('Play', 0, 0);
      button.addComponent(SpriteRenderer, { color: new Color(1, 1, 1, 1) });
      Object.assign(button.requireComponent(Button), {
        hoverColor: new Color(0.8, 0.8, 0.8, 1),
        pressedColor: new Color(0.5, 0.5, 0.5, 1),
        disabledColor: new Color(0.25, 0.25, 0.25, 0.5),
      });
      const icon = scene.createEntity('Icon', { parent: button });
      icon.addComponent(SpriteRenderer, { color: new Color(1, 0, 0, 1) });
      const label = scene.createEntity('Label', { parent: button });
      label.addComponent(TextRenderer, { color: new Color(0, 0, 1, 1) });
      const other = scene.createEntity('Other');
      other.transform.position.set(-5, 0);
      other.addComponent(SpriteRenderer, { color: new Color(0, 1, 0, 1) });
    });
    return {
      ...game,
      colors() {
        game.game.render();
        return game.renderer.quads.map(
          (quad) => `${quad.color.toHex()}/${Math.round(quad.color.a * 100)}`,
        );
      },
    };
  }

  it('draws a button and everything below it in its own colors while nothing happens', async () => {
    const game = await startTintGame();
    game.frame();
    expect(game.colors()).toEqual(['#ffffff/100', '#ff0000/100', '#00ff00/100', '#0000ff/100']);
  });

  it('tints the button, its children and nothing else while it is hovered or pressed', async () => {
    const game = await startTintGame();
    game.pointAt(0, 0);
    game.frame();
    expect(game.colors()).toEqual(['#cccccc/100', '#cc0000/100', '#00ff00/100', '#0000cc/100']);
    const button = game.scene.findByName('Play')!;
    expect(button.getComponent(ButtonState)).toMatchObject({ hovered: true, pressed: false });

    game.press();
    game.frame();
    expect(game.colors()).toEqual(['#808080/100', '#800000/100', '#00ff00/100', '#000080/100']);
    expect(button.getComponent(ButtonState)).toMatchObject({ hovered: true, pressed: true });

    // Dragged off while held down, it no longer looks pressed, though it still is.
    game.pointAt(8, 4);
    game.frame();
    expect(game.colors()).toEqual(['#ffffff/100', '#ff0000/100', '#00ff00/100', '#0000ff/100']);
    expect(button.getComponent(ButtonState)).toMatchObject({ hovered: false, pressed: true });

    game.release();
    game.frame();
    expect(button.hasComponent(ButtonState)).toBe(false);
  });

  it('draws a button that is not interactable in its disabled color, pointer or not', async () => {
    const game = await startTintGame();
    game.scene.findByName('Play')!.requireComponent(Button).interactable = false;
    game.pointAt(0, 0);
    game.frame();
    expect(game.colors()).toEqual(['#404040/50', '#400000/50', '#00ff00/100', '#000040/50']);
  });

  it('removes its marks from the scene when the scene stops', async () => {
    const game = await startTintGame();
    game.pointAt(0, 0);
    game.press();
    game.frame();
    const { scene } = game;
    expect(scene.registry.count(ButtonState)).toBe(1);
    game.game.stop();
    expect(scene.registry.count(ButtonState)).toBe(0);
  });
});
