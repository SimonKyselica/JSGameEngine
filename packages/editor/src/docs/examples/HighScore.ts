import { Behaviour, TextRenderer } from 'rowan';

/** Shows the best score so far, and remembers a new one for the next time the game is opened. */
export default class HighScore extends Behaviour {
  private best = 0;

  onStart() {
    // 0 is what a player gets who has never played before.
    this.best = this.storage.get('highScore', 0);
    this.show();
  }

  /** For the script that keeps the score to call when a round is over. */
  report(score: number) {
    if (score > this.best) {
      this.best = score;
      this.storage.set('highScore', score);
      this.show();
    }
  }

  private show() {
    this.requireComponent(TextRenderer).text = `Best: ${this.best}`;
  }
}
