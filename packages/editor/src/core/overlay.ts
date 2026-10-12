import {
  BoxCollider2D,
  Camera,
  CircleCollider2D,
  Vec2,
  type CameraView,
  type Entity,
  type Scene,
} from '@rowan/core';
import {
  getGizmoAxes,
  GIZMO,
  type GizmoHandle,
  type GizmoLayout,
  type TransformTool,
} from './gizmos';
import { getButtonCorners, getSpriteCorners, getTextCorners, type VisualSources } from './picking';

const COLORS = {
  gridMinor: 'rgba(255, 255, 255, 0.05)',
  gridMajor: 'rgba(255, 255, 255, 0.11)',
  axisX: '#e5484d',
  axisY: '#46a758',
  free: '#f5d90a',
  highlight: '#ffffff',
  selection: '#ff9f43',
  collider: '#5ee27a',
  button: '#ff7ad9',
  camera: 'rgba(255, 255, 255, 0.55)',
} as const;

/** Grid lines closer together than this many pixels are not drawn. */
const MIN_GRID_SPACING = 14;
const CIRCLE_SEGMENTS = 40;

export interface OverlayOptions extends VisualSources {
  readonly scene: Scene;
  readonly view: CameraView;
  /** Viewport size in CSS pixels. The context must already be scaled for the pixel ratio. */
  readonly width: number;
  readonly height: number;
  readonly selected: Entity | null;
  readonly tool: TransformTool | null;
  /** The gizmo handle under the pointer or being dragged, drawn highlighted. */
  readonly activeHandle: GizmoHandle | null;
  /** The reference resolution's aspect ratio, used to draw camera frames. */
  readonly gameAspect: number;
}

/** Where the transform gizmo of an entity sits on screen for a given tool. */
export function getGizmoLayout(
  entity: Entity,
  tool: TransformTool,
  view: CameraView,
  width: number,
  height: number,
): GizmoLayout {
  return {
    origin: view.worldToViewport(entity.worldPosition, width, height),
    rotation: tool === 'scale' ? entity.worldRotation : 0,
  };
}

/**
 * Draws everything the scene view shows on top of the game's own rendering: the grid,
 * camera frames, collider shapes, the selection outline and the transform gizmo.
 */
export function drawOverlay(context: CanvasRenderingContext2D, options: OverlayOptions): void {
  const { scene, view, width, height, selected } = options;
  context.clearRect(0, 0, width, height);
  drawGrid(context, view, width, height);

  const toScreen = (point: Readonly<Vec2>): Vec2 => view.worldToViewport(point, width, height);

  for (const [id] of scene.registry.view(Camera)) {
    drawCameraFrame(context, scene.getEntity(id), options.gameAspect, toScreen);
  }
  if (selected) {
    drawColliders(context, selected, toScreen);
    drawSelection(context, selected, options, toScreen);
    if (options.tool) {
      drawGizmo(
        context,
        options.tool,
        getGizmoLayout(selected, options.tool, view, width, height),
        options.activeHandle,
      );
    }
  }
}

function drawGrid(
  context: CanvasRenderingContext2D,
  view: CameraView,
  width: number,
  height: number,
): void {
  const pixelsPerUnit = height / (view.halfHeight * 2);
  // The smallest power of ten that keeps lines at least MIN_GRID_SPACING pixels apart.
  const spacing = Math.pow(10, Math.ceil(Math.log10(MIN_GRID_SPACING / pixelsPerUnit)));
  const { bounds } = view;

  const drawLines = (step: number, color: string): void => {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
      const screenX = Math.round(((x - bounds.minX) / bounds.width) * width) + 0.5;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, height);
    }
    for (let y = Math.ceil(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
      const screenY = Math.round(((bounds.maxY - y) / bounds.height) * height) + 0.5;
      context.moveTo(0, screenY);
      context.lineTo(width, screenY);
    }
    context.stroke();
  };
  drawLines(spacing, COLORS.gridMinor);
  drawLines(spacing * 10, COLORS.gridMajor);
}

function strokePolygon(
  context: CanvasRenderingContext2D,
  points: readonly Readonly<Vec2>[],
  color: string,
  lineWidth: number,
  dash: number[] = [],
): void {
  if (points.length < 2) {
    return;
  }
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.stroke();
  context.setLineDash([]);
}

/** Outlines the area a camera shows in the game. */
function drawCameraFrame(
  context: CanvasRenderingContext2D,
  entity: Entity,
  aspect: number,
  toScreen: (point: Readonly<Vec2>) => Vec2,
): void {
  if (!entity.activeInHierarchy) {
    return;
  }
  const camera = entity.requireComponent(Camera);
  const halfHeight = camera.orthographicSize;
  const halfWidth = halfHeight * aspect;
  const position = entity.worldPosition;
  const rotation = entity.worldRotation;
  const corners = [
    new Vec2(-halfWidth, -halfHeight),
    new Vec2(halfWidth, -halfHeight),
    new Vec2(halfWidth, halfHeight),
    new Vec2(-halfWidth, halfHeight),
  ].map((corner) => toScreen(corner.rotate(rotation).add(position)));
  strokePolygon(context, corners, COLORS.camera, 1, [6, 4]);
}

