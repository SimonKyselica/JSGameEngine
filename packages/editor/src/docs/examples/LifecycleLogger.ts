import { Behaviour, type Collision, type Entity } from 'rowan';

/** Logs every callback the first time the engine calls it. */
export default class LifecycleLogger extends Behaviour {
  private readonly seen = new Set<string>();

  onStart() {
    this.report('onStart', 'once, before the first update');
  }

  onFixedUpdate(fixedDeltaTime: number) {
    this.report('onFixedUpdate', `every ${fixedDeltaTime.toFixed(4)} seconds, before physics`);
  }

  onUpdate(deltaTime: number) {
    this.report('onUpdate', `every frame; this one took ${deltaTime.toFixed(4)} seconds`);
  }

  onLateUpdate() {
    this.report('onLateUpdate', 'every frame, after all onUpdate calls');
  }

  onCollisionEnter(collision: Collision) {
    this.report('onCollisionEnter', `touched ${collision.other.name}`);
  }

  onTriggerEnter(other: Entity) {
    this.report('onTriggerEnter', `entered ${other.name}`);
  }

  onDestroy() {
    this.log('onDestroy: the entity was destroyed or the scene ended');
  }

  private report(callback: string, when: string) {
    if (!this.seen.has(callback)) {
      this.seen.add(callback);
      this.log(`${callback}: ${when}`);
    }
  }
}
