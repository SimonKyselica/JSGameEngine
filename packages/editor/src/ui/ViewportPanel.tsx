import { useEffect, useRef, type ReactElement } from 'react';
import {
  attachDomInput,
  Color,
  computeFitRect,
  describeError,
  GameLoop,
  NullAudioBackend,
  SceneRenderer,
  TextureCache,
  Tilemap,
  Vec2,
  WebAudioBackend,
  WebGL2Renderer,
  type AudioBackend,
} from '@rowan/core';
import type { Tool } from '../core/editorSession';
import {
  applyGizmoDrag,
  hitTestGizmo,
  isSnapActive,
  type GizmoDragStart,
  type GizmoHandle,
  type TransformTool,
} from '../core/gizmos';
import { drawOverlay, getGizmoLayout } from '../core/overlay';
import { pickEntity } from '../core/picking';
import { DRAG_TYPES, useEditor } from './editorContext';

export type ViewportMode = 'scene' | 'game';

/** The tool as far as gizmos are concerned: the hand and the brush have none. */
function getTransformTool(tool: Tool): TransformTool | null {
  return tool === 'hand' || tool === 'paint' ? null : tool;
}

const SCENE_BACKGROUND = new Color(0.16, 0.17, 0.19, 1);
const MAX_PIXEL_RATIO = 2;
const ZOOM_PER_WHEEL_PIXEL = 0.0015;
/** How close to an entity without a sprite a click must be to select it, in pixels. */
const ICON_PICK_RADIUS = 14;
/** How often the panels refresh while the game runs, to show live values. */
const PLAY_REFRESH_INTERVAL = 0.2;
/** Pointer movement below this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 3;

type Interaction =
  | { readonly kind: 'pan'; lastX: number; lastY: number }
  | { readonly kind: 'paint'; changed: boolean }
  | { readonly kind: 'gizmo'; readonly start: GizmoDragStart; changed: boolean }
  | { readonly kind: 'click'; readonly startX: number; readonly startY: number };

function createAudioBackend(): AudioBackend {
  try {
    return new WebAudioBackend();
  } catch {
    return new NullAudioBackend();
  }
}

/**
 * The scene view and the game view. Both draw into the same WebGL canvas: the scene
 * view through the editor's own camera with gizmos on top, the game view through the
 * scene's camera exactly as an exported game would.
 */
