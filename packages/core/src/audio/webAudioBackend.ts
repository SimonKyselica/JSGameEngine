import { RowanError } from '../core/assert';
import type { AudioBackend, AudioClip, AudioVoice, PlayOptions } from './audioBackend';

/** Events that count as a user gesture and therefore may start audio playback. */
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

class WebAudioClip implements AudioClip {
  constructor(readonly buffer: AudioBuffer) {}

  get duration(): number {
    return this.buffer.duration;
  }
}

class WebAudioVoice implements AudioVoice {
  isPlaying = true;

  constructor(
    private readonly source: AudioBufferSourceNode,
    private readonly gain: GainNode,
  ) {
    source.addEventListener('ended', () => {
      this.isPlaying = false;
      this.gain.disconnect();
    });
  }

  setVolume(volume: number): void {
    this.gain.gain.value = Math.max(0, volume);
  }

  setPitch(pitch: number): void {
    this.source.playbackRate.value = Math.max(0.01, pitch);
  }

  stop(): void {
    if (this.isPlaying) {
      this.isPlaying = false;
      this.source.stop();
    }
  }
}

/** Plays sound through the Web Audio API. */
export class WebAudioBackend implements AudioBackend {
  private readonly context: AudioContext;
  private readonly masterGain: GainNode;
  private suspendedByGame = false;
  private disposed = false;

  constructor() {
    if (typeof AudioContext === 'undefined') {
      throw new RowanError('The Web Audio API is not available in this browser');
    }
    this.context = new AudioContext();
    this.masterGain = this.context.createGain();
    this.masterGain.connect(this.context.destination);

    // Browsers keep an AudioContext suspended until the user interacts with the page.
    for (const type of UNLOCK_EVENTS) {
      window.addEventListener(type, this.unlock, { capture: true, passive: true });
    }
  }

  async decode(bytes: Uint8Array): Promise<AudioClip> {
    // decodeAudioData detaches the buffer it is given, so it must get its own copy.
    const copy = new Uint8Array(bytes).buffer;
    return new WebAudioClip(await this.context.decodeAudioData(copy));
  }

  play(clip: AudioClip, options: PlayOptions): AudioVoice {
    const source = this.context.createBufferSource();
    source.buffer = (clip as WebAudioClip).buffer;
    source.loop = options.loop;

    const gain = this.context.createGain();
    source.connect(gain);
    gain.connect(this.masterGain);

    const voice = new WebAudioVoice(source, gain);
    voice.setVolume(options.volume);
    voice.setPitch(options.pitch);
    source.start();
    return voice;
  }

  setMasterVolume(volume: number): void {
    this.masterGain.gain.value = Math.max(0, volume);
  }

  suspend(): void {
    this.suspendedByGame = true;
    void this.context.suspend();
  }

  resume(): void {
    this.suspendedByGame = false;
    void this.context.resume();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.removeUnlockListeners();
    void this.context.close();
  }

  private removeUnlockListeners(): void {
    for (const type of UNLOCK_EVENTS) {
      window.removeEventListener(type, this.unlock, { capture: true });
    }
  }

  private readonly unlock = (): void => {
    if (this.context.state === 'running') {
      this.removeUnlockListeners();
    } else if (!this.suspendedByGame && !this.disposed) {
      void this.context.resume();
    }
  };
}
