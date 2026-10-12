import { Behaviour, Vec2 } from 'rowan';

/** Fires copies of a prefab to the right, a few times per second. */
export default class Turret extends Behaviour {
  static properties = {
    bullet: { type: 'prefab' },
    shotsPerSecond: { type: 'number', default: 2, min: 0.1 },
    bulletSpeed: { type: 'number', default: 10 },
  };

  bullet: string | null = null;
  shotsPerSecond = 2;
  bulletSpeed = 10;

  onStart() {
    this.every(1 / this.shotsPerSecond, () => this.fire());
  }

  private fire() {
    if (!this.bullet) {
      this.warn('No bullet prefab is assigned in the inspector');
      return;
    }
    const muzzle = this.entity.worldPosition.add(new Vec2(0.75, 0));
    const shot = this.instantiate(this.bullet, { position: muzzle });

    // The prefab needs a Rigidbody 2D for this; without one, setVelocity reports an error.
    this.physics.setVelocity(shot, new Vec2(this.bulletSpeed, 0));

    // Bullets that hit nothing would otherwise pile up forever.
    this.destroy(shot, 3);
  }
}
