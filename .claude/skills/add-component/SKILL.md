---
name: add-component
description: Add a new component type to the Rowan engine, or add a field to an existing component. Use when asked for a new component, a new field on a component, or a new kind of entity behaviour that is data plus a system.
---

# Add or extend a component

Components are plain data classes described by a schema. The schema drives serialization,
cloning, prefabs, undo and the editor's inspector, so most of the work is declaring the data
correctly. Behaviour lives in a system, never in the component.

## Steps

1. **Declare the data** in `packages/core/src/scene/components.ts`:

   ```ts
   /** One sentence on what the component does to its entity. */
   export class Light2D {
     static readonly schema: ComponentSchema = {
       name: 'Light2D', // serialized name: never rename without a migration
       displayName: 'Light 2D',
       category: 'Rendering', // group in the Add Component menu
       removable: true,
       fields: {
         color: { type: 'color' },
         radius: { type: 'number', min: 0 },
       },
     };

     color = Color.white();
     /** Reach of the light in world units. */
     radius = 5;
   }
   ```

   - Every field needs a default value and an entry in `fields`. Field types are listed in
     `scene/schema.ts`: `number`, `angle`, `boolean`, `string`, `vec2`, `color`, `enum`, `asset`,
     `json`.
   - State the unit in the doc comment (world units, radians, seconds).
   - The class needs a zero-argument constructor and must not hold runtime state such as GPU
     handles or physics bodies. Systems keep that in their own maps keyed by entity id.

2. **Register it** by adding the class to `COMPONENT_TYPES` in the same file. The position in
   the list is the order in the inspector and the Add Component menu.

3. **Make it available to scripts** by exporting the class from
   `packages/core/src/scripting/api.ts`.

4. **Give it behaviour.** Add or extend a system that reads the component each frame. Follow
   `PhysicsSystem`: treat the component as the source of truth and reconcile with it every step,
   so changes made by scripts or the inspector just work. Start and stop the system from
   `SceneRuntime`. Skip entities whose `activeInHierarchy` is false.

5. **Test it.**
   - Unit tests for the system next to it, using `HeadlessRenderer`, `NullAudioBackend` or
     `createHeadlessGame` rather than mocks.
   - The schema tests in `scene/serializer.test.ts` already cover serialization of every
     registered component. Add the new component to `createFullScene()` there with non-default
     values so the round-trip test exercises it.
   - Add invalid-data cases to the `rejects invalid data` table if the fields have constraints.

6. **Cover it in the feature test** (`packages/feature-test`):
   - Put an entity with the component into the Main scene in `src/project.ts`.
   - Read or write every field from a probe script in `src/scripts/` and check the effect.
   - `npx vitest run packages/feature-test` fails until every field is mentioned.

7. **Editor.** Nothing to do for standard field types: the inspector is generated from the
   schema. Only add UI when a field needs a custom control, as `ScriptComponent` does in
   `packages/editor/src/ui/InspectorPanel.tsx`. If entities with the component should be easy to
   create, add a preset to `packages/editor/src/core/entityPresets.ts`. If it has a shape worth
   seeing in the scene view, draw it in `packages/editor/src/core/overlay.ts`.

8. Run the `verify-changes` skill.

## Adding a field to an existing component

Do steps 1 (field, default, schema entry), 5 and 6. Old scenes keep working because missing
fields keep their defaults when a scene is loaded. Changing the meaning or type of an existing
field is a format change: bump `SCENE_VERSION` in `scene/serializer.ts` and migrate old data in
`parseEntities`.
