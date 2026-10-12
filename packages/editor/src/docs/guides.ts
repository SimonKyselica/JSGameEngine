import { slugify, type DocBlock, type GuidePage } from './docTypes';
import countdown from './examples/Countdown.ts?raw';
import jukebox from './examples/Jukebox.ts?raw';
import keyboardMover from './examples/KeyboardMover.ts?raw';
import levelExit from './examples/LevelExit.ts?raw';
import lifecycleLogger from './examples/LifecycleLogger.ts?raw';
import menuButton from './examples/MenuButton.ts?raw';
import patrol from './examples/Patrol.ts?raw';
import pauseButton from './examples/PauseButton.ts?raw';
import playerController from './examples/PlayerController.ts?raw';
import scanner from './examples/Scanner.ts?raw';
import scoreCounter from './examples/ScoreCounter.ts?raw';
import spinner from './examples/Spinner.ts?raw';
import turret from './examples/Turret.ts?raw';

const p = (text: string): DocBlock => ({ kind: 'paragraph', text });
const h = (text: string): DocBlock => ({ kind: 'heading', text, id: slugify(text) });
const code = (source: string): DocBlock => ({ kind: 'code', code: source.trim() });
const list = (...items: string[]): DocBlock => ({ kind: 'list', ordered: false, items });
const steps = (...items: string[]): DocBlock => ({ kind: 'list', ordered: true, items });
const note = (text: string): DocBlock => ({ kind: 'note', text });
const table = (head: string[], ...rows: string[][]): DocBlock => ({ kind: 'table', head, rows });

/**
 * The guide: hand-written pages that explain how scripting works, in reading order.
 *
 * Complete example scripts live in `./examples` as real TypeScript files, so the compiler
 * checks them against the scripting API. Short snippets are written inline.
 */
