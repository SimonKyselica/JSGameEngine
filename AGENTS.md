# Rowan: guide for contributors and coding agents

Rowan is a 2D game engine and editor that runs natively in the browser. It is meant to be
production software: stable, fully tested and deployable. This file holds the rules that keep
it that way. Read it before changing anything; `Instructions.md` is the product brief.

## Layout

| Path                    | What it is                                                                                         | May depend on                     |
| ----------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------- |
| `packages/core`         | The engine library: math, ECS, scenes, assets, renderer, audio, input, physics, scripting, `Game`. | `planck`, `sucrase` only          |
| `packages/runtime`      | The player: the stripped runtime that exported games ship with (`rowan-player.js`).                | `core` (never the compiler)       |
| `packages/feature-test` | One project that uses every component and the whole scripting API, and checks itself.              | `core`                            |
| `packages/editor`       | The Unity-style editor (React). `src/core` is plain logic, `src/ui` is React.                      | `core`, `runtime`, `feature-test` |
| `e2e`                   | Playwright tests that drive the built editor and exported games in a real browser.                 | everything, through the browser   |

Dependencies only point upwards in this table. In particular:

- `core` knows nothing about React or the editor.
- The script compiler lives in the separate entry `@rowan/core/compiler`. The player must never
  import it: exported games ship their scripts precompiled.
- `packages/editor/src/core` must not import React or touch the DOM. That is what keeps the
  editor's behaviour unit-testable. Anything that needs the DOM belongs in `src/ui`.

## Commands

```sh
npm install            # once
npm run dev            # build the player, then start the editor at http://localhost:5173
npm run check          # typecheck + lint + format check + unit tests (run before every commit)
npm run test:e2e       # build everything, then run the browser tests (Chromium and WebKit)
npm run test:coverage  # unit tests with a coverage report in coverage/
npm run build          # build the core library, the player and the editor
npm run format         # apply Prettier
```

Run one unit test file with `npx vitest run packages/core/src/physics`, one browser test with
`npx playwright test -g "part of its name"`. The browser tests run the **built** editor, so
rebuild (`npm run build`) after changing source before running Playwright by hand.

## Definition of done

A change is done when all of this is true:

1. It has unit tests next to the code (`foo.ts` is tested by a `*.test.ts` in the same folder)
   that fail without the change.
2. If it adds or changes a component or anything scripts can call, the feature-test project
   exercises it (see "The feature test" below). A unit test enforces this.
3. If it touches the renderer, the player, the exporter or the editor UI, the browser tests pass.
4. `npm run check` passes with no warnings.
5. You have read your own diff as a reviewer would, and fixed what you found. Review happens
   **before** the commit, never after.

Then commit with a message that says what changed and why, and push to `main`.

## Code style

TypeScript, strict mode, formatted by Prettier, linted by ESLint with type information. Beyond
what the tools enforce:

- **Names.** `PascalCase` for classes, types and components; `camelCase` for everything else;
  `UPPER_SNAKE_CASE` for module-level constants. Files are named after what they export:
  `sceneRenderer.ts`, `InspectorPanel.tsx`. No abbreviations a newcomer would have to look up.
- **Comments say why, not what.** Every exported symbol has a doc comment that says what it is
  for. Inside functions, comment only what the code cannot say: a reason, a trap, a unit.
- **Units and conventions are stated once and kept everywhere:** world Y points up, angles are
  radians (the inspector converts to degrees), colors are straight-alpha floats from 0 to 1,
  time is in seconds, sizes in world units unless a name says pixels.
- **Errors.** Throw `RowanError` with a message a game developer can act on: say what is wrong
  and what to do. Validate data at the boundary (loading files, user input, script calls) and
  trust it inside. Never swallow an error silently: handle it, log it through the `Logger`, or
  let it propagate.
- **A script must never be able to crash the engine.** Calls into user code are wrapped and
  logged. Values that come from scripts and reach the physics solver are sanitized.
- **No `console.*`** outside `core/logger.ts`. Use the `Logger` so messages reach the editor's
  console.
