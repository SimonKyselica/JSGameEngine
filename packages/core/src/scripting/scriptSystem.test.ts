import { describe, expect, it } from 'vitest';
import { Vec2 } from '../math/vec2';
import {
  BoxCollider2D,
  Camera,
  Rigidbody2D,
  ScriptComponent,
  SpriteRenderer,
} from '../scene/components';
import {
  addPrefab,
  addScript,
  attachScript,
  createTestProject,
  startTestGame,
} from '../testing/fixtures';
import { Behaviour } from './behaviour';

/** A script that logs each lifecycle callback, prefixed with its `label` property. */
const TRACER = `
  import { Behaviour } from 'rowan';
  export default class Tracer extends Behaviour {
    static properties = { label: { type: 'string', default: 'tracer' } };
    label = '';
    onStart() { this.log(this.label + ':start'); }
    onFixedUpdate() { this.log(this.label + ':fixed'); }
    onUpdate() { this.log(this.label + ':update'); }
    onLateUpdate() { this.log(this.label + ':late'); }
    onDestroy() { this.log(this.label + ':destroy'); }
  }`;

describe('ScriptSystem lifecycle', () => {
  it('calls the callbacks in order: start, then fixed, update and late every frame', async () => {
    const project = createTestProject((scene, { assets }) => {
      attachScript(scene.createEntity('A'), addScript(assets, 'Tracer.ts', TRACER), { label: 'a' });
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual(['a:start']);

    game.step(2);
    expect(game.messages().slice(1)).toEqual([
      'a:fixed',
      'a:update',
      'a:late',
      'a:fixed',
      'a:update',
      'a:late',
    ]);

    game.game.stop();
    expect(game.messages().at(-1)).toBe('a:destroy');
  });

  it('runs every script update before any late update', async () => {
    const project = createTestProject((scene, { assets }) => {
      const tracer = addScript(assets, 'Tracer.ts', TRACER);
      attachScript(scene.createEntity('A'), tracer, { label: 'a' });
      attachScript(scene.createEntity('B'), tracer, { label: 'b' });
    });
    const game = await startTestGame(project);
    game.step();
    expect(game.messages().slice(2)).toEqual([
      'a:fixed',
      'b:fixed',
      'a:update',
      'b:update',
      'a:late',
      'b:late',
    ]);
  });

  it('applies inspector values, then defaults, then field initializers', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Props.ts',
        `import { Behaviour, Vec2, Color } from 'rowan';
         export default class Props extends Behaviour {
           static properties = {
             fromInspector: { type: 'number', default: 1 },
             fromDefault: { type: 'number', default: 2 },
             fromField: { type: 'number' },
             direction: { type: 'vec2', default: [0, 1] },
             tint: { type: 'color' },
             bullet: { type: 'prefab' },
           };
           fromInspector = 0; fromDefault = 0; fromField = 3;
           direction = new Vec2(); tint = new Color(); bullet = 'unset';
           onStart() {
             this.log(this.fromInspector, this.fromDefault, this.fromField);
             this.log(this.direction instanceof Vec2, this.direction.y);
             this.log(this.tint instanceof Color, this.tint.toHex(), this.bullet);
           }
         }`,
      );
      attachScript(scene.createEntity('E'), script, {
        fromInspector: 10,
        tint: [1, 0, 0, 1],
        bullet: null,
      });
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual(['10 2 3', 'true 1', 'true #ff0000 null']);
  });

  it('skips scripts that are disabled or on inactive entities until they are switched on', async () => {
    const project = createTestProject((scene, { assets }) => {
      const tracer = addScript(assets, 'Tracer.ts', TRACER);
      attachScript(scene.createEntity('Disabled'), tracer, { label: 'disabled' }, false);
      const inactive = scene.createEntity('Inactive');
      inactive.active = false;
      attachScript(inactive, tracer, { label: 'inactive' });
    });
    const game = await startTestGame(project);
    game.step();
    expect(game.messages()).toEqual([]);

    const { scene, sceneRuntime } = game.game;
    sceneRuntime.scripts.getScripts(scene.findByName('Disabled')!)[0]!.enabled = true;
    scene.findByName('Inactive')!.active = true;
    game.step();
    expect(game.messages()).toEqual([
      'disabled:start',
      'disabled:fixed',
      'inactive:start',
      'inactive:fixed',
      'disabled:update',
      'inactive:update',
      'disabled:late',
      'inactive:late',
    ]);
  });

  it('starts scripts that are added while the game runs', async () => {
    const project = createTestProject((scene, { assets }) => {
      addScript(assets, 'Tracer.ts', TRACER);
      scene.createEntity('Existing');
    });
    const game = await startTestGame(project);
    const tracerId = project.assets.findByName('Tracer')!.id;
    attachScript(game.game.scene.createEntity('New'), tracerId, { label: 'new' });
    attachScript(game.game.scene.findByName('Existing')!, tracerId, { label: 'late' });
    game.step();
    expect(game.messages().slice(0, 3)).toEqual(['new:start', 'new:fixed', 'late:start']);
  });

  it('destroys the instance when its binding is removed or re-pointed', async () => {
    const project = createTestProject((scene, { assets }) => {
      const tracer = addScript(assets, 'Tracer.ts', TRACER);
      addScript(assets, 'Other.ts', TRACER.replace('Tracer', 'Other'));
      const entity = scene.createEntity('E');
      attachScript(entity, tracer, { label: 'first' });
      attachScript(entity, tracer, { label: 'second' });
    });
    const game = await startTestGame(project);
    const { scene, sceneRuntime } = game.game;
    const component = scene.findByName('E')!.requireComponent(ScriptComponent);

    component.scripts[1]!.script = project.assets.findByName('Other')!.id;
    component.scripts.shift();
    game.step();
    expect(game.messages()).toContain('first:destroy');
    expect(game.messages()).toContain('second:destroy');
    expect(game.messages()).toContain('second:start');
    expect(sceneRuntime.scripts.instanceCount).toBe(1);

    scene.findByName('E')!.removeComponent(ScriptComponent);
    game.step();
    expect(sceneRuntime.scripts.instanceCount).toBe(0);
  });

  it('calls onDestroy while the entity is still readable', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Last.ts',
        `import { Behaviour } from 'rowan';
         export default class Last extends Behaviour {
           onDestroy() { this.log('bye from ' + this.entity.name + ' at ' + this.transform.position.x); }
         }`,
      );
      const entity = scene.createEntity('Doomed');
      entity.transform.position.x = 4;
      attachScript(entity, script);
    });
    const game = await startTestGame(project);
    game.game.scene.findByName('Doomed')!.destroy();
    expect(game.messages()).toEqual(['bye from Doomed at 4']);
  });

  it('does not call onDestroy on a script that never started', async () => {
    const project = createTestProject((scene, { assets }) => {
      const tracer = addScript(assets, 'Tracer.ts', TRACER);
      attachScript(scene.createEntity('Disabled'), tracer, {}, false);
    });
    const game = await startTestGame(project);
    game.game.stop();
    expect(game.messages()).toEqual([]);
  });
});

