// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebAudioBackend } from './webAudioBackend';

class FakeParam {
  value = 1;
}

class FakeNode extends EventTarget {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(target: unknown): void {
    this.connections.push(target);
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeSource extends FakeNode {
  readonly playbackRate = new FakeParam();
  buffer: unknown = null;
  loop = false;
  started = 0;
  stopped = 0;

  start(): void {
    this.started++;
  }

  stop(): void {
    this.stopped++;
  }
}

/** Records what the backend builds; only what the backend uses is implemented. */
class FakeAudioContext {
  static last: FakeAudioContext;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  readonly destination = { name: 'speakers' };
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly decoded: ArrayBuffer[] = [];
  resumeCalls = 0;

  constructor() {
    FakeAudioContext.last = this;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  decodeAudioData(data: ArrayBuffer): Promise<{ duration: number }> {
    this.decoded.push(data);
    return Promise.resolve({ duration: 1.5 });
  }

  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

function createBackend(): { backend: WebAudioBackend; context: FakeAudioContext } {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const backend = new WebAudioBackend();
  return { backend, context: FakeAudioContext.last };
}

const OPTIONS = { volume: 1, pitch: 1, loop: false };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebAudioBackend', () => {
  it('explains that Web Audio is missing', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => new WebAudioBackend()).toThrow('The Web Audio API is not available');
  });

  it('decodes a copy of the bytes, because decoding detaches the buffer it is given', async () => {
    const { backend, context } = createBackend();
    const bytes = new Uint8Array([1, 2, 3]);
    const clip = await backend.decode(bytes);
    expect(clip.duration).toBe(1.5);
    expect(context.decoded[0]).not.toBe(bytes.buffer);
    expect([...new Uint8Array(context.decoded[0]!)]).toEqual([1, 2, 3]);
  });

  it('plays a clip through its own gain into the master gain', async () => {
    const { backend, context } = createBackend();
    const clip = await backend.decode(new Uint8Array(4));
    const voice = backend.play(clip, { volume: 0.5, pitch: 2, loop: true });

    const [master, voiceGain] = context.gains;
    const source = context.sources[0]!;
    expect(master!.connections).toEqual([context.destination]);
    expect(source.connections).toEqual([voiceGain]);
    expect(voiceGain!.connections).toEqual([master]);
    expect(source).toMatchObject({ loop: true, started: 1 });
    expect(voiceGain!.gain.value).toBe(0.5);
    expect(source.playbackRate.value).toBe(2);
    expect(voice.isPlaying).toBe(true);
  });

  it('changes volume and pitch of a playing voice within valid ranges', async () => {
    const { backend, context } = createBackend();
    const voice = backend.play(await backend.decode(new Uint8Array(4)), OPTIONS);
    voice.setVolume(-3);
    voice.setPitch(0);
    expect(context.gains[1]!.gain.value).toBe(0);
    expect(context.sources[0]!.playbackRate.value).toBe(0.01);
    voice.setVolume(0.8);
    voice.setPitch(1.5);
    expect(context.gains[1]!.gain.value).toBe(0.8);
    expect(context.sources[0]!.playbackRate.value).toBe(1.5);
  });

  it('stops a voice once, and notices when a sound ends by itself', async () => {
    const { backend, context } = createBackend();
    const clip = await backend.decode(new Uint8Array(4));
    const stopped = backend.play(clip, OPTIONS);
    stopped.stop();
    stopped.stop();
    expect(context.sources[0]!.stopped).toBe(1);
    expect(stopped.isPlaying).toBe(false);

    const finished = backend.play(clip, OPTIONS);
    context.sources[1]!.dispatchEvent(new Event('ended'));
    expect(finished.isPlaying).toBe(false);
    expect(context.gains[2]!.disconnected).toBe(true);
    finished.stop();
    expect(context.sources[1]!.stopped).toBe(0);
  });

  it('sets the master volume and never below zero', () => {
    const { backend, context } = createBackend();
    backend.setMasterVolume(0.3);
    expect(context.gains[0]!.gain.value).toBe(0.3);
    backend.setMasterVolume(-1);
    expect(context.gains[0]!.gain.value).toBe(0);
  });

  it('starts the audio context on the first user gesture, as browsers require', () => {
    const { context } = createBackend();
    expect(context.state).toBe('suspended');
    window.dispatchEvent(new Event('pointerdown'));
    expect(context.state).toBe('running');
    expect(context.resumeCalls).toBe(1);

    // Once running, the gesture listeners remove themselves.
    window.dispatchEvent(new Event('keydown'));
    window.dispatchEvent(new Event('keydown'));
    expect(context.resumeCalls).toBe(1);
  });

  it('stays suspended on user gestures while the game has paused the audio', () => {
    const { backend, context } = createBackend();
    backend.suspend();
    window.dispatchEvent(new Event('keydown'));
    expect(context.state).toBe('suspended');
    expect(context.resumeCalls).toBe(0);

    backend.resume();
    expect(context.state).toBe('running');
  });

  it('closes the context once and stops listening for gestures', () => {
    const { backend, context } = createBackend();
    backend.dispose();
    backend.dispose();
    expect(context.state).toBe('closed');
    window.dispatchEvent(new Event('pointerdown'));
    expect(context.resumeCalls).toBe(0);
  });
});
