import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '../assets/assetDatabase';
import { encodeWav, generateTone } from '../assets/wav';
import { Logger } from '../core/logger';
import { AudioSource } from '../scene/components';
import { Scene } from '../scene/scene';
import { NullAudioBackend } from './audioBackend';
import { AudioApi, AudioSystem } from './audioSystem';

async function createAudioSetup(): Promise<{
  scene: Scene;
  assets: AssetDatabase;
  backend: NullAudioBackend;
  system: AudioSystem;
  clipId: string;
  messages: string[];
}> {
  const assets = new AssetDatabase();
  const clipId = assets.create({
    name: 'Sounds/beep.wav',
    type: 'audio',
    mimeType: 'audio/wav',
    data: encodeWav(generateTone(440, 0.05), 22050),
  }).id;
  const backend = new NullAudioBackend();
  const logger = new Logger();
  const messages: string[] = [];
  logger.addSink((entry) => messages.push(`${entry.level}: ${entry.message}`));
  const system = new AudioSystem(backend, assets, logger);
  await system.preloadAll();
  return { scene: new Scene(), assets, backend, system, clipId, messages };
}

describe('NullAudioBackend', () => {
  it('records voices and their state', async () => {
    const backend = new NullAudioBackend();
    const clip = await backend.decode(new Uint8Array(44100));
    expect(clip.duration).toBe(1);

    const voice = backend.play(clip, { volume: 0.5, pitch: 2, loop: true });
    expect(backend.voices).toHaveLength(1);
    expect(backend.voices[0]).toMatchObject({ volume: 0.5, pitch: 2, loop: true, isPlaying: true });
    voice.setVolume(0.25);
    voice.setPitch(1);
    expect(backend.voices[0]).toMatchObject({ volume: 0.25, pitch: 1 });

    backend.setMasterVolume(0.3);
    backend.suspend();
    expect([backend.masterVolume, backend.suspended]).toEqual([0.3, true]);
    backend.resume();
    expect(backend.suspended).toBe(false);
    backend.dispose();
    expect(voice.isPlaying).toBe(false);
  });
});

