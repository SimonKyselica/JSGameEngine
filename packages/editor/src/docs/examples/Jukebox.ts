import { AudioSource, Behaviour } from 'rowan';

/** M switches the entity's Audio Source on and off, Space plays a one-off sound. */
export default class Jukebox extends Behaviour {
  static properties = {
    jingle: { type: 'audio' },
  };

  jingle: string | null = null;

  onUpdate(deltaTime: number) {
    const { audio, input, entity } = this;

    if (input.wasKeyPressed('KeyM')) {
      if (audio.isPlaying(entity)) {
        audio.stop(entity);
      } else {
        audio.play(entity);
      }
    }

    // A one-shot needs no Audio Source and can overlap with itself.
    if (this.jingle && input.wasKeyPressed('Space')) {
      audio.playOneShot(this.jingle, 0.8);
    }

    // Changes to the component reach a sound that is already playing.
    const source = this.getComponent(AudioSource);
    if (source && input.isKeyDown('ArrowDown')) {
      source.volume = Math.max(0, source.volume - deltaTime);
    }
  }
}
