import { Behaviour, Color, SpriteRenderer, Vec2 } from 'rowan';

/** Swings back and forth around the place where it started. */
export default class Patrol extends Behaviour {
  static properties = {
    distance: { type: 'number', default: 3, min: 0, label: 'Distance (units)' },
    speed: { type: 'number', default: 2, min: 0, step: 0.5 },
    direction: { type: 'vec2', default: [1, 0] },
    tint: { type: 'color', default: [1, 1, 1, 1] },
    paused: { type: 'boolean', default: false },
  };

  // The values here are overwritten by the inspector before onStart runs.
  distance = 3;
  speed = 2;
  direction = new Vec2(1, 0);
  tint = new Color();
  paused = false;

  private readonly home = new Vec2();
  private phase = 0;

  onStart() {
    this.home.copy(this.transform.position);
    this.direction.normalize();
    const sprite = this.getComponent(SpriteRenderer);
    if (sprite) {
      sprite.color.copy(this.tint);
    }
  }

  onUpdate(deltaTime: number) {
    if (this.paused || this.distance === 0) {
      return;
    }
    this.phase += (this.speed / this.distance) * deltaTime;
    // A sine wave swings between -1 and 1, which becomes -distance and +distance.
    const offset = Math.sin(this.phase) * this.distance;
    this.transform.position.copy(this.home).add(this.direction.clone().scale(offset));
  }
}