- **Do not rely on class or function names at runtime** (`type.name`, `constructor.name`).
  Production builds are minified and the names are gone. Components carry their name in
  `schema.name`; use `getComponentTypeName`.
- **Hot paths do not allocate.** Code that runs per entity per frame reuses scratch objects
  (see `SceneRenderer`, `PhysicsSystem`). Everywhere else, prefer clarity.
- **Side effects stay out of module scope.** Importing a module must not register, mutate or
  start anything.
- **Serialized formats are versioned.** Scenes, prefabs, projects and game bundles carry a
  `format` and a `version`. Never change the meaning of an existing field: bump the version and
  migrate in the parser. Component `schema.name` values are part of the format.
- **No shortcuts.** No `any`, no `@ts-ignore`, no disabled lint rule without a comment that
  explains why this case is the exception.

## Testing

- Unit tests use Vitest and run in Node. Tests that need a DOM start with
  `// @vitest-environment happy-dom`.
- The engine is testable without a browser on purpose: `HeadlessRenderer` records draw calls,
  `NullAudioBackend` records sounds, `InputState` takes synthetic events, and
  `createHeadlessGame` wires them into a real `Game`. Use them instead of mocks.
- Test behaviour, not implementation. A test name states a fact about the engine
  ("rests dynamic bodies on static colliders"). Assert on the specific value you expect.
- Physics and timing tests step the game with a fixed delta so they are deterministic. Do not
  write tests that depend on wall-clock time.
- The first frame of a game loop reports a delta of zero. Code and tests must cope with it.
- Browser tests must not depend on frame rate: wait for a state, never for a duration.

### The feature test

`packages/feature-test` is a real project whose "Main" scene contains every component and whose
scripts (`src/scripts/*.ts`) call every member of the scripting API and check the result. It runs
in three places: headless in `featureTest.test.ts`, in the editor's play mode, and as an exported
game in both export formats (`e2e/featureTest.spec.ts`).

`featureTest.test.ts` reflects over the scripting API and the component schemas and fails when
something exists that no feature script mentions. So when you add an API member or a component
field, add a check for it to the matching probe script, or the build goes red.

The scripts are ordinary TypeScript files, type-checked against the real API through the `rowan`
path alias, and loaded as text because the engine compiles scripts itself.

## Recipes

Step-by-step versions of these live in `.claude/skills/`.

- **New component:** add the class and its `schema` to `scene/components.ts`, add it to
  `COMPONENT_TYPES`, export it from `scripting/api.ts`, give it behaviour in a system, and cover
  it in the feature test. Serialization, cloning, prefabs and the inspector follow from the schema.
- **New scripting API:** add it to the facade class the script reaches (`Behaviour`, `SceneApi`,
  `Input`, `Physics2D`, `AudioApi`, `AssetsApi`, `Time`) and exercise it in a probe script.
- **New asset type:** extend `AssetType` and the extension table in `assets/asset.ts`, handle it
  in `editor/src/core/assetImport.ts` and in the Project panel, and in the bundle code if the
  player needs it.

## Traps that have already cost time

- **Chromium is not every browser.** WebKit kept the caret in a script editor that had been
  hidden, so keys meant for the game were typed into the script. The browser tests run in
  WebKit as well for that reason. An element that is hidden while it has the focus must give
  the focus up explicitly.
- **Minification changes behaviour.** Unit tests run unminified source; only the browser tests
  run what users get. The feature test caught an error message built from a mangled class name.
- **`destroy(entity, delay)` counts from the call.** The frame's own delta has already passed
  when a script asks for a delay.
- **Unused imports are dropped** by the script compiler, as TypeScript does. A script that
  imports a module only for its side effects will not load it.
- **Literal U+2028/U+2029 in source** end a line inside string and regex literals. Write them as
  `\u2028` escapes.
- **`Instructions.md` is the owner's file.** Do not reformat or edit it; it is in `.prettierignore`.
- **Reading the WebGL canvas** only works inside an animation frame, right after drawing; the
  drawing buffer is cleared after it is presented (`e2e/support.ts` shows how).
