import {
  Behaviour,
  BoxCollider2D,
  Identity,
  ScriptComponent,
  SpriteRenderer,
  Transform,
  Vec2,
  type Entity,
  type ScriptLifecycle,
} from 'rowan';
import { harnessOf } from './support';
import type TestHarness from './TestHarness';

/**
 * Exercises entities, components, the hierarchy and the scene API.
 *
 * Expects to sit on "Entity Probe" (tag `probe`, position (2, 1), rotated 90 degrees,
 * scale 2) with a single child "Probe Child" at local position (1, 0).
 */
export default class EntityProbe extends Behaviour implements ScriptLifecycle {
  private test!: TestHarness;
  private deferred: Entity | null = null;
  private delayed: Entity | null = null;

  onStart(): void {
    this.test = harnessOf(this);
    this.checkIdentity();
    this.checkHierarchy();
    this.checkComponents();
    this.checkScene();
    this.checkDestruction();
  }

  onUpdate(): void {
    const { test, time } = this;
    if (time.frameCount === 2) {
      test.check(
        'Behaviour.destroy removes the entity after the frame',
        this.deferred?.isValid === false,
      );
      test.check('Behaviour.destroy with a delay waits', this.delayed?.isValid === true);
    }
    if (this.delayed && !this.delayed.isValid) {
      test.check('Behaviour.destroy with a delay fires after the delay', time.elapsed >= 0.2);
      test.pass('delayed destroy happened');
      this.delayed = null;
    }
  }

  private checkIdentity(): void {
    const { test, entity } = this;
    test.check('Entity.name', entity.name === 'Entity Probe');
    test.check('Entity.tag', entity.tag === 'probe');
    test.check('Entity.uuid', entity.uuid.length > 0);
    test.check('Entity.id', typeof entity.id === 'number');
    test.check('Entity.isValid', entity.isValid);
    test.check('Entity.toString', entity.toString() === 'Entity(Entity Probe)');
    test.check('Entity.scene', entity.scene.name === this.scene.name);
    test.check('Behaviour.entity and transform', this.transform === entity.transform);

    const identity = this.requireComponent(Identity);
    test.check(
      'Identity fields',
      identity.name === entity.name &&
        identity.tag === 'probe' &&
        identity.uuid === entity.uuid &&
        identity.active,
    );
    entity.name = 'Renamed';
    entity.tag = 'renamed';
    test.check(
      'Entity.name and tag can be set',
      identity.name === 'Renamed' && identity.tag === 'renamed',
    );
    entity.name = 'Entity Probe';
    entity.tag = 'probe';

    const transform = this.requireComponent(Transform);
    test.check('Transform.position', transform.position.equals(new Vec2(2, 1)));
    test.near('Transform.rotation', transform.rotation, Math.PI / 2);
    test.check('Transform.scale', transform.scale.equals(new Vec2(2, 2)));
  }

  private checkHierarchy(): void {
    const { test, entity } = this;
    const child = entity.children[0];
    test.check('Entity.children', entity.children.length === 1 && child?.name === 'Probe Child');
    if (!child) {
      return;
    }
    test.check('Entity.parent', child.parent === entity && entity.parent === null);
    // Local (1, 0) is scaled to (2, 0), rotated to (0, 2) and moved by (2, 1).
    test.check('Entity.worldPosition', child.worldPosition.equals(new Vec2(2, 3)));
    test.near('Entity.worldRotation', child.worldRotation, Math.PI / 2);

    child.setWorldPosition(new Vec2(2, 5));
    test.check('Entity.setWorldPosition', child.transform.position.equals(new Vec2(2, 0)));
    child.setWorldRotation(Math.PI);
    test.near('Entity.setWorldRotation', child.transform.rotation, Math.PI / 2);

    child.setParent(null);
    test.check(
      'Entity.setParent keeps the world transform',
      child.parent === null && child.worldPosition.equals(new Vec2(2, 5)),
    );
    child.setParent(entity, false);
    test.check(
      'Entity.setParent can keep the local transform',
      child.parent === entity && child.transform.position.equals(new Vec2(2, 5)),
    );

    test.check('Entity.active defaults to true', child.active && child.activeInHierarchy);
    entity.active = false;
    test.check(
      'Entity.activeInHierarchy follows the parent',
      child.active && !child.activeInHierarchy,
    );
    entity.active = true;
    child.active = false;
    test.check('Entity.active can be switched off', !child.activeInHierarchy);
    child.active = true;
  }

  private checkComponents(): void {
    const { test, entity } = this;
    test.check(
      'Behaviour.hasComponent',
      this.hasComponent(Transform) && !this.hasComponent(SpriteRenderer),
    );
    test.check('Behaviour.getComponent', this.getComponent(SpriteRenderer) === undefined);
    const sprite = this.addComponent(SpriteRenderer, { sortingOrder: 3, visible: false });
    test.check(
      'Behaviour.addComponent',
      sprite.sortingOrder === 3 && this.getComponent(SpriteRenderer) === sprite,
    );
    test.check('Behaviour.requireComponent', this.requireComponent(SpriteRenderer) === sprite);
    test.check(
      'Behaviour.removeComponent',
      this.removeComponent(SpriteRenderer) && !this.hasComponent(SpriteRenderer),
    );

    const collider = entity.addComponent(BoxCollider2D, { isTrigger: true });
    test.check('Entity.addComponent', collider.isTrigger && entity.hasComponent(BoxCollider2D));
    test.check(
      'Entity.getComponent and requireComponent',
      entity.getComponent(BoxCollider2D) === collider &&
        entity.requireComponent(BoxCollider2D) === collider,
    );
    test.check(
      'Entity.removeComponent',
      entity.removeComponent(BoxCollider2D) && !entity.hasComponent(BoxCollider2D),
    );

    let message = '';
    try {
      this.requireComponent(BoxCollider2D);
    } catch (error) {
      message = String(error);
    }
    test.check(
      'requireComponent throws for a missing component',
      message.includes('no BoxCollider2D'),
    );

    const scripts = this.requireComponent(ScriptComponent).scripts;
    test.check('ScriptComponent.scripts', scripts.length === 1 && scripts[0]?.enabled === true);
    test.check(
      'Behaviour.getScript by class and name',
      this.getScript(EntityProbe) === this && this.getScript('EntityProbe') === this,
    );
    test.check('Behaviour.enabled', this.enabled);
  }

  private checkScene(): void {
    const { test, scene } = this;
    test.check('SceneApi.name', scene.name === 'Main');
    test.check('SceneApi.entities', scene.entities.includes(this.entity));
    test.check(
      'SceneApi.findByName',
      scene.findByName('Entity Probe') === this.entity && scene.findByName('Nobody') === null,
    );
    test.check(
      'SceneApi.findByTag',
      scene.findByTag('probe').length === 1 && scene.findByTag('nothing').length === 0,
    );
    test.check('SceneApi.mainCamera', scene.mainCamera?.name === 'Main Camera');

    const created = scene.createEntity('Created', this.entity);
    test.check(
      'SceneApi.createEntity',
      created.parent === this.entity && scene.findByName('Created') === created,
    );
    created.destroy();
    test.check(
      'Entity.destroy is immediate',
      !created.isValid && scene.findByName('Created') === null,
    );
  }

  private checkDestruction(): void {
    const { test, scene } = this;
    this.deferred = scene.createEntity('Deferred');
    this.destroy(this.deferred);
    test.check('Behaviour.destroy waits for the end of the frame', this.deferred.isValid);

    this.delayed = scene.createEntity('Delayed');
    this.destroy(this.delayed, 0.2);
    test.expectLater('delayed destroy happened');
  }
}
