---
name: extend-scripting-api
description: Add or change something game scripts can call in Rowan, such as a method on Behaviour, Input, Physics2D, AudioApi, SceneApi, AssetsApi, Time, Entity, Vec2 or Color, a new lifecycle callback, or a new script property type. Use for any change to the scripting API.
---

# Extend the scripting API

Scripts are TypeScript classes that extend `Behaviour` and import from the module `rowan`. That
module is exactly what `packages/core/src/scripting/api.ts` exports. The API is a promise to game
developers: once shipped, a member keeps its name and meaning.

## Where things go

| What the script writes      | Where it is defined                                               |
| --------------------------- | ----------------------------------------------------------------- |
| `this.someMethod()`         | `Behaviour` in `scripting/behaviour.ts`                           |
| `this.scene`, `this.assets` | `SceneApi`, `AssetsApi` in `scripting/services.ts`                |
| `this.time`                 | `Time` in `scripting/services.ts`                                 |
| `this.input`                | `Input` in `input/input.ts` (reads `InputState`)                  |
| `this.physics`              | `Physics2D` in `physics/physicsSystem.ts` (wraps `PhysicsSystem`) |
| `this.audio`                | `AudioApi` in `audio/audioSystem.ts` (wraps `AudioSystem`)        |
| `entity.someMethod()`       | `Entity` in `scene/entity.ts`                                     |
| `onSomething()` callbacks   | `ScriptLifecycle` in `scripting/behaviour.ts`                     |
| `static properties` types   | `scripting/scriptProperties.ts`                                   |

Scripts get thin facade classes (`Physics2D`, `AudioApi`, ...), not the systems themselves, so
they cannot reach methods such as `step()` or `stop()`. Put the logic in the system and a
one-line forwarder in the facade.

## Steps

1. **Implement** the behaviour in the system, with a doc comment that states units and what
   happens in the edge cases (missing component, destroyed entity, zero vector).
2. **Expose it** on the facade. Make failures actionable: throw a `RowanError` that says what is
   missing and how to fix it. The script system catches it and logs it with the script's name, so
   the game keeps running.
3. **Export** any new class or type from `scripting/api.ts`.
4. **Unit-test** it next to the system, including the failure cases.
5. **Exercise it in the feature test.** Add a check to the matching probe in
   `packages/feature-test/src/scripts/`:

   ```ts
   test.check('Physics2D.getMass', physics.getMass(entity) === 1);
   ```

   For something that happens later, announce it and pass it when it happens:

   ```ts
   test.expectLater('onTriggerEnter reports the entering entity'); // in onStart
   this.test.pass('onTriggerEnter reports the entering entity'); // in the callback
   ```

   `featureTest.test.ts` reflects over the API and fails until the new member's name appears in
   a probe script. For members of an interface (`ScriptLifecycle`, `Collision`, `RaycastHit`,
   `SpawnOptions`, `ScriptPropertyDefinition`) also add the name to the matching list in that
   test; the compiler tells you when one is missing.

6. **Document it.** The doc comment on the member is the text of the scripting reference
   (Help → Scripting Reference in the editor), so write it for a game developer: what the member
   does, its units, what it returns in the edge cases. Then regenerate the reference and commit
   the changed JSON:

   ```sh
   npm run docs:generate
   npx vitest run packages/editor/src/docs
   ```

   The test fails when the reference is stale, when a member has no comment, and when a new
   exported type is missing from `REFERENCE_GROUPS` in `packages/editor/src/docs/docsModel.ts`.
   If the feature deserves an explanation or an example, add it to the matching guide in
   `packages/editor/src/docs/guides.ts`; example scripts go in `docs/examples/` as real files.

7. **Check the whole run:** `npx vitest run packages/feature-test`, then `npm run test:e2e`
   because the same scripts must pass in the minified player.
8. Run the `verify-changes` skill.

## Rules

- Never rename or remove a member, or change what it returns, without a deprecation path.
- Getters that return vectors or colors return copies, unless the doc comment says the object is
  live (component fields such as `transform.position` are live).
- Checks in probe scripts must be deterministic: drive physics from `onFixedUpdate` and count
  steps, never compare against wall-clock time, and do not assume the first frame has a
  non-zero delta.
- New lifecycle callback: add it to `ScriptLifecycle`, call it from `ScriptSystem` through
  `this.call(...)` so exceptions are caught, and define when it runs relative to the others.
- New script property type: add it to `SCRIPT_PROPERTY_TYPES`, handle it in `isValidStoredValue`,
  `getEmptyStoredValue` and `toRuntimeValue`, and give it a control in `ScriptPropertyField` in
  `packages/editor/src/ui/InspectorPanel.tsx`. The `Spawner` probe declares one property of each
  type.
