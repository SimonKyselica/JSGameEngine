import { Behaviour } from 'rowan';

/** A menu button: grows a little under the pointer and opens a scene when it is clicked. */
export default class MenuButton extends Behaviour {
  static properties = {
    level: { type: 'string', default: 'Level 1' },
  };

  level = 'Level 1';

  onPointerEnter() {
    this.transform.scale.set(1.1, 1.1);
  }

  onPointerExit() {
    this.transform.scale.set(1, 1);
  }

  onClick() {
    this.scene.load(this.level);
  }
}