describe('ScriptSystem error handling', () => {
  it('logs a failing callback with script and entity names and keeps going', async () => {
    const project = createTestProject((scene, { assets }) => {
      const broken = addScript(
        assets,
        'Broken.ts',
        `import { Behaviour } from 'rowan';
         export default class Broken extends Behaviour {
           onStart() { throw new TypeError('no start'); }
           onUpdate() { throw new Error('no update'); }
         }`,
      );
      attachScript(scene.createEntity('Faulty'), broken);
      attachScript(scene.createEntity('Fine'), addScript(assets, 'Tracer.ts', TRACER));
    });
    const game = await startTestGame(project);
    game.step();
    expect(game.logs.filter((entry) => entry.level === 'error')).toMatchObject([
      { message: 'onStart failed on "Faulty": TypeError: no start', source: 'Broken' },
      { message: 'onUpdate failed on "Faulty": no update', source: 'Broken' },
    ]);
    expect(game.messages()).toContain('tracer:update');
  });

  it('reports a script that cannot load once and runs the rest', async () => {
    const project = createTestProject((scene, { assets }) => {
      const broken = addScript(assets, 'Syntax.ts', 'export default class {');
      attachScript(scene.createEntity('A'), broken);
      attachScript(scene.createEntity('B'), broken);
      attachScript(scene.createEntity('C'), addScript(assets, 'Tracer.ts', TRACER));
    });
    const game = await startTestGame(project);
    game.step(3);
    const errors = game.logs.filter((entry) => entry.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ source: 'Syntax' });
    expect(errors[0]!.message).toContain('Script "Syntax.ts" has a syntax error');
    expect(game.game.sceneRuntime.scripts.instanceCount).toBe(1);
  });

  it('explains that the engine is not available in a constructor', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Eager.ts',
        `import { Behaviour } from 'rowan';
         export default class Eager extends Behaviour { home = this.transform.position.clone(); }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual([
      'error: This script is not attached to an entity yet. The engine is not available in a ' +
        'constructor or field initializer; move the code to onStart().',
    ]);
  });

  it('reports malformed property declarations', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'BadProps.ts',
        `import { Behaviour } from 'rowan';
         export default class BadProps extends Behaviour { static properties = { hp: { type: 'int' } }; }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    expect(game.messages()[0]).toContain('Property "hp" has unknown type "int"');
  });

  it('ignores bindings without a script', async () => {
    const project = createTestProject((scene) => {
      scene.createEntity('E').addComponent(ScriptComponent, {
        scripts: [{ script: null, enabled: true, properties: {} }],
      });
    });
    const game = await startTestGame(project);
    game.step();
    expect(game.messages()).toEqual([]);
  });
});