function drawColliders(
  context: CanvasRenderingContext2D,
  entity: Entity,
  toScreen: (point: Readonly<Vec2>) => Vec2,
): void {
  const scene = entity.scene;
  const position = entity.worldPosition;
  const rotation = entity.worldRotation;
  const scale = scene.getWorldScale(entity);
  // Mirrors how the physics system places shapes: scaled offset, then the body's rotation.
  const place = (x: number, y: number): Vec2 =>
    toScreen(new Vec2(x, y).rotate(rotation).add(position));

  const box = entity.getComponent(BoxCollider2D);
  if (box) {
    const halfWidth = Math.abs(box.size.x * scale.x) / 2;
    const halfHeight = Math.abs(box.size.y * scale.y) / 2;
    const offsetX = box.offset.x * scale.x;
    const offsetY = box.offset.y * scale.y;
    strokePolygon(
      context,
      [
        place(offsetX - halfWidth, offsetY - halfHeight),
        place(offsetX + halfWidth, offsetY - halfHeight),
        place(offsetX + halfWidth, offsetY + halfHeight),
        place(offsetX - halfWidth, offsetY + halfHeight),
      ],
      COLORS.collider,
      1.5,
    );
  }

  const circle = entity.getComponent(CircleCollider2D);
  if (circle) {
    const radius = Math.abs(circle.radius) * Math.max(Math.abs(scale.x), Math.abs(scale.y));
    const offsetX = circle.offset.x * scale.x;
    const offsetY = circle.offset.y * scale.y;
    const points = Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => {
      const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
      return place(offsetX + Math.cos(angle) * radius, offsetY + Math.sin(angle) * radius);
    });
    strokePolygon(context, points, COLORS.collider, 1.5);
  }
}

function drawSelection(
  context: CanvasRenderingContext2D,
  entity: Entity,
  sources: VisualSources,
  toScreen: (point: Readonly<Vec2>) => Vec2,
): void {
  const outlines = [
    getSpriteCorners(entity, sources.assets),
    getTextCorners(entity, sources.textMeasurer),
  ];
  for (const corners of outlines) {
    if (corners) {
      strokePolygon(context, corners.map(toScreen), COLORS.selection, 1.5);
    }
  }
  // The area that reacts to the pointer cannot be seen in the game, so it is shown here.
  const button = getButtonCorners(entity);
  if (button) {
    strokePolygon(context, button.map(toScreen), COLORS.button, 1.5);
  }
}

function handleColor(handle: GizmoHandle, active: GizmoHandle | null, color: string): string {
  return handle === active ? COLORS.highlight : color;
}

function drawGizmo(
  context: CanvasRenderingContext2D,
  tool: TransformTool,
  layout: GizmoLayout,
  active: GizmoHandle | null,
): void {
  const { origin } = layout;
  context.lineWidth = 2;

  if (tool === 'rotate') {
    context.strokeStyle = handleColor('rotate', active, COLORS.free);
    context.beginPath();
    context.arc(origin.x, origin.y, GIZMO.rotateRadius, 0, Math.PI * 2);
    context.stroke();
    return;
  }

  const axes = getGizmoAxes(layout.rotation);
  const drawAxis = (axis: Readonly<Vec2>, handle: GizmoHandle, color: string): void => {
    const end = origin.clone().add(axis.clone().scale(GIZMO.axisLength));
    const resolved = handleColor(handle, active, color);
    context.strokeStyle = resolved;
    context.fillStyle = resolved;
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(end.x, end.y);
    context.stroke();

    context.beginPath();
    if (tool === 'move') {
      // An arrow head pointing along the axis.
      const back = end.clone().sub(axis.clone().scale(12));
      const side = new Vec2(-axis.y, axis.x).scale(5);
      context.moveTo(end.x, end.y);
      context.lineTo(back.x + side.x, back.y + side.y);
      context.lineTo(back.x - side.x, back.y - side.y);
    } else {
      context.rect(end.x - 5, end.y - 5, 10, 10);
    }
    context.fill();
  };
  drawAxis(axes.x, `${tool}-x`, COLORS.axisX);
  drawAxis(axes.y, `${tool}-y`, COLORS.axisY);

  const size = GIZMO.centerSize;
  context.fillStyle = handleColor(`${tool}-xy`, active, COLORS.free);
  context.globalAlpha = 0.85;
  context.fillRect(origin.x - size, origin.y - size, size * 2, size * 2);
  context.globalAlpha = 1;
}