export const GUIDES: readonly GuidePage[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary:
      'Scripts give a Rowan game its behaviour. This page takes you from an empty script to an entity that moves.',
    blocks: [
      p(
        'A script is a TypeScript class that extends [Behaviour](api/Behaviour). You attach it to an entity with the Script component; the engine then creates one instance of the class for that entity and calls its callbacks while the game runs.',
      ),
      h('Your first script'),
      steps(
        'In the editor choose **Assets → New Script…** and name it `Spinner`. The script opens in the code editor.',
        'Replace its contents with the script below.',
        'Select an entity that has a sprite, press **Add Component**, choose **Script**, then **Add Script → Spinner.ts**.',
        'Press **Play**. The entity turns. Stop, change **Turns Per Second** in the inspector, and play again.',
      ),
      code(spinner),
      h('How a script is put together'),
      list(
        "`import { ... } from 'rowan'` brings in the engine. Everything you can import is listed under **API reference** in the navigation.",
        '`export default class ... extends Behaviour` is the script itself. Each script file exports exactly one such class.',
        '`static properties` lists the values that can be edited in the inspector. See [Inspector properties](guide/properties).',
        '`onUpdate` is one of the callbacks the engine calls. See [The script lifecycle](guide/lifecycle).',
        "`this.transform` is the entity's position, rotation and scale. A script also reaches the rest of the engine through `this`: `this.entity`, `this.scene`, `this.input`, `this.physics`, `this.audio`, `this.assets` and `this.time`.",
      ),
      h('Working with scripts'),
      list(
        'Changes to a script take effect the next time you press Play. The line under the code editor reports syntax errors as you type.',
        'Messages written with `this.log` appear in the **Console** panel, and so do errors thrown by a script. An error ends the callback it happened in; the game keeps running.',
        'Scripts are TypeScript, but type annotations are only removed when a script is compiled. They are not checked.',
        "A script can import another script by its relative path, for example `import Health from './Health'`.",
      ),
      note(
        'The engine is not available while a script is being constructed. Field initializers and the constructor cannot use `this.entity`, `this.transform` or any other service; do that work in `onStart`.',
      ),
    ],
  },
  {
    id: 'lifecycle',
    title: 'The script lifecycle',
    summary:
      'The engine drives a script by calling its callbacks. Define the ones you need; all of them are optional.',
    blocks: [
      table(
        ['Callback', 'When the engine calls it'],
        ['`onStart()`', 'Once, before the script receives its first update.'],
        [
          '`onFixedUpdate(fixedDeltaTime)`',
          'At the fixed physics rate, just before each physics step.',
        ],
        ['`onUpdate(deltaTime)`', 'Once every frame.'],
        [
          '`onLateUpdate(deltaTime)`',
          'Once every frame, after every script has had its `onUpdate`.',
        ],
        [
          '`onCollisionEnter(collision)`',
          'When a solid collider of the entity starts touching another solid collider.',
        ],
        ['`onCollisionExit(other)`', 'When that contact ends.'],
        [
          '`onTriggerEnter(other)`',
          'When the entity starts overlapping another and one of the two colliders is a trigger.',
        ],
        ['`onTriggerExit(other)`', 'When that overlap ends.'],
        [
          '`onPointerEnter()`, `onPointerExit()`',
          "When the pointer moves onto the entity's [Button](api/Button), and off it again.",
        ],
        [
          '`onPointerDown()`, `onPointerUp()`, `onClick()`',
          'When the button is pressed, let go, and chosen. See [Screen and buttons](guide/ui).',
        ],
        ['`onDestroy()`', 'When the entity is destroyed or the scene ends.'],
      ),
      p(
        'The exact signatures are listed under [ScriptLifecycle](api/ScriptLifecycle). Implementing that interface lets a type-aware editor check them, but it is not required.',
      ),
      h('Order within a frame'),
      steps(
        'The physics catches up with the time that has passed. For each fixed step, every script gets `onFixedUpdate`, then the physics advances, then the collision and trigger callbacks for that step run. A frame can contain no step, one, or several.',
        'Buttons look at the pointer, and the pointer callbacks they raise run.',
        '`onUpdate` runs for every script.',
        'Timers started with `after` and `every` that are due call back.',
        '`onLateUpdate` runs for every script.',
        'Entities passed to `this.destroy` are removed, and their scripts get `onDestroy`.',
      ),
      p(
        '`onStart` has no fixed place in this order. Scripts that are in the scene from the beginning get it when the scene starts; a script that is created later gets it immediately before the first other callback it receives.',
      ),
      p(
        'Because the number of fixed steps per frame varies, put code that drives physics in `onFixedUpdate`, and code that reads one-frame events such as `wasKeyPressed` in `onUpdate`.',
      ),
      h('Enabled and active'),
      p(
        "A script receives callbacks only while its `enabled` field is true and its entity is active, along with all of the entity's parents. Timers pause under the same conditions. A script that is disabled when the scene starts gets its `onStart` when it is first enabled.",
      ),
      h('Seeing it happen'),
      p(
        'Attach this script to an entity and watch the Console panel to see when each callback arrives.',
      ),
      code(lifecycleLogger),
    ],
  },
  {
    id: 'properties',
    title: 'Inspector properties',
    summary:
      'Properties let you tune a script per entity from the inspector, without touching its code.',
    blocks: [
      p(
        "List a script's properties in a static field called `properties`, and give the class a field with the same name for each one. The inspector shows a control for every property of every script attached to the selected entity.",
      ),
      code(patrol),
      h('Property types'),
      table(
        ['Type', 'The field holds', 'Default is written as'],
        ["`'number'`", 'a number', '`5`'],
        ["`'boolean'`", '`true` or `false`', '`false`'],
        ["`'string'`", 'a string', "`'Level 2'`"],
        ["`'vec2'`", 'a [Vec2](api/Vec2)', '`[x, y]`'],
        ["`'color'`", 'a [Color](api/Color)', '`[r, g, b, a]`'],
        ["`'texture'`", 'the id of a texture asset, or `null`', 'not applicable'],
        ["`'audio'`", 'the id of an audio asset, or `null`', 'not applicable'],
        ["`'prefab'`", 'the id of a prefab asset, or `null`', 'not applicable'],
      ),
      p(
        'Besides `type`, a property can have a `default`, a `label` for the inspector, and for numbers `min`, `max` and `step`. See [ScriptPropertyDefinition](api/ScriptPropertyDefinition).',
      ),
      h('When the values arrive'),
      p(
        'The engine assigns each property after the script has been constructed and before `onStart` runs. It uses the value set in the inspector, or else the `default`; without either, the field keeps the value the class gave it. So a value written in the class body is only a fallback.',
      ),
      h('Asset properties'),
      p(
        'Texture, audio and prefab properties hold the id of the chosen asset. That id is exactly what the engine expects wherever it takes an asset: `this.instantiate(this.bullet)`, `this.audio.playOneShot(this.jingle)`, or `sprite.texture = this.portrait`.',
      ),
    ],
  },
  {
    id: 'movement',
    title: 'Moving things',
    summary: 'How positions, rotations and time work, and how to move an entity smoothly.',
    blocks: [
      h('The transform'),
      p(
        "Every entity has a [Transform](api/Transform) with a `position`, a `rotation` and a `scale`, all relative to its parent. For an entity without a parent that is the same as world space. A script reaches its own entity's transform as `this.transform`.",
      ),
      code(`// Move right at 3 units per second, and turn a quarter turn per second.
this.transform.position.x += 3 * deltaTime;
this.transform.rotation += (Math.PI / 2) * deltaTime;`),
      list(
        'World **Y points up**. One unit is whatever you decide; a sprite is one unit wide for every `pixelsPerUnit` pixels of its texture.',
        'Rotations are in **radians**, counter-clockwise. The inspector shows degrees; in code use `MathUtils.degToRad(90)` when degrees read better.',
        'For a child entity, `transform.position` is relative to the parent. Use `entity.worldPosition` and `entity.setWorldPosition(...)` when you need world space.',
      ),
      h('Frame-rate independence'),
      p(
        '`onUpdate` receives `deltaTime`, the time in seconds since the previous frame. Multiply speeds by it and the game runs at the same pace on every computer. The same value is available as `this.time.deltaTime`, and [Time](api/Time) also has `elapsed`, `frameCount` and `timeScale` for slow motion or pausing.',
      ),
      h('Vectors change in place'),
      p(
        'Methods of [Vec2](api/Vec2) such as `add`, `scale` and `normalize` modify the vector they are called on and return it, so calls can be chained. That is fast, but it means a vector you were handed can change under you, and one you change may belong to something else.',
      ),
      code(`// Wrong: this changes the target's own position.
const offset = target.transform.position.sub(this.transform.position);

// Right: clone first, then change the copy.
const direction = target.transform.position.clone().sub(this.transform.position);`),
      note(
        'An entity with a dynamic Rigidbody 2D is moved by the physics. Setting its transform teleports it; to move it smoothly, set its velocity instead. See [Physics and collisions](guide/physics).',
      ),
    ],
  },
  {
    id: 'input',
    title: 'Input',
    summary: 'Reading the keyboard and the mouse through `this.input`.',
    blocks: [
      code(keyboardMover),
      h('Keys'),
      p(
        "Keys are identified by their position on the keyboard, using the browser's `KeyboardEvent.code` names: `KeyW`, `KeyA`, `Digit1`, `Space`, `Enter`, `Escape`, `ShiftLeft`, `ArrowLeft`, and so on. A layout-independent code means WASD stays in the same place on every keyboard.",
      ),
      table(
        ['Method', 'True'],
        ['`isKeyDown(code)`', 'for as long as the key is held.'],
        ['`wasKeyPressed(code)`', 'during the one frame in which the key went down.'],
        ['`wasKeyReleased(code)`', 'during the one frame in which the key was let go.'],
      ),
      p(
        "`getAxis('horizontal')` and `getAxis('vertical')` combine A/D or the left/right arrows, and S/W or down/up, into a number from -1 to 1.",
      ),
      h('Mouse'),
      list(
        '`isMouseButtonDown`, `wasMouseButtonPressed` and `wasMouseButtonReleased` work like their key counterparts. Pass `MouseButton.Left`, `MouseButton.Middle` or `MouseButton.Right`.',
        '`mousePosition` is the pointer in pixels from the top-left corner of the game view.',
        '`mouseWorldPosition` is the same point in world space, as seen through the main camera. It is what you compare with entity positions.',
        '`scrollDelta` is how far the wheel moved during this frame.',
      ),
      note(
        'Read one-frame events such as `wasKeyPressed` in `onUpdate`. In `onFixedUpdate` they can be missed, or seen twice, because a frame does not always contain exactly one fixed step.',
      ),
    ],
  },
  {
    id: 'physics',
    title: 'Physics and collisions',
    summary:
      'Rigid bodies, colliders, the callbacks they raise, and how to ask the physics world questions.',
    blocks: [
      h('Bodies and colliders'),
      table(
        ['Component', 'What it does'],
        [
          '[Rigidbody2D](api/Rigidbody2D)',
          'Makes the entity a body that moves. `dynamic` bodies react to gravity, forces and collisions; `kinematic` bodies move only by their velocity; `static` bodies never move.',
        ],
        [
          '[BoxCollider2D](api/BoxCollider2D)',
          'A rectangular shape, sized in local units and scaled with the entity.',
        ],
        ['[CircleCollider2D](api/CircleCollider2D)', 'A round shape.'],
      ),
      p(
        'An entity with a collider but no Rigidbody 2D is a static obstacle: ground, walls, platforms. A collider marked **Is Trigger** does not block anything; it only reports what overlaps it.',
      ),
      h('Moving a body'),
      p(
        'Control bodies through [this.physics](api/Physics2D) rather than through the transform. Set a velocity for direct control, apply an impulse for a sudden push such as a jump, and apply a force every fixed update for something that builds up, such as a thruster.',
      ),
      code(playerController),
      list(
        'Movement code belongs in `onFixedUpdate`, which runs in step with the physics.',
        '`getVelocity` returns a copy. Change it and hand it back with `setVelocity`.',
        'To give a body a velocity from the moment it exists, set **Initial Velocity** on its Rigidbody 2D instead of writing a script.',
      ),
      h('Collisions and triggers'),
      p(
        'When two solid colliders start touching, both entities get `onCollisionEnter` with a [Collision](api/Collision): the `other` entity, the contact `point`, and a `normal` that points from the receiving entity towards the other one. When a trigger is involved, both get `onTriggerEnter` with the other entity instead. `onCollisionExit` and `onTriggerExit` report the end.',
      ),
      h('Asking questions'),
      p(
        'The physics world can be queried at any time: `raycast` finds the first solid collider along a line, `raycastAll` finds all of them, and `overlapPoint` and `overlapCircle` find the colliders at a point or within a radius.',
      ),
      code(scanner),
      note(
        'Queries see bodies where they were after the most recent physics step. An entity created or moved in the current frame is in its new place from the next step on.',
      ),
    ],
  },
  {
    id: 'spawning',
    title: 'Spawning and destroying',
    summary: 'Creating entities from prefabs while the game runs, and removing them again.',
    blocks: [
      h('Prefabs'),
      p(
        'A prefab is an entity, with its components and children, saved as an asset. Build the entity in a scene, right-click it in the hierarchy and choose **Save as Prefab**. `this.instantiate` then adds a fresh copy to the running scene and returns its root entity.',
      ),
      code(turret),
      list(
        "Pass the prefab's asset id, which is what a `prefab` property holds, or its name: `this.instantiate('Bullet')`.",
        'The optional second argument is a [SpawnOptions](api/SpawnOptions): a world `position` and `rotation`, a `parent`, and a `name`.',
        'The scripts of the new entity exist right away, so `this.getScript(Bullet, shot)` works on the next line. Their `onStart` runs later, just before the first callback they receive, so values you set on them straight after spawning are already in place.',
        "For an empty entity use `this.scene.createEntity('Name')` and add components with `addComponent`.",
      ),
      h('Destroying'),
      p(
        "`this.destroy()` removes the script's own entity; `this.destroy(other)` removes another one. Children go with their parent. The entity stays valid until the end of the current frame, so the rest of the frame's code can still use it, and a second argument delays the removal by that many seconds.",
      ),
      code(`this.destroy();            // this entity, at the end of the frame
this.destroy(other);       // another entity
this.destroy(other, 2.5);  // in two and a half seconds`),
      note(
        'Keep no references to entities that may have been destroyed, or check `entity.isValid` before using one. Using a destroyed entity throws an error.',
      ),
    ],
  },
  {
    id: 'timers',
    title: 'Timers',
    summary: 'Doing something later, or repeatedly, without counting frames yourself.',
    blocks: [
      p(
        '`this.after(seconds, callback)` calls a function once after a delay. `this.every(seconds, callback)` calls it again and again. Both return a function that cancels the timer.',
      ),
      code(countdown),
      h('Rules'),
      list(
        'Timers run on game time. `this.time.timeScale` slows them down or stops them along with everything else.',
        'A timer belongs to the script that started it. It pauses while that script is disabled or its entity inactive, and it is cancelled when the entity is destroyed or the scene ends, so a callback never runs for an entity that is gone.',
        'The wait is counted from the call. Timers that are due call back once per frame, after `onUpdate`.',
        'A repeating timer does not drift. When a frame is longer than the interval, the calls that were missed are made in that frame. The interval must be at least 0.001 seconds.',
        'Write the callback as an arrow function, `() => this.fire()`, so that `this` is still the script inside it.',
      ),
    ],
  },
  {
    id: 'text',
    title: 'Text',
    summary: 'Showing scores, labels and messages with the Text Renderer component.',
    blocks: [
      p(
        'A [TextRenderer](api/TextRenderer) component writes text at the position of its entity. Create one with **Entity → Text**, or add a **Text Renderer** to an entity you already have. A script changes what it says by assigning to `text`.',
      ),
      code(scoreCounter),
      h('What you can set'),
      table(
        ['Field', 'What it does'],
        ['`text`', 'What is written. A line break, `\\n` in a string, starts a new line.'],
        ['`font`', "`'sans-serif'`, `'serif'` or `'monospace'`."],
        ['`fontSize`', 'The height of the font in world units.'],
        ['`bold`, `italic`', 'A heavier weight, and slanted letters.'],
        ['`color`', 'The color of the text. Its alpha makes the text see-through.'],
        [
          '`align`, `verticalAlign`',
          'Where the text sits relative to the entity: to the left, centered or to the right of it, and above, centered or below.',
        ],
        ['`lineHeight`', 'The distance between lines, as a multiple of the font size.'],
        [
          '`sortingOrder`',
          'What is drawn on top. Texts and sprites share one order; a text is drawn over a sprite with the same number.',
        ],
        ['`visible`', 'Hides the text without removing it.'],
      ),
      h('Size and position'),
      list(
        'A text belongs to the world, like a sprite: it has a place in the scene, and it turns and scales with its entity. `fontSize` is in world units, so a text with a font size of 1 is as tall as a sprite one unit high.',
        'With `align` set to `left`, the text starts at the entity and grows to the right as it gets longer. That keeps a score in place while its number of digits changes. `center` and `right` work the same way from the middle and from the end.',
        'For text that should stay where it is on the screen while the camera moves, such as a score, give its entity a **Screen Anchor**, or create it with **Entity → Screen Text**. Its font size is then in pixels. See [Screen and buttons](guide/ui).',
        'Text stays sharp at every size: the engine draws it for the size it has on screen.',
      ),
      h('Fonts'),
      p(
        "The three fonts are the browser's own: each device shows its standard sans-serif, serif or monospaced font. The letters therefore look slightly different from one device to another, and so does the width of a text. Leave some room around a text rather than fitting it to the pixel.",
      ),
      note(
        'Writing a new text costs a little each time, because the engine has to draw the letters again. Changing it when the score changes is fine. Avoid assigning a different text every single frame to many texts at once.',
      ),
    ],
  },
  {
    id: 'ui',
    title: 'Screen and buttons',
    summary:
      'Scores, menus and buttons: placing things on the screen instead of in the world, and reacting to the pointer.',
    blocks: [
      h('Placing things on the screen'),
      p(
        'An entity normally has a place in the world, and the camera decides where that ends up on the screen. A [ScreenAnchor](api/ScreenAnchor) component turns this around: the entity gets a place on the screen and stays there wherever the camera looks. **Entity → Screen Text** creates a text that is set up this way.',
      ),
      list(
        'With a Screen Anchor, the **Position** of the entity is measured in pixels from a corner, an edge or the center of the screen, chosen with `horizontal` and `vertical`.',
        'X points right and Y points up, as everywhere else. From the top-left corner, a position of `(16, -16)` is 16 pixels in from both edges.',
        'A pixel is a pixel of the resolution under **File → Project Settings…**. The whole picture is scaled to the window the game runs in, so the layout looks the same on every screen.',
        'Sizes are in pixels as well. A text on the screen has a `fontSize` such as 32 rather than 0.5. A sprite without a texture is one pixel large, so its **Scale** is its size in pixels; a sprite with a texture shows it pixel for pixel when `pixelsPerUnit` is 1.',
        'The children of the entity are on the screen with it, positioned relative to it in pixels.',
        'Everything on the screen is drawn over the world. Among themselves, things on the screen are ordered by `sortingOrder` as usual.',
      ),
      p(
        'In the scene view, things on the screen are shown inside the frame of the camera, where the game will show them. They can be selected and moved there like everything else.',
      ),
      h('Buttons'),
      p(
        'A [Button](api/Button) component makes an entity react to the pointer: the mouse, or a finger on a touch screen. **Entity → Button** creates one in the middle of the screen, with a text and a background. The button itself draws nothing; what the player sees are the sprites and texts of the entity and its children.',
      ),
      table(
        ['Field', 'What it does'],
        [
          '`size`',
          'Width and height of the area that reacts, centered on the entity. In pixels on the screen, in world units in the world. The scene view outlines it when the entity is selected.',
        ],
        [
          '`interactable`',
          'Switch it off to disable the button: it gets no callbacks and is drawn in `disabledColor`.',
        ],
        [
          '`hoverColor`, `pressedColor`, `disabledColor`',
          'Tints that are multiplied with the colors of everything the button shows while the pointer is over it, while it is held down, and while it is disabled.',
        ],
      ),
      p('A script on the same entity is told what the pointer does:'),
      code(menuButton),
      h('Pointer callbacks'),
      table(
        ['Callback', 'When it is called'],
        ['`onPointerEnter()`', 'The pointer moves onto the button.'],
        ['`onPointerExit()`', 'The pointer leaves the button.'],
        [
          '`onPointerDown()`',
          'The left mouse button goes down on the button, or a finger touches it.',
        ],
        ['`onPointerUp()`', 'That press ends, wherever the pointer is by then.'],
        [
          '`onClick()`',
          'Right after `onPointerUp`, when the press ended on the button it began on. Use this one to act on a choice.',
        ],
      ),
      list(
        'When buttons overlap, the one drawn on top gets the pointer: a button on the screen before one in the world, then the one with the higher `sortingOrder` on its own sprite or text.',
        'A disabled button still covers the buttons behind it.',
        'The callbacks run once per frame, before `onUpdate`. See [The script lifecycle](guide/lifecycle).',
      ),
      p('Buttons keep working while `this.time.timeScale` is 0, which is what a pause menu needs:'),
      code(pauseButton),
      h('Buttons in the world'),
      p(
        'A Button does not need a Screen Anchor. On an entity in the world its `size` is in world units and it follows the entity as it moves, turns and scales, which makes anything in the game clickable: a door, an enemy, a card on a table.',
      ),
      note(
        'A click on a button is still a mouse click for the rest of the game: `this.input.wasMouseButtonPressed` is true in that frame as well. A script that shoots on every click also shoots when a button is clicked, unless it leaves those clicks out itself.',
      ),
    ],
  },
  {
    id: 'sound',
    title: 'Sound',
    summary: 'Playing music and sound effects through Audio Source components and `this.audio`.',
    blocks: [
      p(
        'An [AudioSource](api/AudioSource) component plays one audio clip. With **Play On Start** it begins when the scene starts, which together with **Loop** is all that background music needs. Scripts start, stop and query sources through [this.audio](api/AudioApi).',
      ),
      code(jukebox),
      list(
        "`audio.play(entity)` starts the entity's Audio Source from the beginning and returns `false` when it cannot, for instance when no clip is set.",
        "`audio.playOneShot(clip, volume, pitch)` plays a clip without any component. Use it for effects that may overlap, such as footsteps or shots. `clip` is an audio asset's id or name.",
        'Changing `volume` or `pitch` on an Audio Source affects the sound that is already playing.',
        '`audio.masterVolume` scales everything, from 0 to 1.',
      ),
      note(
        'Browsers only let a page make sound after the player has clicked it or pressed a key. Music set to play on start begins with that first interaction.',
      ),
    ],
  },
  {
    id: 'scenes-and-assets',
    title: 'Scenes and assets',
    summary: 'Finding entities, switching scenes, and looking up assets by name.',
    blocks: [
      code(levelExit),
      h('Finding entities'),
      list(
        '`this.scene.findByName(name)` returns the first entity with that name, or `null`.',
        '`this.scene.findByTag(tag)` returns every entity with that tag. Tags are set in the inspector, next to the name.',
        '`this.entity.findChild(name)`, `getComponentInChildren(Type)` and `getComponentInParent(Type)` search the hierarchy around an entity.',
        '`this.scene.mainCamera` is the entity whose camera the game is drawn from.',
      ),
      p(
        'Searching costs time in a large scene. Look an entity up once in `onStart` and keep it in a field, rather than searching every frame.',
      ),
      h('Switching scenes'),
      p(
        '`this.scene.load(name)` replaces the running scene once the current frame has finished. Every entity of the old scene is destroyed, their scripts get `onDestroy`, and `this.time.elapsed` and `frameCount` start again from zero. Values that must survive the switch have to be stored somewhere other than a script.',
      ),
      h('Assets'),
      p(
        "[this.assets](api/AssetsApi) looks assets up by name. A full path such as `Sprites/hero.png` must match exactly; a bare name such as `hero` matches an asset in any folder. `find` returns the asset's id, the same kind of value an asset property holds.",
      ),
      code(`const portrait = this.assets.find('Sprites/hero.png', 'texture');
if (portrait) {
  this.requireComponent(SpriteRenderer).texture = portrait;
}`),
    ],
  },
  {
    id: 'conventions',
    title: 'Conventions and pitfalls',
    summary: 'The units the engine uses everywhere, and the mistakes that are easiest to make.',
    blocks: [
      h('Conventions'),
      table(
        ['What', 'Convention'],
        ['Axes', 'X points right, Y points up.'],
        ['Angles', 'Radians, counter-clockwise. The inspector converts to degrees.'],
        ['Time', 'Seconds.'],
        ['Colors', 'Four numbers from 0 to 1: red, green, blue, alpha.'],
        [
          'Sizes',
          'World units. A sprite covers one unit per `pixelsPerUnit` pixels of its texture.',
        ],
        [
          'On the screen',
          'Pixels of the project resolution, measured from the corner, edge or center an entity is anchored to.',
        ],
        ['Keys', 'Named by `KeyboardEvent.code`: `KeyW`, `Space`, `ArrowLeft`.'],
        ['Assets', 'Referred to by id; `this.assets.find(name)` turns a name into an id.'],
      ),
      h('Pitfalls'),
      list(
        '**Using the engine in a constructor or field initializer.** `this.entity` and the other services exist from `onStart` onwards.',
        '**Changing a vector that belongs to something else.** `add`, `sub`, `scale` and the like modify the vector in place. Call `clone()` first unless changing the original is the point.',
        '**Forgetting `deltaTime`.** A speed that is not multiplied by it depends on the frame rate.',
        '**Reading `wasKeyPressed` in `onFixedUpdate`.** One-frame events belong in `onUpdate`.',
        '**Moving a dynamic body through its transform.** That teleports it. Use `physics.setVelocity`, `applyImpulse` or `applyForce`.',
        '**Expecting the first frame to have a duration.** The first `deltaTime` of a game can be 0.',
        '**Importing a script only for its side effects.** Imports that are never used are dropped when a script is compiled, as in TypeScript.',
        '**Calling `this.someMethod` from a timer or callback without an arrow function.** Write `() => this.someMethod()` so `this` stays the script.',
      ),
    ],
  },
];
