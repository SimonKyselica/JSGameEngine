import { assert } from '../core/assert';

const HEADER_SIZE = 44;

/**
 * Encodes mono audio samples (-1..1) as a 16-bit PCM WAV file. Used for generated
 * placeholder and test sounds.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  assert(Number.isInteger(sampleRate) && sampleRate > 0, 'Sample rate must be a positive integer');

  const dataSize = samples.length * 2;
  const bytes = new Uint8Array(HEADER_SIZE + dataSize);
  const view = new DataView(bytes.buffer);
  const writeTag = (offset: number, tag: string): void => {
    for (let index = 0; index < tag.length; index++) {
      bytes[offset + index] = tag.charCodeAt(index);
    }
  };

  writeTag(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeTag(8, 'WAVE');
  writeTag(12, 'fmt ');
  view.setUint32(16, 16, true); // size of the fmt chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeTag(36, 'data');
  view.setUint32(40, dataSize, true);

  for (const [index, sample] of samples.entries()) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(HEADER_SIZE + index * 2, Math.round(clamped * 0x7fff), true);
  }
  return bytes;
}

/** Generates a sine tone that fades out, as mono samples. */
export function generateTone(
  frequency: number,
  durationSeconds: number,
  sampleRate = 22050,
): Float32Array {
  const samples = new Float32Array(Math.max(1, Math.round(durationSeconds * sampleRate)));
  for (let index = 0; index < samples.length; index++) {
    const fade = 1 - index / samples.length;
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * fade * 0.5;
  }
  return samples;
}