export function ViewportPanel({
  mode,
  hidden,
}: {
  mode: ViewportMode;
  hidden: boolean;
}): ReactElement {
  const { session, imageDecoder, textRasterizer, saveStorage, viewport } = useEditor();
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);

  // The render loop and the pointer handlers read these every frame without re-subscribing.
  const modeRef = useRef(mode);
  const interactionRef = useRef<Interaction | null>(null);
  const hoverRef = useRef<GizmoHandle | null>(null);
  const sizeRef = useRef({ width: 1, height: 1 });
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const pixelArt = session.project.settings.rendering.pixelArt;

  // A game reads the keyboard, so when one starts, resumes or comes into view it takes the
  // focus from wherever the user was typing, typically a script or an inspector field.
  const playState = session.play.state;
  useEffect(() => {
    if (playState === 'playing' && mode === 'game' && !hidden) {
      glCanvasRef.current?.focus();
    }
  }, [playState, mode, hidden]);

  useEffect(() => {
    const container = containerRef.current;
    const glCanvas = glCanvasRef.current;
    const overlay = overlayRef.current;
    const context = overlay?.getContext('2d');
    const message = messageRef.current;
    if (!container || !glCanvas || !overlay || !context || !message) {
      return;
    }

    let renderer: WebGL2Renderer;
    try {
      renderer = new WebGL2Renderer(glCanvas);
    } catch (creationError) {
      // Without WebGL2 there is nothing to draw with; say so where the scene would be.
      message.textContent = `The viewport could not start: ${describeError(creationError)}`;
      message.hidden = false;
      return;
    }
    message.hidden = true;

    const { assets, settings } = session.project;
    const textures = new TextureCache(
      renderer,
      assets,
      imageDecoder,
      pixelArt ? 'nearest' : 'linear',
      session.logger,
    );
    const sceneRenderer = new SceneRenderer(
      renderer,
      textures,
      assets,
      textRasterizer,
      session.logger,
    );
    const audioBackend = createAudioBackend();
    session.play.setDependencies({
      renderer,
      audioBackend,
      imageDecoder,
      textRasterizer,
      storage: saveStorage,
      attachInput: (input) => attachDomInput(input, glCanvas),
    });

    let sinceRefresh = 0;
    const loop = new GameLoop((deltaSeconds) => {
      session.play.update(deltaSeconds);
      if (session.play.state === 'playing') {
        sinceRefresh += deltaSeconds;
        if (sinceRefresh >= PLAY_REFRESH_INTERVAL) {
          sinceRefresh = 0;
          session.notify();
        }
      }

      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      if (containerWidth === 0 || containerHeight === 0) {
        return; // Hidden behind a script tab: keep the game running but draw nothing.
      }
      const isGame = modeRef.current === 'game';
      const { width: gameWidth, height: gameHeight } = settings.rendering;
      const rect = isGame
        ? computeFitRect(containerWidth, containerHeight, gameWidth / gameHeight)
        : { x: 0, y: 0, width: containerWidth, height: containerHeight };
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      for (const canvas of [glCanvas, overlay]) {
        Object.assign(canvas.style, {
          left: `${rect.x}px`,
          top: `${rect.y}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
      }
      renderer.resize(rect.width * pixelRatio, rect.height * pixelRatio);
      if (overlay.width !== renderer.width || overlay.height !== renderer.height) {
        overlay.width = renderer.width;
        overlay.height = renderer.height;
      }
      sizeRef.current = { width: rect.width, height: rect.height };
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      const scene = session.activeScene;
      if (isGame) {
        sceneRenderer.renderPrimaryCamera(scene);
        context.clearRect(0, 0, rect.width, rect.height);
        return;
      }
      viewport.aspect = rect.width / rect.height;
      const view = viewport.camera.toView(viewport.aspect);
      sceneRenderer.render(scene, view, SCENE_BACKGROUND);
      const interaction = interactionRef.current;
      drawOverlay(context, {
        scene,
        assets,
        textMeasurer: textRasterizer,
        view,
        width: rect.width,
        height: rect.height,
        selected: session.selectedEntity,
        tool: getTransformTool(session.tool),
        activeHandle: interaction?.kind === 'gizmo' ? interaction.start.handle : hoverRef.current,
        gameAspect: gameWidth / gameHeight,
      });
    });
    loop.start();

    return () => {
      loop.stop();
      session.play.setDependencies(null);
      sceneRenderer.dispose();
      textures.dispose();
      renderer.dispose();
      audioBackend.dispose();
    };
  }, [session, imageDecoder, textRasterizer, saveStorage, viewport, pixelArt]);

  /** Pointer position relative to the scene view, in CSS pixels and in world space. */
  const locate = (event: { clientX: number; clientY: number }): { screen: Vec2; world: Vec2 } => {
    const bounds = overlayRef.current!.getBoundingClientRect();
    const { width, height } = sizeRef.current;
    const screen = new Vec2(event.clientX - bounds.left, event.clientY - bounds.top);
    const world = viewport.camera
      .toView(width / height)
      .viewportToWorld(screen.x, screen.y, width, height);
    return { screen, world };
  };

  const findHandle = (screen: Vec2): GizmoHandle | null => {
    const entity = session.selectedEntity;
    const tool = getTransformTool(session.tool);
    if (!entity || !tool) {
      return null;
    }
    const { width, height } = sizeRef.current;
    const view = viewport.camera.toView(width / height);
    return hitTestGizmo(tool, getGizmoLayout(entity, tool, view, width, height), screen);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const { screen, world } = locate(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const wantsPan = event.button !== 0 || event.altKey || session.tool === 'hand';
    if (wantsPan) {
      interactionRef.current = { kind: 'pan', lastX: event.clientX, lastY: event.clientY };
      return;
    }

    const entity = session.selectedEntity;
    if (session.tool === 'paint' && entity?.hasComponent(Tilemap)) {
      // A stroke, from the press to the release, is one step to undo.
      session.beginDrag();
      interactionRef.current = { kind: 'paint', changed: session.paintTile(world) };
      session.notify();
      return;
    }
    const handle = findHandle(screen);
    const tool = getTransformTool(session.tool);
    if (entity && handle && tool) {
      const { width, height } = sizeRef.current;
      const view = viewport.camera.toView(width / height);
      session.beginDrag();
      interactionRef.current = {
        kind: 'gizmo',
        changed: false,
        start: {
          handle,
          position: entity.worldPosition,
          rotation: entity.worldRotation,
          scale: entity.transform.scale.clone(),
          pointer: screen,
          pointerWorld: world,
          layout: getGizmoLayout(entity, tool, view, width, height),
        },
      };
      return;
    }
    interactionRef.current = { kind: 'click', startX: event.clientX, startY: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const interaction = interactionRef.current;
    const { screen, world } = locate(event);
    if (!interaction) {
      hoverRef.current = findHandle(screen);
      return;
    }
    if (interaction.kind === 'pan') {
      viewport.camera.pan(
        event.clientX - interaction.lastX,
        event.clientY - interaction.lastY,
        sizeRef.current.height,
      );
      interaction.lastX = event.clientX;
      interaction.lastY = event.clientY;
      return;
    }
    if (interaction.kind === 'paint') {
      if (session.paintTile(world)) {
        interaction.changed = true;
        session.notify();
      }
      return;
    }
    const entity = session.selectedEntity;
    if (interaction.kind !== 'gizmo' || !entity) {
      return;
    }
    const snap = isSnapActive(session.snapping, event.ctrlKey || event.metaKey);
    const result = applyGizmoDrag(interaction.start, screen, world, snap);
    if (result.position) {
      entity.setWorldPosition(result.position);
    }
    if (result.rotation !== undefined) {
      entity.setWorldRotation(result.rotation);
    }
    if (result.scale) {
      entity.transform.scale.copy(result.scale);
    }
    interaction.changed = true;
    session.notify();
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const interaction = interactionRef.current;
    interactionRef.current = null;
    if (interaction?.kind === 'gizmo' || interaction?.kind === 'paint') {
      session.endDrag(interaction.changed);
    } else if (interaction?.kind === 'click') {
      const moved = Math.hypot(
        event.clientX - interaction.startX,
        event.clientY - interaction.startY,
      );
      if (moved <= DRAG_THRESHOLD) {
        const { world } = locate(event);
        const unitsPerPixel = (viewport.camera.halfHeight * 2) / sizeRef.current.height;
        session.selectEntity(
          pickEntity(
            session.activeScene,
            { assets: session.project.assets, textMeasurer: textRasterizer },
            world,
            ICON_PICK_RADIUS * unitsPerPixel,
          ),
        );
      }
    }
  };

  // React attaches wheel listeners as passive, which cannot stop the page from scrolling.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const bounds = overlay.getBoundingClientRect();
      const { width, height } = sizeRef.current;
      viewport.camera.zoomAt(
        Math.exp(event.deltaY * ZOOM_PER_WHEEL_PIXEL),
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        width,
        height,
      );
    };
    overlay.addEventListener('wheel', handleWheel, { passive: false });
    return () => overlay.removeEventListener('wheel', handleWheel);
  }, [viewport]);

  const handleDrop = (event: React.DragEvent<HTMLCanvasElement>): void => {
    const asset = session.project.assets.get(event.dataTransfer.getData(DRAG_TYPES.asset));
    if (!asset) {
      return;
    }
    event.preventDefault();
    const { world } = locate(event);
    if (asset.type === 'texture') {
      session.createSprite(asset.id, world);
    } else if (asset.type === 'prefab') {
      session.instantiatePrefab(asset.id, world);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`viewport ${mode}`}
      style={{ display: hidden ? 'none' : undefined }}
      data-testid="viewport"
    >
      <canvas ref={glCanvasRef} className="viewport-canvas" tabIndex={0} aria-label="Game view" />
      <canvas
        ref={overlayRef}
        className="viewport-overlay"
        aria-label="Scene view"
        style={{
          pointerEvents: mode === 'scene' ? 'auto' : 'none',
          cursor:
            session.tool === 'hand' ? 'grab' : session.tool === 'paint' ? 'crosshair' : 'default',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(DRAG_TYPES.asset)) {
            event.preventDefault();
          }
        }}
        onDrop={handleDrop}
      />
      <div ref={messageRef} className="viewport-message" role="alert" hidden />
      {mode === 'game' && session.play.state === 'stopped' && (
        <div className="viewport-hint">Press Play to run the game</div>
      )}
    </div>
  );
}
