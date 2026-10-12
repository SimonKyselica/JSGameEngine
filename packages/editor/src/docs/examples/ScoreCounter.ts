import { Behaviour, TextRenderer } from 'rowan';

/** Keeps a score and writes it into the Text Renderer of its entity. */
export default class ScoreCounter extends Behaviour {
  static properties = {
    prefix: { type: 'string', default: 'Score: ' },
  };

  prefix = 'Score: ';
  private score = 0;
  private label!: TextRenderer;

  onStart() {
    this.label = this.requireComponent(TextRenderer);
    this.show();
  }

  /** For other scripts to call: `this.getScript(ScoreCounter, hud)?.add(10)`. */
  add(points: number) {
    this.score += points;
    this.show();
  }

  private show() {
    this.label.text = `${this.prefix}${this.score}`;
    // Turn gold once the score is worth showing off.
    this.label.color.set(1, this.score >= 100 ? 0.8 : 1, this.score >= 100 ? 0.2 : 1);
  }
}
