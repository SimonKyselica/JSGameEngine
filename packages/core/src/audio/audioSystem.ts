import type { AssetDatabase } from '../assets/assetDatabase';
import { describeError } from '../core/assert';
import type { Logger } from '../core/logger';
import type { Unsubscribe } from '../core/signal';
import type { EntityId } from '../ecs/registry';
import { MathUtils } from '../math/mathUtils';
import { AudioSource } from '../scene/components';
import type { Entity } from '../scene/entity';
import type { Scene } from '../scene/scene';
import type { AudioBackend, AudioClip, AudioVoice } from './audioBackend';

/**
 * Decodes audio assets and plays them, both for {@link AudioSource} components and for
 * one-shot sounds requested by scripts.
 */
export class AudioSystem {
  private readonly clips = new Map<string, AudioClip>();
  private readonly sourceVoices = new Map<EntityId, AudioVoice>();
  private readonly oneShotVoices = new Set<AudioVoice>();
  private readonly subscriptions: Unsubscribe[] = [];
  private scene: Scene | null = null;
  private volume = 1;

  constructor(
    private readonly backend: AudioBackend,
    private readonly assets: AssetDatabase,
    private readonly logger: Logger,
  ) {}

  get masterVolume(): number {
    return this.volume;
  }

  set masterVolume(value: number) {
    this.volume = MathUtils.clamp(value, 0, 1);
    this.backend.setMasterVolume(this.volume);
  }

  /** Decodes every audio asset so sounds can start without delay. */
  async preloadAll(): Promise<void> {
    await Promise.all(
      this.assets.list('audio').map(async (record) => {
        try {
          this.clips.set(record.id, await this.backend.decode(this.assets.getBytes(record.id)));
        } catch (error) {
          this.logger.error(`Failed to decode audio "${record.name}": ${describeError(error)}`);
        }
      }),
    );
  }

  /** Attaches to a scene and starts the audio sources marked "play on start". */
  startScene(scene: Scene): void {
    this.stopScene();
    this.scene = scene;
    this.subscriptions.push(
      scene.onEntityDestroyed.connect((entity) => this.stop(entity)),
      scene.registry.onComponentRemoved.connect((event) => {
        if (event.type === AudioSource) {
          this.stopVoice(event.entity);
        }
      }),
    );
    for (const [id, source] of [...scene.registry.view(AudioSource)]) {
      const entity = scene.getEntity(id);
      if (source.playOnStart && entity.activeInHierarchy) {
        this.play(entity);
      }
    }
  }

  /** Stops every sound that belongs to the current scene and detaches from it. */
  stopScene(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) {
      unsubscribe();
    }
    for (const voice of this.sourceVoices.values()) {
      voice.stop();
    }
    this.sourceVoices.clear();
    for (const voice of this.oneShotVoices) {
      voice.stop();
    }
    this.oneShotVoices.clear();
    this.scene = null;
  }

  /** Applies component changes to playing voices and forgets voices that have finished. */
  update(): void {
    const scene = this.scene;
    if (!scene) {
      return;
    }
    for (const [id, voice] of this.sourceVoices) {
      const source = scene.registry.get(id, AudioSource);
      if (!voice.isPlaying || !source) {
        voice.stop();
        this.sourceVoices.delete(id);
        continue;
      }
      voice.setVolume(source.volume);
      voice.setPitch(source.pitch);
    }
    for (const voice of this.oneShotVoices) {
      if (!voice.isPlaying) {
        this.oneShotVoices.delete(voice);
      }
    }
  }

  /** Plays the entity's {@link AudioSource} from the beginning. Returns `false` if it cannot. */
  play(entity: Entity): boolean {
    const source = entity.getComponent(AudioSource);
    if (!source) {
      this.logger.warn(`Cannot play audio: "${entity.name}" has no AudioSource component`);
      return false;
    }
    this.stopVoice(entity.id);
    const clip = source.clip === null ? undefined : this.clips.get(source.clip);
    if (!clip) {
      if (source.clip !== null) {
        this.logger.warn(
          `Cannot play audio on "${entity.name}": the clip is missing or not loaded`,
        );
      }
      return false;
    }
    this.sourceVoices.set(
      entity.id,
      this.backend.play(clip, { volume: source.volume, pitch: source.pitch, loop: source.loop }),
    );
    return true;
  }

  stop(entity: Entity): void {
    this.stopVoice(entity.id);
  }

  isPlaying(entity: Entity): boolean {
    return this.sourceVoices.get(entity.id)?.isPlaying ?? false;
  }

  /**
   * Plays a clip once without an entity. `clip` is an asset id or name.
   * Returns `false` when the clip does not exist or is not loaded.
   */
  playOneShot(clip: string, volume = 1, pitch = 1): boolean {
    const record = this.assets.resolve(clip, 'audio');
    const decoded = record ? this.clips.get(record.id) : undefined;
    if (!decoded) {
      this.logger.warn(`Cannot play audio clip "${clip}": it is missing or not loaded`);
      return false;
    }
    this.oneShotVoices.add(this.backend.play(decoded, { volume, pitch, loop: false }));
    return true;
  }

  /** Pauses or resumes all audio output. */
  setPaused(paused: boolean): void {
    if (paused) {
      this.backend.suspend();
    } else {
      this.backend.resume();
    }
  }

  private stopVoice(id: EntityId): void {
    const voice = this.sourceVoices.get(id);
    if (voice) {
      voice.stop();
      this.sourceVoices.delete(id);
    }
  }
}

/** The audio functions available to scripts as `this.audio`. */
export class AudioApi {
  constructor(private readonly system: AudioSystem) {}

  /** Overall volume from 0 to 1. */
  get masterVolume(): number {
    return this.system.masterVolume;
  }

  set masterVolume(value: number) {
    this.system.masterVolume = value;
  }

  /** Plays the entity's AudioSource from the beginning. Returns `false` if it cannot play. */
  play(entity: Entity): boolean {
    return this.system.play(entity);
  }

  /** Stops the entity's AudioSource. Does nothing when it is not playing. */
  stop(entity: Entity): void {
    this.system.stop(entity);
  }

  /** True while the entity's AudioSource is playing. */
  isPlaying(entity: Entity): boolean {
    return this.system.isPlaying(entity);
  }

  /** Plays an audio clip once. `clip` is an audio asset's name or id. */
  playOneShot(clip: string, volume = 1, pitch = 1): boolean {
    return this.system.playOneShot(clip, volume, pitch);
  }
}