describe('script timers', () => {
  /** Builds a game with one script whose body is the given class members. */
  async function startWith(members: string): Promise<Awaited<ReturnType<typeof startTestGame>>> {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Timed.ts',
        `import { Behaviour } from 'rowan';
         export default class Timed extends Behaviour { ${members} }`,
      );
      attachScript(scene.createEntity('Clock'), script);
    });
    return startTestGame(project);
  }

  /** The frames in which the script logged "tick", with frames starting at 1. */
  function tickFrames(game: Awaited<ReturnType<typeof startTestGame>>, frames: number): number[] {
    const result: number[] = [];
    for (let frame = 1; frame <= frames; frame++) {
      const before = game.logs.length;
      game.step();
      if (game.logs.slice(before).some((entry) => entry.message === 'tick')) {
        result.push(frame);
      }
    }
    return result;
  }

  it('calls back once, in the first frame after the time has passed', async () => {
    const game = await startWith(`onStart() { this.after(0.04, () => this.log('tick')); }`);
    // 0.04 seconds is 2.4 frames, so the third frame is the first one past it.
    expect(tickFrames(game, 10)).toEqual([3]);
  });

  it('repeats at its interval without drifting', async () => {
    const game = await startWith(`onStart() { this.every(0.04, () => this.log('tick')); }`);
    // Due at 0.04, 0.08, 0.12 and 0.16 seconds: frames 2.4, 4.8, 7.2 and 9.6.
    expect(tickFrames(game, 10)).toEqual([3, 5, 8, 10]);
  });

  it('catches up within a frame that is longer than the interval', async () => {
    const game = await startWith(
      `count = 0; onStart() { this.every(0.03, () => { this.count++; }); }
       onLateUpdate() { this.log(this.count); }`,
    );
    game.game.update(0.1);
    expect(game.messages()).toEqual(['3']);
  });

  it('counts the time from the call, not from the start of the frame', async () => {
    const game = await startWith(
      `onUpdate() { if (this.time.frameCount === 2) this.after(0.1, () => this.log('tick')); }`,
    );
    game.game.update(0.2);
    game.game.update(0.2);
    // The 0.2 seconds of the second frame had passed before the timer was started.
    expect(game.messages()).toEqual([]);
    game.game.update(0.2);
    expect(game.messages()).toEqual(['tick']);
  });

  it('fires a zero-delay timer in the same frame, after the updates', async () => {
    const game = await startWith(
      `onUpdate() {
         if (this.time.frameCount === 1) this.after(0, () => this.log('timer'));
         this.log('update');
       }
       onLateUpdate() { this.log('late'); }`,
    );
    game.step();
    expect(game.messages()).toEqual(['update', 'timer', 'late']);
  });

  it('stops when cancelled, also from inside its own callback', async () => {
    const game = await startWith(
      `count = 0;
       onStart() {
         const never = this.after(0.01, () => this.log('never'));
         never();
         never();
         const cancel = this.every(0.02, () => {
           this.count++;
           this.log('tick');
           if (this.count === 2) cancel();
         });
       }`,
    );
    game.step(20);
    expect(game.messages()).toEqual(['tick', 'tick']);
  });

  it('lets a timer callback start another timer, which waits for a later frame', async () => {
    const game = await startWith(
      `onStart() { this.after(0.01, () => { this.log('tick'); this.after(0, () => this.log('tick')); }); }`,
    );
    expect(tickFrames(game, 4)).toEqual([1, 2]);
  });

  it('follows the time scale', async () => {
    const game = await startWith(`onStart() { this.after(0.04, () => this.log('tick')); }`);
    game.game.time.timeScale = 0;
    expect(tickFrames(game, 10)).toEqual([]);
    game.game.time.timeScale = 0.5;
    // At half speed the 2.4 frames of waiting take 4.8 frames.
    expect(tickFrames(game, 10)).toEqual([5]);
  });

  it('pauses while the script is disabled or its entity inactive, keeping the time left', async () => {
    const game = await startWith(`onStart() { this.after(0.04, () => this.log('tick')); }`);
    const { scene, sceneRuntime } = game.game;
    const clock = scene.findByName('Clock')!;
    const script = sceneRuntime.scripts.getScripts(clock)[0]!;

    game.step(); // one of the 2.4 frames has passed
    script.enabled = false;
    expect(tickFrames(game, 5)).toEqual([]);
    script.enabled = true;
    clock.active = false;
    expect(tickFrames(game, 5)).toEqual([]);
    clock.active = true;
    // 1.4 frames are left, so it fires in the second frame after resuming.
    expect(tickFrames(game, 5)).toEqual([2]);
  });

  it('is cancelled when the entity is destroyed or the scene stops', async () => {
    const game = await startWith(`onStart() { this.every(0.02, () => this.log('tick')); }`);
    game.step(3);
    const ticks = game.messages().length;
    expect(ticks).toBeGreaterThan(0);
    game.game.scene.findByName('Clock')!.destroy();
    game.step(10);
    expect(game.messages()).toHaveLength(ticks);

    const stopped = await startWith(`onStart() { this.every(0.02, () => this.log('tick')); }`);
    stopped.game.stop();
    expect(stopped.messages()).toEqual([]);
  });

  it('stops repeating when its own callback destroys the entity', async () => {
    const game = await startWith(
      `onStart() { this.every(0.01, () => { this.log('tick'); this.entity.destroy(); }); }`,
    );
    game.game.update(0.1);
    game.step(3);
    expect(game.messages()).toEqual(['tick']);
  });

  it('logs a failing callback and keeps the timer and the game running', async () => {
    const game = await startWith(
      `onStart() {
         this.every(0.02, () => { throw new Error('bad timer'); });
         this.after(0.04, () => this.log('still here'));
       }`,
    );
    game.step(3);
    // Due at 0.02 and 0.04 seconds: it fails in frame 2, and again in frame 3.
    const failure = { message: 'A timer failed on "Clock": bad timer', source: 'Timed' };
    expect(game.logs.filter((entry) => entry.level === 'error')).toMatchObject([failure, failure]);
    expect(game.messages()).toContain('still here');
  });

  it.each([
    ['this.after(-1, () => {})', 'A timer needs a time of zero or more seconds, but got -1'],
    ['this.after(NaN, () => {})', 'A timer needs a time of zero or more seconds, but got NaN'],
    ['this.every(0, () => {})', 'every() needs an interval of at least 0.001 seconds, but got 0'],
    ['this.after(1, "soon")', 'A timer needs a function to call'],
  ])('rejects %s with an explanation', async (call, message) => {
    const game = await startWith(`onStart() { ${call}; }`);
    expect(game.messages()).toEqual([expect.stringContaining(message)]);
    expect(game.messages()[0]).toContain('onStart failed on "Clock"');
  });

  it('cannot be started by a script whose entity is gone', async () => {
    const game = await startWith(`onUpdate() {}`);
    const { scene, sceneRuntime } = game.game;
    const clock = scene.findByName('Clock')!;
    const script = sceneRuntime.scripts.getScripts(clock)[0]!;
    clock.destroy();
    expect(() => script.after(1, () => {})).toThrow(
      'A timer can only be started by a script on a living entity',
    );
  });
});

