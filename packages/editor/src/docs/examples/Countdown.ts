import { Behaviour, type CancelTimer } from 'rowan';

/** Counts down from three, then ticks twice a second until Escape is pressed. */
export default class Countdown extends Behaviour {
  private stopTicking: CancelTimer | null = null;

  onStart() {
    this.log('3');
    this.after(1, () => this.log('2'));
    this.after(2, () => this.log('1'));
    this.after(3, () => {
      this.log('Go!');
      let ticks = 0;
      this.stopTicking = this.every(0.5, () => {
        ticks++;
        this.log('Tick', ticks);
      });
    });
  }

  onUpdate() {
    if (this.stopTicking && this.input.wasKeyPressed('Escape')) {
      this.stopTicking();
      this.stopTicking = null;
    }
  }
}
