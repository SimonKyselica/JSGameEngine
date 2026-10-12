/**
 * The public scripting API. Everything exported here is what a script gets from
 * `import { ... } from 'rowan'`.
 *
 * Anything added to this file must also be exercised by the feature-test project in
 * `packages/feature-test`; a unit test enforces this.
 */
export { AudioApi } from '../audio/audioSystem';
export { Input, MouseButton, type AxisName } from '../input/input';
export { Color } from '../math/color';
export { MathUtils } from '../math/mathUtils';
export { Vec2 } from '../math/vec2';
export { Physics2D, type RaycastHit } from '../physics/physicsSystem';
export {
  AudioSource,
  BoxCollider2D,
  Camera,
  CircleCollider2D,
  Identity,
  Rigidbody2D,
  ScriptComponent,
  SpriteRenderer,
  Transform,
  type BodyType,
} from '../scene/components';
export { Entity } from '../scene/entity';
export { Behaviour, type Collision, type ScriptLifecycle } from './behaviour';
export type { ScriptPropertyDefinition, ScriptPropertyDefinitions } from './scriptProperties';
export { AssetsApi, SceneApi, Time, type SpawnOptions } from './services';
