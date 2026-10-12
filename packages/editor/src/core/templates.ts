import {
  BoxCollider2D,
  Camera,
  Color,
  createDefaultSettings,
  Project,
  Rigidbody2D,
  Scene,
  ScriptComponent,
  serializeScene,
  SpriteRenderer,
  type AssetDatabase,
  type AssetRecord,
} from '@rowan/core';

const PLAYER_SCRIPT = `import { Behaviour, Vec2 } from 'rowan';

/** Moves the entity left and right with A/D or the arrow keys, and jumps with Space. */
export default class PlayerController extends Behaviour {
  static properties = {
    speed: { type: 'number', default: 5, min: 0 },
    jumpSpeed: { type: 'number', default: 7, min: 0 },
  };

  speed = 5;
  jumpSpeed = 7;
  private grounded = false;

  onUpdate() {
    if (this.grounded && this.input.wasKeyPressed('Space')) {
      const mass = this.physics.getMass(this.entity);
      this.physics.applyImpulse(this.entity, new Vec2(0, this.jumpSpeed * mass));
      this.grounded = false;
    }
  }

  onFixedUpdate() {
    const velocity = this.physics.getVelocity(this.entity);
    velocity.x = this.input.getAxis('horizontal') * this.speed;
    this.physics.setVelocity(this.entity, velocity);
  }

  onCollisionEnter(collision) {
    // A normal that points down means the other entity is underneath.
    if (collision.normal.y < -0.5) {
      this.grounded = true;
    }
  }
}
`;

/** The project a user starts from: a small scene that already does something on Play. */
export function createStarterProject(name = 'New Project'): Project {
  const project = new Project(createDefaultSettings(name));
  const script = project.assets.create({
    name: 'Scripts/PlayerController.ts',
    type: 'script',
    mimeType: 'text/typescript',
    data: PLAYER_SCRIPT,
  });

  const scene = new Scene('Main');
  scene.createEntity('Main Camera').addComponent(Camera);

  const ground = scene.createEntity('Ground');
  ground.transform.position.set(0, -3);
  ground.transform.scale.set(14, 1);
  ground.addComponent(SpriteRenderer, { color: new Color(0.33, 0.62, 0.38, 1) });
  ground.addComponent(BoxCollider2D);

  const player = scene.createEntity('Player');
  player.tag = 'player';
  player.addComponent(SpriteRenderer, { color: new Color(0.3, 0.6, 1, 1), sortingOrder: 1 });
  player.addComponent(Rigidbody2D, { fixedRotation: true });
  player.addComponent(BoxCollider2D, { friction: 0 });
  player.addComponent(ScriptComponent, {
    scripts: [{ script: script.id, enabled: true, properties: {} }],
  });

  for (const [index, x] of [3, 3.4, 3.2].entries()) {
    const crate = scene.createEntity('Crate');
    crate.transform.position.set(x, -2 + index * 1.05);
    crate.addComponent(SpriteRenderer, { color: new Color(0.82, 0.6, 0.36, 1) });
    crate.addComponent(Rigidbody2D);
    crate.addComponent(BoxCollider2D);
  }

  project.settings.startScene = addSceneAsset(project.assets, scene).id;
  return project;
}

/** Stores a scene as a new scene asset. */
export function addSceneAsset(assets: AssetDatabase, scene: Scene, folder = 'Scenes'): AssetRecord {
  return assets.create({
    name: `${folder}/${scene.name}.scene`,
    type: 'scene',
    mimeType: 'application/json',
    data: JSON.stringify(serializeScene(scene), null, 2),
  });
}

/** A scene with just a camera, which is what "New Scene" creates. */
export function createEmptyScene(name: string): Scene {
  const scene = new Scene(name);
  scene.createEntity('Main Camera').addComponent(Camera);
  return scene;
}

/** The source of a newly created script. The class is named after the file. */
export function createScriptSource(fileName: string): string {
  const className = toClassName(fileName);
  return `import { Behaviour } from 'rowan';

export default class ${className} extends Behaviour {
  // Properties listed here can be edited in the inspector.
  static properties = {
    speed: { type: 'number', default: 1 },
  };

  speed = 1;

  /** Called once, before the first update. */
  onStart() {}

  /** Called every frame. deltaTime is the time since the last frame, in seconds. */
  onUpdate(deltaTime: number) {
    this.transform.rotation += this.speed * deltaTime;
  }
}
`;
}

/** Turns a file name such as `enemy-ai.ts` into a valid class name such as `EnemyAi`. */
export function toClassName(fileName: string): string {
  const baseName = fileName.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
  const words = baseName.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (name === '') {
    return 'NewScript';
  }
  return /^[0-9]/.test(name) ? `Script${name}` : name;
}
