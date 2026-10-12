# Rowan

Rowan is a 2D game engine with a Unity-style editor that runs entirely in the browser. You build
a scene from entities and components, script behaviour in TypeScript, press Play to try it, and
export a game that runs on any static web host or straight from a single HTML file.

There is nothing to install for the people who play your game, and no server-side part: the
editor, the engine and exported games are static files.

## Quick start

Requires Node.js 24 or newer.

```sh
npm install
npm run dev
```

Open <http://localhost:5173>. The editor starts with a small project: a player you can move with
A/D and make jump with Space, a ground and a few crates. Press Play in the toolbar.

## What is in it

**Editor**

- Hierarchy, Inspector, Project and Console panels, and Scene and Game views, laid out like Unity.
- Scene view with pan and zoom, click-to-select, and move, rotate and scale gizmos (Q, W, E, R;
  F frames the selection). Snap mode in the toolbar makes the gizmos work in fixed steps;
  holding Ctrl while dragging does the opposite of the mode.
- Play, Pause and Step. The game runs on a copy of the scene, so Stop restores it exactly.
- Undo and redo for every scene edit.
- Copy, cut and paste entities (Ctrl+C, X, V), also from one scene into another, and a search
  box that filters the hierarchy by name.
- A built-in code editor for scripts, with syntax checking as you type.
- Scripting documentation under Help → Scripting Reference (F1): guides with example scripts,
  a searchable reference of everything a script can use.
- Import by menu or drag and drop: PNG, JPEG, WebP, GIF, BMP, AVIF and SVG images; WAV, MP3, OGG,
  M4A, AAC, FLAC and WebA audio; TypeScript and JavaScript scripts.
- Prefabs: save any entity with its children and spawn copies from the editor or from scripts.
- Projects are stored in the browser. Export a project file to back it up or move it.

**Engine**

- Entities with components: Transform (with parent/child hierarchy), Sprite Renderer, Camera,
  Rigidbody 2D, Box Collider 2D, Circle Collider 2D, Audio Source and Script.
- A batched WebGL2 sprite renderer with sorting, tinting, flipping and off-screen culling.
- 2D physics (planck.js, a Box2D port): dynamic, kinematic and static bodies with an optional
  start velocity, triggers, collision callbacks, raycasts, and point and circle queries, stepped
  at a fixed rate.
- Sound through the Web Audio API.
- Keyboard and mouse input.

**Export**

File → Build Game… produces either a zip to upload to a web host, or one self-contained HTML
file that also runs when opened from disk. Exports contain the stripped player and your game
only: no editor, and scripts compiled ahead of time.

## Scripting

A script is a TypeScript (or JavaScript) class that extends `Behaviour`. Attach it to an entity
with the Script component. Properties listed in `static properties` show up in the inspector.

```ts
import { Behaviour, Vec2 } from 'rowan';

export default class PlayerController extends Behaviour {
  static properties = {
    speed: { type: 'number', default: 5, min: 0 },
    bullet: { type: 'prefab' },
  };

  speed = 5;
  bullet: string | null = null;

  onFixedUpdate() {
    const velocity = this.physics.getVelocity(this.entity);
    velocity.x = this.input.getAxis('horizontal') * this.speed;
    this.physics.setVelocity(this.entity, velocity);
  }

  onUpdate() {
    if (this.bullet && this.input.wasKeyPressed('KeyF')) {
      const shot = this.instantiate(this.bullet, { position: this.entity.worldPosition });
      this.physics.setVelocity(shot, new Vec2(12, 0));
      this.destroy(shot, 2); // remove it again after two seconds
    }
  }

  onCollisionEnter(collision) {
    this.log('hit', collision.other.name);
  }
}
```

Callbacks: `onStart`, `onUpdate`, `onFixedUpdate`, `onLateUpdate`, `onDestroy`,
`onCollisionEnter`, `onCollisionExit`, `onTriggerEnter`, `onTriggerExit`.

From a script you can reach `this.entity`, `this.transform`, `this.scene`, `this.input`,
`this.physics`, `this.audio`, `this.assets` and `this.time`, plus `getComponent`, `getScript`,
`instantiate`, `destroy` and `log`. `this.after(seconds, fn)` and `this.every(seconds, fn)` are
timers that stop by themselves when the entity is destroyed, and `entity.findChild(name)`,
`getComponentInChildren` and `getComponentInParent` look through the hierarchy. Scripts can
import each other by relative path. Types are
stripped, not checked, when a script is compiled. An error thrown by a script is reported in the
Console panel and does not stop the game.

Conventions: world Y points up, angles are in radians (the inspector shows degrees), time is in
seconds, colors are floats from 0 to 1, and keys are named by their `KeyboardEvent.code`
(`'KeyW'`, `'Space'`, `'ArrowLeft'`).

The full documentation is part of the editor: Help → Scripting Reference, or F1. It opens in its
own tab and has guides for each topic and a reference of every class, method and property.

## Repository layout

| Package                 | Contents                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| `packages/core`         | The engine library, `@rowan/core`                                    |
| `packages/runtime`      | The player that exported games ship with                             |
| `packages/editor`       | The editor                                                           |
| `packages/feature-test` | A project that exercises every component and the whole scripting API |
| `e2e`                   | Browser tests for the editor and for exported games                  |

## Development

```sh
npm run check       # typecheck, lint, format check and unit tests
npm run test:e2e    # build, then run the browser tests (Chromium and WebKit via Playwright)
npm run build       # build the core library, the player and the editor into dist/ folders
npm run docs:generate  # rebuild the scripting reference after changing the scripting API
npm run preview     # serve the built editor at http://localhost:4173
```

The first time, install the browsers the end-to-end tests use:
`npx playwright install chromium webkit`.

To deploy the editor, run `npm run build` and host `packages/editor/dist` as static files.

The engine is tested at three levels: unit tests for every module, a feature-test project that
checks every component and every scripting API member and runs headless, and browser tests that
run that same project in the editor and as an exported game. A unit test fails when a component
field or API member is added without the feature test exercising it.

Contribution rules, code style and the reasoning behind the architecture are in
[AGENTS.md](AGENTS.md).

## Good to know

- **Browser support:** WebGL2 is required, which every current desktop and mobile browser has.
  The automated browser tests run on Chromium and on WebKit, the engine of Safari. Firefox is
  not part of the automated runs.
- **Projects live in your browser's storage.** Clearing site data deletes them. Use
  File → Export Project File for backups.
- **Scripts are code.** Opening a project runs its scripts in your browser, so only open
  projects from people you trust.
- **Not built yet:** text rendering, sprite animation and sprite sheets, tilemaps, particles,
  gamepad and multi-touch input, and physics joints.