describe('AudioSystem', () => {
  it('plays sources marked "play on start" when the scene starts', async () => {
    const { scene, backend, system, clipId } = await createAudioSetup();
    const music = scene.createEntity('Music');
    music.addComponent(AudioSource, { clip: clipId, volume: 0.4, pitch: 1.5, loop: true });
    scene.createEntity('Silent').addComponent(AudioSource, { clip: clipId, playOnStart: false });
    const inactive = scene.createEntity('Inactive');
    inactive.addComponent(AudioSource, { clip: clipId });
    inactive.active = false;

    system.startScene(scene);
    expect(backend.voices).toHaveLength(1);
    expect(backend.voices[0]).toMatchObject({ volume: 0.4, pitch: 1.5, loop: true });
    expect(system.isPlaying(music)).toBe(true);
    expect(system.isPlaying(inactive)).toBe(false);
  });

  it('plays, restarts and stops a source on request', async () => {
    const { scene, backend, system, clipId } = await createAudioSetup();
    const entity = scene.createEntity('Sfx');
    entity.addComponent(AudioSource, { clip: clipId, playOnStart: false });
    system.startScene(scene);

    expect(system.play(entity)).toBe(true);
    expect(system.play(entity)).toBe(true);
    expect(backend.voices.map((voice) => voice.isPlaying)).toEqual([false, true]);
    system.stop(entity);
    expect(system.isPlaying(entity)).toBe(false);
    expect(backend.voices[1]!.isPlaying).toBe(false);
  });

  it('refuses to play without a source or a loaded clip, and says why', async () => {
    const { scene, system, messages } = await createAudioSetup();
    const bare = scene.createEntity('Bare');
    const missing = scene.createEntity('Missing');
    missing.addComponent(AudioSource, { clip: 'not-an-asset' });
    const empty = scene.createEntity('Empty');
    empty.addComponent(AudioSource);

    expect(system.play(bare)).toBe(false);
    expect(system.play(missing)).toBe(false);
    expect(system.play(empty)).toBe(false);
    expect(messages).toEqual([
      'warn: Cannot play audio: "Bare" has no AudioSource component',
      'warn: Cannot play audio on "Missing": the clip is missing or not loaded',
    ]);
  });

  it('applies volume and pitch changes to a playing voice', async () => {
    const { scene, backend, system, clipId } = await createAudioSetup();
    const entity = scene.createEntity('Music');
    const source = entity.addComponent(AudioSource, { clip: clipId });
    system.startScene(scene);

    source.volume = 0.1;
    source.pitch = 0.5;
    system.update();
    expect(backend.voices[0]).toMatchObject({ volume: 0.1, pitch: 0.5 });
  });

  it('forgets voices that finished and stops voices whose source went away', async () => {
    const { scene, backend, system, clipId } = await createAudioSetup();
    const finished = scene.createEntity('Finished');
    finished.addComponent(AudioSource, { clip: clipId });
    const removed = scene.createEntity('Removed');
    removed.addComponent(AudioSource, { clip: clipId });
    const destroyed = scene.createEntity('Destroyed');
    destroyed.addComponent(AudioSource, { clip: clipId });
    system.startScene(scene);

    backend.voices[0]!.stop();
    removed.removeComponent(AudioSource);
    destroyed.destroy();
    system.update();
    expect(system.isPlaying(finished)).toBe(false);
    expect(backend.voices.map((voice) => voice.isPlaying)).toEqual([false, false, false]);
  });

  it('plays one-shot clips by name or id', async () => {
    const { scene, backend, system, clipId, messages } = await createAudioSetup();
    system.startScene(scene);
    expect(system.playOneShot('beep', 0.7, 1.2)).toBe(true);
    expect(system.playOneShot(clipId)).toBe(true);
    expect(system.playOneShot('nope')).toBe(false);
    expect(backend.voices[0]).toMatchObject({ volume: 0.7, pitch: 1.2, loop: false });
    expect(backend.voices[1]).toMatchObject({ volume: 1, pitch: 1 });
    expect(messages).toEqual(['warn: Cannot play audio clip "nope": it is missing or not loaded']);

    backend.voices[0]!.stop();
    system.update();
    system.stopScene();
    expect(backend.voices.every((voice) => !voice.isPlaying)).toBe(true);
  });

  it('stops everything when the scene stops and ignores updates afterwards', async () => {
    const { scene, backend, system, clipId } = await createAudioSetup();
    const entity = scene.createEntity('Music');
    entity.addComponent(AudioSource, { clip: clipId });
    system.startScene(scene);
    system.stopScene();
    expect(backend.voices[0]!.isPlaying).toBe(false);
    expect(() => system.update()).not.toThrow();

    // Events from the old scene must no longer reach the system.
    entity.destroy();
    expect(system.isPlaying(entity)).toBe(false);
  });

  it('clamps the master volume and pauses the backend', async () => {
    const { backend, system } = await createAudioSetup();
    system.masterVolume = 3;
    expect([system.masterVolume, backend.masterVolume]).toEqual([1, 1]);
    system.masterVolume = -1;
    expect(backend.masterVolume).toBe(0);
    system.setPaused(true);
    expect(backend.suspended).toBe(true);
    system.setPaused(false);
    expect(backend.suspended).toBe(false);
  });

  it('logs audio that fails to decode instead of failing the preload', async () => {
    const { assets, messages } = await createAudioSetup();
    const backend = new NullAudioBackend();
    backend.decode = () => Promise.reject(new Error('unsupported format'));
    const logger = new Logger();
    logger.addSink((entry) => messages.push(entry.message));
    await new AudioSystem(backend, assets, logger).preloadAll();
    expect(messages).toEqual(['Failed to decode audio "Sounds/beep.wav": unsupported format']);
  });
});

describe('AudioApi', () => {
  it('forwards to the audio system', async () => {
    const { scene, backend, system, clipId } = await createAudioSetup();
    const entity = scene.createEntity('Sfx');
    entity.addComponent(AudioSource, { clip: clipId, playOnStart: false });
    system.startScene(scene);
    const api = new AudioApi(system);

    expect(api.play(entity)).toBe(true);
    expect(api.isPlaying(entity)).toBe(true);
    api.stop(entity);
    expect(api.isPlaying(entity)).toBe(false);
    expect(api.playOneShot('beep', 0.5)).toBe(true);
    api.masterVolume = 0.25;
    expect(api.masterVolume).toBe(0.25);
    expect(backend.masterVolume).toBe(0.25);
  });
});
