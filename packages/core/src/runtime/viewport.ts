export interface FitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The largest rectangle with the given aspect ratio that fits inside a container,
 * centered. This is how a game keeps its shape in a window of any size (letterboxing).
 */
export function computeFitRect(
  containerWidth: number,
  containerHeight: number,
  aspect: number,
): FitRect {
  if (containerWidth <= 0 || containerHeight <= 0 || !(aspect > 0)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let width = containerWidth;
  let height = containerWidth / aspect;
  if (height > containerHeight) {
    height = containerHeight;
    width = containerHeight * aspect;
  }
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height,
  };
}