describe('script API', () => {
  it('gives access to the entity and its components', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Components.ts',
        `import { Behaviour, SpriteRenderer, Camera, BoxCollider2D } from 'rowan';
         export default class Components extends Behaviour {
           onStart() {
             this.log(this.entity.name, this.transform === this.entity.transform);
             this.log(this.hasComponent(SpriteRenderer), this.hasComponent(Camera));
             this.log(this.getComponent(Camera) === undefined);
             this.requireComponent(SpriteRenderer).sortingOrder = 9;
             this.addComponent(BoxCollider2D, { isTrigger: true });
             this.log(this.removeComponent(SpriteRenderer), this.hasComponent(SpriteRenderer));
             this.requireComponent(Camera);
           }
         }`,
      );
      const entity = scene.createEntity('Hero');
      entity.addComponent(SpriteRenderer);
      attachScript(entity, script);
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual([
      'Hero true',
      'true false',
      'true',
      'true false',
      'error: onStart failed on "Hero": Entity "Hero" has no Camera component',
    ]);
    expect(game.game.scene.findByName('Hero')!.requireComponent(BoxCollider2D).isTrigger).toBe(
      true,
    );
  });

  it('logs at three levels with the script as the source', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Talker.ts',
        `import { Behaviour, Vec2 } from 'rowan';
         export default class Talker extends Behaviour {
           onStart() { this.log('at', new Vec2(1, 2), { hp: 3 }); this.warn('careful'); this.error('bad'); }
         }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    expect(game.logs).toMatchObject([
      { level: 'info', message: 'at Vec2(1, 2) {"hp":3}', source: 'Talker' },
      { level: 'warn', message: 'careful', source: 'Talker' },
      { level: 'error', message: 'bad', source: 'Talker' },
    ]);
  });

  it('queries and edits the scene', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'SceneUser.ts',
        `import { Behaviour } from 'rowan';
         export default class SceneUser extends Behaviour {
           onStart() {
             const scene = this.scene;
             this.log(scene.name, scene.entities.length, scene.mainCamera?.name);
             this.log(scene.findByName('Coin')?.tag, scene.findByName('Nope'));
             this.log(scene.findByTag('pickup').length);
             const child = scene.createEntity('Spawned', this.entity);
             this.log(child.parent === this.entity, scene.entities.length);
           }
         }`,
      );
      scene.createEntity('Cam').addComponent(Camera);
      scene.createEntity('Coin').tag = 'pickup';
      scene.createEntity('Gem').tag = 'pickup';
      attachScript(scene.createEntity('User'), script);
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual(['Main 4 Cam', 'pickup null', '2', 'true 5']);
  });

  it('looks up assets and reads frame timing', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Info.ts',
        `import { Behaviour } from 'rowan';
         export default class Info extends Behaviour {
           onStart() {
             const id = this.assets.find('Info', 'script');
             this.log(this.assets.exists('Info'), this.assets.exists('Nope'), this.assets.find('Nope'));
             this.log(this.assets.getName(id), this.assets.getName('missing'));
           }
           onUpdate(deltaTime) {
             const time = this.time;
             this.log(deltaTime === time.deltaTime, time.frameCount, time.fixedDeltaTime === 1 / 60,
               time.elapsed.toFixed(4), time.unscaledDeltaTime.toFixed(4), time.timeScale);
           }
         }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    game.step(2);
    expect(game.messages()).toEqual([
      'true false null',
      'Info.ts null',
      'true 1 true 0.0167 0.0167 1',
      'true 2 true 0.0333 0.0167 1',
    ]);
  });

  it('finds other scripts by class, class name or asset name', async () => {
    const project = createTestProject((scene, { assets }) => {
      addScript(
        assets,
        'Health.ts',
        `import { Behaviour } from 'rowan';
         export default class HealthScript extends Behaviour { points = 5; }`,
      );
      const finder = addScript(
        assets,
        'Finder.ts',
        `import { Behaviour } from 'rowan';
         import HealthScript from './Health';
         export default class Finder extends Behaviour {
           onStart() {
             const target = this.scene.findByName('Target');
             this.log(this.getScript(HealthScript, target).points);
             this.log(this.getScript('HealthScript', target) === this.getScript('Health', target));
             this.log(this.getScript(HealthScript), this.getScript('Finder') === this);
           }
         }`,
      );
      attachScript(scene.createEntity('Target'), assets.findByName('Health')!.id);
      attachScript(scene.createEntity('Finder'), finder);
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual(['5', 'true', 'undefined true']);
  });

  it('does not bring a destroyed script back when another one asks for it while going down', async () => {
    const globals = globalThis as Record<string, unknown>;
    globals.__constructed = [];
    const project = createTestProject((scene, { assets }) => {
      const target = addScript(
        assets,
        'Target.ts',
        `import { Behaviour } from 'rowan';
         export default class Target extends Behaviour {
           constructor() { super(); globalThis.__constructed.push('Target'); }
           onDestroy() { this.log(this.entity.name + ': target destroyed'); }
         }`,
      );
      const finder = addScript(
        assets,
        'Finder.ts',
        `import { Behaviour } from 'rowan';
         export default class Finder extends Behaviour {
           static properties = { target: { type: 'string', default: '' } };
           target = '';
           onDestroy() {
             const entity = this.target === '' ? this.entity : this.scene.findByName(this.target);
             const found = this.getScript('Target', entity);
             this.log(this.entity.name + ': finds ' + (found === undefined ? 'nothing' : 'a script'));
           }
         }`,
      );
      // Scripts are destroyed in the order they were created, so each Target goes first.
      attachScript(scene.createEntity('Far'), target);
      attachScript(scene.createEntity('Watcher'), finder, { target: 'Far' });
      const both = scene.createEntity('Both');
      attachScript(both, target);
      attachScript(both, finder);
    });
    const game = await startTestGame(project);
    game.step();
    expect(globals.__constructed).toEqual(['Target', 'Target']);

    // One entity is destroyed with both of its scripts; then the scene stops.
    game.game.scene.findByName('Both')!.destroy();
    expect(game.messages()).toEqual(['Both: target destroyed', 'Both: finds nothing']);
    game.game.stop();
    expect(game.messages().slice(2)).toEqual(['Far: target destroyed', 'Watcher: finds nothing']);
    // Nothing was constructed again to answer those questions.
    expect(globals.__constructed).toEqual(['Target', 'Target']);
    delete globals.__constructed;
  });

  it('instantiates prefabs whose scripts can be configured immediately', async () => {
    const project = createTestProject((scene, project) => {
      const { assets } = project;
      const bullet = addScript(
        assets,
        'Bullet.ts',
        `import { Behaviour } from 'rowan';
         export default class Bullet extends Behaviour {
           damage = 1;
           onStart() { this.log('bullet', this.entity.name, this.damage, this.transform.position.x); }
         }`,
      );
      const template = scene.createEntity('Bullet');
      attachScript(template, bullet);
      scene.createEntity('Tip', { parent: template });
      const prefabId = addPrefab(project, template);
      template.destroy();

      const gun = addScript(
        assets,
        'Gun.ts',
        `import { Behaviour, Vec2 } from 'rowan';
         import Bullet from './Bullet';
         export default class Gun extends Behaviour {
           static properties = { bullet: { type: 'prefab' } };
           bullet = null;
           onStart() {
             const byId = this.instantiate(this.bullet, { position: new Vec2(3, 0), name: 'Shot' });
             this.getScript(Bullet, byId).damage = 7;
             const byName = this.instantiate('Bullet', { parent: this.entity, rotation: 1 });
             this.log(byId.children.length, byName.parent === this.entity, byName.worldRotation);
             this.instantiate('Missing');
           }
         }`,
      );
      attachScript(scene.createEntity('Gun'), gun, { bullet: prefabId });
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual([
      '1 true 1',
      'error: onStart failed on "Gun": Prefab "Missing" does not exist',
    ]);
    game.step();
    expect(game.messages().slice(2, 4)).toEqual(['bullet Shot 7 3', 'bullet Bullet 1 0']);
  });

  it('destroys entities at the end of the frame, or after a delay', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Reaper.ts',
        `import { Behaviour } from 'rowan';
         export default class Reaper extends Behaviour {
           onUpdate() {
             if (this.time.frameCount !== 1) return;
             const now = this.scene.findByName('Now');
             this.destroy(now);
             this.destroy(now);
             this.destroy(this.scene.findByName('Later'), 0.04);
             this.log('still valid this frame:', now.isValid);
           }
         }`,
      );
      scene.createEntity('Now');
      scene.createEntity('Later');
      attachScript(scene.createEntity('Reaper'), script);
    });
    const game = await startTestGame(project);
    const { scene } = game.game;
    game.step();
    expect(game.messages()).toEqual(['still valid this frame: true']);
    expect(scene.findByName('Now')).toBeNull();
    expect(scene.findByName('Later')).not.toBeNull();
    // The delay starts after frame 1 and is used up 2.4 frames later, during frame 4.
    game.step(2);
    expect(scene.findByName('Later')).not.toBeNull();
    game.step(1);
    expect(scene.findByName('Later')).toBeNull();
  });

  it('counts a destroy delay from the request, even when frames are long', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Slow.ts',
        `import { Behaviour } from 'rowan';
         export default class Slow extends Behaviour {
           onUpdate() {
             if (this.time.frameCount === 2) this.destroy(this.scene.findByName('Target'), 0.1);
           }
         }`,
      );
      scene.createEntity('Target');
      attachScript(scene.createEntity('Slow'), script);
    });
    const game = await startTestGame(project);
    const { scene } = game.game;
    // Each frame is 0.2 seconds long, twice the delay.
    game.game.update(0.2);
    game.game.update(0.2);
    // The 0.2 seconds of frame 2 had passed before the request, so the target survives it.
    expect(scene.findByName('Target')).not.toBeNull();
    game.game.update(0.2);
    expect(scene.findByName('Target')).toBeNull();
  });

  it('lets a script destroy its own entity', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'OneShot.ts',
        `import { Behaviour } from 'rowan';
         export default class OneShot extends Behaviour {
           onUpdate() { this.log('update'); this.destroy(); }
           onDestroy() { this.log('destroyed'); }
         }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    game.step(3);
    expect(game.messages()).toEqual(['update', 'destroyed']);
    expect(game.game.scene.entityCount).toBe(0);
  });

  it('delivers collision and trigger callbacks', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Contacts.ts',
        `import { Behaviour } from 'rowan';
         export default class Contacts extends Behaviour {
           onCollisionEnter(collision) {
             this.log('enter', collision.other.name, Math.round(collision.normal.y),
               collision.point.y.toFixed(1));
             this.physics.setVelocity(this.entity, new (collision.normal.constructor)(0, 12));
           }
           onCollisionExit(other) { this.log('exit', other.name); }
           onTriggerEnter(other) { this.log('trigger enter', other.name); }
           onTriggerExit(other) { this.log('trigger exit', other.name); }
         }`,
      );
      const ground = scene.createEntity('Ground');
      ground.addComponent(BoxCollider2D, { size: new Vec2(10, 1) });
      const zone = scene.createEntity('Zone');
      zone.transform.position.y = 2.5;
      zone.addComponent(BoxCollider2D, { size: new Vec2(10, 0.5), isTrigger: true });
      const ball = scene.createEntity('Ball');
      ball.transform.position.y = 1.2;
      ball.addComponent(Rigidbody2D);
      ball.addComponent(BoxCollider2D);
      attachScript(ball, script);
    });
    const game = await startTestGame(project);
    game.step(60);
    expect(game.messages().slice(0, 4)).toEqual([
      'enter Ground -1 0.5',
      'exit Ground',
      'trigger enter Zone',
      'trigger exit Zone',
    ]);
  });

  it('reads input and controls physics from fixed updates', async () => {
    const project = createTestProject((scene, { assets, settings }) => {
      const script = addScript(
        assets,
        'Mover.ts',
        `import { Behaviour, Vec2 } from 'rowan';
         export default class Mover extends Behaviour {
           onFixedUpdate() {
             this.physics.setVelocity(this.entity, new Vec2(this.input.getAxis('horizontal') * 6, 0));
           }
           onUpdate() {
             if (this.input.wasKeyPressed('Space')) this.log('jump');
           }
         }`,
      );
      settings.physics.gravity = [0, 0];
      const player = scene.createEntity('Player');
      player.addComponent(Rigidbody2D);
      player.addComponent(BoxCollider2D);
      attachScript(player, script);
    });
    const game = await startTestGame(project);
    const player = game.game.scene.findByName('Player')!;

    game.game.input.handleKeyDown('KeyD');
    game.game.input.handleKeyDown('Space');
    game.step(30);
    expect(player.transform.position.x).toBeCloseTo(3, 1);
    expect(game.messages()).toEqual(['jump']);

    game.game.input.handleKeyUp('KeyD');
    game.step(30);
    expect(player.transform.position.x).toBeCloseTo(3, 1);
  });

  it('plays audio through the script API', async () => {
    const project = createTestProject((scene, { assets }) => {
      assets.create({
        name: 'beep.wav',
        type: 'audio',
        mimeType: 'audio/wav',
        data: new Uint8Array(64),
      });
      const script = addScript(
        assets,
        'Dj.ts',
        `import { Behaviour, AudioSource } from 'rowan';
         export default class Dj extends Behaviour {
           onStart() {
             this.addComponent(AudioSource, { clip: this.assets.find('beep'), playOnStart: false });
             this.log(this.audio.isPlaying(this.entity), this.audio.play(this.entity),
               this.audio.isPlaying(this.entity));
             this.audio.stop(this.entity);
             this.log(this.audio.playOneShot('beep', 0.5, 2), this.audio.playOneShot('nope'));
             this.audio.masterVolume = 0.5;
             this.log(this.audio.masterVolume);
           }
         }`,
      );
      attachScript(scene.createEntity('Dj'), script);
    });
    const game = await startTestGame(project);
    expect(game.messages()).toEqual([
      'false true true',
      'warn: Cannot play audio clip "nope": it is missing or not loaded',
      'true false',
      '0.5',
    ]);
    expect(game.audio.voices).toHaveLength(2);
    expect(game.audio.voices[1]).toMatchObject({ volume: 0.5, pitch: 2 });
    expect(game.audio.masterVolume).toBe(0.5);
  });

  it('exposes script instances to the host', async () => {
    const project = createTestProject((scene, { assets }) => {
      attachScript(scene.createEntity('E'), addScript(assets, 'Tracer.ts', TRACER));
    });
    const game = await startTestGame(project);
    const { scene, sceneRuntime } = game.game;
    const scripts = sceneRuntime.scripts.getScripts(scene.findByName('E')!);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toBeInstanceOf(Behaviour);
    expect(sceneRuntime.scripts.getScript(scene.findByName('E')!, 'Tracer')).toBe(scripts[0]);
    expect(sceneRuntime.scripts.getScripts(scene.createEntity('Empty'))).toEqual([]);
  });
});
