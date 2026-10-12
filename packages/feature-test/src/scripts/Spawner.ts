import {
  Behaviour,
  Color,
  CircleCollider2D,
  SpriteRenderer,
  Vec2,
  type ScriptLifecycle,
  type ScriptPropertyDefinitions,
} from 'rowan';
import Bullet from './Bullet';
import { harnessOf } from './support';

/**
 * Exercises script properties of every type and prefab instantiation.
 *
 * Expects the inspector to set `count`, `label`, `offset`, `sprite`, `sound` and
 * `prefab`, leaving `fire` and `tint` at their defaults.
 */
export default class Spawner extends Behaviour implements ScriptLifecycle {
  static properties: ScriptPropertyDefinitions = {
    count: { type: 'number', default: 1, min: 0, max: 10, step: 1 },
    fire: { type: 'boolean', default: true },
    label: { type: 'string', default: 'bullet' },
    offset: { type: 'vec2', default: [0, 0] },
    tint: { type: 'color', default: [1, 0.5, 0, 1] },
    sprite: { type: 'texture' },
    sound: { type: 'audio' },
    prefab: { type: 'prefab' },
  };

  count = 1;
  fire = false;
  label = '';
  offset = new Vec2();
  tint = new Color();
  sprite: string | null = null;
  sound: string | null = null;
  prefab: string | null = null;

  onStart(): void {
    const test = harnessOf(this);
    test.check('number property set in the inspector', this.count === 2);
    test.check('boolean property falls back to its default', this.fire);
    test.check('string property set in the inspector', this.label === 'shot');
    test.check(
      'vec2 property arrives as a Vec2',
      this.offset instanceof Vec2 && this.offset.equals(new Vec2(1, 0)),
    );
    test.check(
      'color property arrives as a Color',
      this.tint instanceof Color && this.tint.equals(new Color(1, 0.5, 0, 1)),
    );
    test.check(
      'texture property holds an asset id',
      this.sprite !== null && this.sprite === this.assets.find('Textures/disc.png'),
    );
    test.check(
      'audio property holds an asset id',
      this.sound !== null && this.sound === this.assets.find('Sounds/beep.wav'),
    );
    test.check(
      'prefab property holds an asset id',
      this.prefab !== null && this.prefab === this.assets.find('Bullet', 'prefab'),
    );
    if (!this.prefab || !this.sound) {
      return;
    }

    test.expectLater('a spawned script keeps values set by its spawner');
    test.expectLater('a spawned entity destroys itself after its lifetime');

    const origin = this.entity.worldPosition.add(this.offset);
    const first = this.instantiate(this.prefab, {
      position: origin,
      rotation: Math.PI / 4,
      name: `${this.label} 1`,
    });
    test.check(
      'Behaviour.instantiate applies name, position and rotation',
      first.name === 'shot 1' &&
        first.worldPosition.equals(origin) &&
        Math.abs(first.worldRotation - Math.PI / 4) < 1e-6,
    );
    test.check(
      'an instantiated prefab has its components',
      first.hasComponent(SpriteRenderer) &&
        first.hasComponent(CircleCollider2D) &&
        first.parent === null,
    );

    const bullet = this.getScript(Bullet, first);
    test.check('a spawned script is available immediately', bullet instanceof Bullet);
    if (bullet) {
      bullet.damage = 7;
    }
    const sprite = first.requireComponent(SpriteRenderer);
    sprite.texture = this.sprite;
    sprite.color.copy(this.tint);
    this.physics.setVelocity(first, new Vec2(3, 0));

    const second = this.instantiate('Bullet', { parent: this.entity });
    test.check(
      'Behaviour.instantiate by name with a parent',
      second.parent === this.entity && second.transform.position.equals(Vec2.zero()),
    );
    test.check(
      'instantiated copies are independent',
      second.uuid !== first.uuid && this.scene.findByTag('bullet').length === this.count,
    );

    test.check('an audio property can be played', this.audio.playOneShot(this.sound));
  }
}
