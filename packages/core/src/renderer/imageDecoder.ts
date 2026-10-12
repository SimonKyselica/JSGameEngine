import { RowanError } from '../core/assert';
import { readPngSize } from '../assets/png';
import type { TextureSource } from './renderer2d';
import type { ImageDecoder } from './textureCache';

/** Size used for vector images that do not declare one. */
const DEFAULT_VECTOR_SIZE = 256;

/**
 * Decodes any image format the browser supports (PNG, JPEG, WebP, GIF, BMP, AVIF, SVG...).
 * Animated formats yield their first frame.
 */
export const decodeImageInBrowser: ImageDecoder = async (bytes, mimeType) => {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  // createImageBitmap cannot decode SVG blobs in every browser, so SVG goes through <img>.
  if (mimeType !== 'image/svg+xml') {
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'premultiply',
      colorSpaceConversion: 'none',
    });
    return {
      width: bitmap.width,
      height: bitmap.height,
      image: bitmap,
      dispose: () => bitmap.close(),
    };
  }
  return rasterizeVectorImage(blob);
};

async function rasterizeVectorImage(blob: Blob): Promise<TextureSource> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth || DEFAULT_VECTOR_SIZE;
    const height = image.naturalHeight || DEFAULT_VECTOR_SIZE;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new RowanError('Could not create a 2D canvas to rasterize a vector image');
    }
    context.drawImage(image, 0, 0, width, height);
    return { width, height, image: canvas };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A decoder for environments without image support, such as automated tests. It reports
 * the real size of PNG images and produces a single transparent pixel as content.
 */
export const decodeImageHeadless: ImageDecoder = (bytes) => {
  const size = readPngSize(bytes) ?? { width: 1, height: 1 };
  return Promise.resolve({ ...size, pixels: new Uint8Array(size.width * size.height * 4) });
};
