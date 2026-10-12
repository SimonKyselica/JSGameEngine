import { Behaviour } from 'rowan';

/** Turns its entity around at a steady speed. */
export default class Spinner extends Behaviour {
  static properties = {
    turnsPerSecond: { type: 'number', default: 0.5 },
  };

  turnsPerSecond = 0.5;

  onUpdate(deltaTime: number) {
    // A full turn is 2π radians. Multiplying by deltaTime makes the speed
    // the same on every computer, however many frames it draws per second.
    this.transform.rotation += this.turnsPerSecond * Math.PI * 2 * deltaTime;
  }
}
