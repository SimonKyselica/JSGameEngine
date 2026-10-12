import { Behaviour, MouseButton, Vec2 } from 'rowan';

/** Moves with WASD or the arrow keys, and jumps to wherever the mouse is clicked. */
export default class KeyboardMover extends Behaviour {
  static properties = {
    speed: { type: 'number', default: 4, min: 0 },
  };

  speed = 4;

  onUpdate(deltaTime: number) {
    const { input } = this;

    // Each axis is -1, 0 or 1. Normalizing keeps diagonal movement from being faster.
    const move = new Vec2(input.getAxis('horizontal'), input.getAxis('vertical')).normalize();
    this.transform.position.add(move.scale(this.speed * deltaTime));

    // "was pressed" is true for one frame; "is down" for as long as the key is held.
    if (input.wasKeyPressed('Space')) {
      this.log('Space went down in this frame');
    }
    if (input.isKeyDown('KeyQ')) {
      this.transform.rotation += deltaTime;
    }

    if (input.wasMouseButtonPressed(MouseButton.Left)) {
      this.entity.setWorldPosition(input.mouseWorldPosition);
    }
  }
}
