import { Behaviour } from 'rowan';

/** Steers by touch: a finger on the left half of the screen turns left, one on the right, right. */
export default class TouchSteering extends Behaviour {
  static properties = {
    turnSpeed: { type: 'number', default: 3 },
  };

  turnSpeed = 3;

  onUpdate(deltaTime: number) {
    // The camera looks at the middle of the screen, so its X divides left from right.
    const middle = this.scene.mainCamera?.worldPosition.x ?? 0;
    let turn = 0;
    for (const touch of this.input.touches) {
      turn += touch.worldPosition.x < middle ? 1 : -1;
    }
    // Two fingers, one on each side, cancel each other out.
    this.transform.rotation += turn * this.turnSpeed * deltaTime;
  }
}
