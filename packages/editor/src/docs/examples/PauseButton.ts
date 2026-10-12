import { Behaviour, TextRenderer } from 'rowan';

/** Pauses the game and resumes it. Its own text says what a click will do. */
export default class PauseButton extends Behaviour {
  onClick() {
    const paused = this.time.timeScale === 0;
    this.time.timeScale = paused ? 1 : 0;
    this.requireComponent(TextRenderer).text = paused ? 'Pause' : 'Resume';
  }
}
