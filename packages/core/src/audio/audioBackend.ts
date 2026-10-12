/** An opaque handle to decoded audio owned by an {@link AudioBackend}. */
export interface AudioClip {
  /** Length in seconds. */
  readonly duration: number;
}

export interface PlayOptions {
  readonly volume: number;
  /** Playback rate; 1 is the original pitch. */
  readonly pitch: number;
  readonly loop: boolean;
}

/** One playing sound. */
export interface AudioVoice {
  /** False once the sound finished or was stopped. */
  readonly isPlaying: boolean;
  setVolume(volume: number): void;
  setPitch(pitch: number): void;
  stop(): void;
}

/** The audio output. Implemented with Web Audio in browsers and as a silent stub elsewhere. */
export interface AudioBackend {
  decode(bytes: Uint8Array): Promise<AudioClip>;
  play(clip: AudioClip, options: PlayOptions): AudioVoice;
  setMasterVolume(volume: number): void;
  /** Pauses all output, for example while the game is paused. */
  suspend(): void;
  resume(): void;
  dispose(): void;
}

class NullVoice implements AudioVoice {
  isPlaying = true;
  volume: number;
  pitch: number;
  readonly loop: boolean;

  constructor(
    readonly clip: AudioClip,
    options: PlayOptions,
  ) {
    this.volume = options.volume;
    this.pitch = options.pitch;
    this.loop = options.loop;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  setPitch(pitch: number): void {
    this.pitch = pitch;
  }

  stop(): void {
    this.isPlaying = false;
  }
}

export type RecordedVoice = NullVoice;

/**
 * A silent backend that records what was played. Used for automated tests and for
 * running games without audio output.
 */
export class NullAudioBackend implements AudioBackend {
  /** Every voice started so far, oldest first. */
  readonly voices: RecordedVoice[] = [];
  masterVolume = 1;
  suspended = false;

  decode(bytes: Uint8Array): Promise<AudioClip> {
    // Without a decoder the real length is unknown, so one second per 44.1k bytes will do.
    return Promise.resolve({ duration: bytes.length / 44100 });
  }

  play(clip: AudioClip, options: PlayOptions): AudioVoice {
    const voice = new NullVoice(clip, options);
    this.voices.push(voice);
    return voice;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = volume;
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  dispose(): void {
    for (const voice of this.voices) {
      voice.stop();
    }
  }
}
