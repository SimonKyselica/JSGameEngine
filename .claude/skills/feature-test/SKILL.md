---
name: feature-test
description: Run, extend or debug the Rowan feature-test project, the scene that tests every component and the entire scripting API. Use when the feature test fails, when a check needs adding, or when asked to confirm that the engine works end to end.
---

# The feature-test project

`packages/feature-test` builds a complete Rowan project in code. Its "Main" scene has an entity
for every component, and its scripts call every member of the scripting API and compare the
result with what the documentation promises. A `TestHarness` script collects the results, then
loads the "Finish" scene, where `FinishProbe` closes the report.

The report is written to `globalThis.__ROWAN_FEATURE_TEST__`:

```ts
{ done: boolean, checks: { name, passed, detail }[], pending: string[] }
```

## Where it runs

| Where                                | Command                                              | What it adds                                          |
| ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------- |
| Headless, in Node                    | `npx vitest run packages/feature-test`               | Fast and deterministic; checks draw calls and sounds  |
| Editor play mode, real browser       | `npx playwright test -g "passes in the editor"`      | WebGL, Web Audio, real input events                   |
| Exported single HTML file, from disk | `npx playwright test -g "single-file export"`        | Export pipeline, precompiled scripts, minified player |
| Exported folder, from a web server   | `npx playwright test -g "folder export"`             | Loading assets over HTTP                              |
| By hand                              | `npm run dev`, then Help → Open Feature Test Project | Watching it; press Play                               |

The Playwright tests need a fresh build: run `npm run build` first, or use `npm run test:e2e`.

When run by hand, the input checks wait for you: hold and release Space, press D and W, move
the pointer onto the "Click me" button, press all three mouse buttons there, scroll the wheel
and move the pointer away again. Results appear in the Console panel; without input the scene
finishes after its 15 second timeout with the input checks failed.

Pressing Stop before the scene has finished is not a failure. The harness logs that it was
stopped and which checks it was still waiting for, and nothing else.

The probes check the scene as `project.ts` builds it. A copy of the project whose scene was
edited fails the checks for whatever was changed; the failing check's detail says what it found.
Help → Open Feature Test Project always opens a fresh copy.

## Files

- `src/project.ts`: builds the project: assets, the Main and Finish scenes, the Bullet prefab.
  Textures and sounds are generated in code, so there are no binary files to maintain.
- `src/scripts/*.ts`: the probe scripts, one per area (`MathProbe`, `EntityProbe`,
  `LifecycleProbe`, `PhysicsProbe`, `TriggerProbe`, `InputProbe`, `AudioProbe`, `RenderProbe`,
  `TextProbe`, `UiProbe`, `AnimationProbe`, `Spawner` with `Bullet`), plus `TestHarness` and
  `FinishProbe`.
- `src/scripts.ts`: imports every script as text. **A new script file must be added here.**
- `src/index.ts`: `createFeatureTestProject()`, the report accessors, and
  `driveFeatureTestInput`, which plays the input for the headless run.
- `src/featureTest.test.ts`: the headless run, plus the coverage guards.

## Adding a check

In the probe that owns the area, report through the harness:

```ts
const test = harnessOf(this);
test.check('Vec2.length', new Vec2(3, 4).length() === 5); // immediate
test.near('Physics2D.getMass', physics.getMass(entity), 1); // number with tolerance
test.expectLater('the ball bounced'); // in onStart
test.pass('the ball bounced'); // later, when it happens
test.settle('the ball bounced high', height > 2, `it reached ${height}`); // later, either way
```

A check announced with `expectLater` has to be closed with `pass` or `settle`. `check` does not
close it, and the scene would wait for it until the timeout.

Give every check a unique name that states the fact being checked. If the check needs something
in the scene, add the entity in `src/project.ts` and say in the script's doc comment what it
expects to find.

A probe that reports from `onDestroy` must take the harness in `onStart` and keep it
(`this.test = harnessOf(this)`). When the whole scene goes down, the harness may already have
been destroyed by the time the probe is told, and can then no longer be looked up.

Keep the scene deterministic: drive physics from `onFixedUpdate` and count steps, keep the
experiments apart in space so they do not collide (the layout is described in `project.ts`), and
never rely on wall-clock time or on the first frame having a non-zero delta.

## When it fails

- **A named check failed:** the name says which API member, the `detail` what was expected. Run
  the headless test first; it is the quickest loop.
- **Passes headless, fails in the browser:** suspect minification (class names are mangled),
  frame timing (the browser's frames are longer and irregular; the first has a delta of zero), or
  real input. The headless run uses unminified source and a fixed 1/60 s frame.
- **"did not happen within 15 seconds":** an `expectLater` was never passed. Look for an error in
  the game's log from the same script: an exception in a callback stops that callback, not the game.
- **"scripts exercise every member of ..." fails:** an API member is not mentioned in any probe.
  Add a real check for it; do not just mention the name.
- **The run is not deterministic** (the last headless test): something depends on time or on
  iteration order. Find it rather than loosening the test.
