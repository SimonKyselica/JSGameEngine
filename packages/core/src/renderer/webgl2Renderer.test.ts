import { describe, expect, it, vi } from 'vitest';
import { Color } from '../math/color';
import { Mat3 } from '../math/mat3';
import { WebGL2Renderer } from './webgl2Renderer';

interface GlCall {
  readonly name: string;
  readonly args: unknown[];
}

interface FakeCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly calls: GlCall[];
  /** Flip these to make shader compilation or program linking fail. */
  readonly behaviour: { compileOk: boolean; linkOk: boolean };
  count(name: string): number;
}

/**
 * A stand-in for a canvas with a WebGL2 context. It records every call, which is enough
 * to test what the renderer asks the GPU to do; the pixels themselves are checked by the
 * browser tests.
 */
function createFakeCanvas(hasContext = true): FakeCanvas {
  const calls: GlCall[] = [];
  const behaviour = { compileOk: true, linkOk: true };
  const constants = new Map<string, number>();

  const gl = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (/^[A-Z][A-Z0-9_]*$/.test(property)) {
          // Texture units must be consecutive numbers; other constants only need to differ.
          if (!constants.has(property)) {
            constants.set(property, property === 'TEXTURE0' ? 33984 : 1000 + constants.size);
          }
          return constants.get(property);
        }
        return (...args: unknown[]) => {
          calls.push({ name: property, args });
          switch (property) {
            case 'getShaderParameter':
              return behaviour.compileOk;
            case 'getProgramParameter':
              return behaviour.linkOk;
            case 'getShaderInfoLog':
            case 'getProgramInfoLog':
              return 'syntax error near line 3';
            default:
              return property.startsWith('create') || property === 'getUniformLocation'
                ? { created: property }
                : undefined;
          }
        };
      },
    },
  );

  const canvas = Object.assign(new EventTarget(), {
    width: 300,
    height: 150,
    getContext: () => (hasContext ? gl : null),
  });
  return {
    canvas: canvas as unknown as HTMLCanvasElement,
    calls,
    behaviour,
    count: (name) => calls.filter((call) => call.name === name).length,
  };
}

const WHITE = Color.white();

function drawFrame(renderer: WebGL2Renderer, draw: () => void): void {
  renderer.beginFrame(Color.black());
  renderer.setViewProjection(new Mat3());
  draw();
  renderer.endFrame();
}

describe('WebGL2Renderer setup', () => {
  it('explains that WebGL2 is missing', () => {
    expect(() => new WebGL2Renderer(createFakeCanvas(false).canvas)).toThrow(
      'WebGL2 is not available in this browser',
    );
  });

  it('reports shader compile and link errors with the driver log', () => {
    const compile = createFakeCanvas();
    compile.behaviour.compileOk = false;
    expect(() => new WebGL2Renderer(compile.canvas)).toThrow(
      'Failed to compile the sprite shader: syntax error near line 3',
    );
    expect(compile.count('deleteShader')).toBe(1);

    const link = createFakeCanvas();
    link.behaviour.linkOk = false;
    expect(() => new WebGL2Renderer(link.canvas)).toThrow('Failed to link the sprite shader');
    expect(link.count('deleteProgram')).toBe(1);
  });

  it('reports the drawing buffer size and resizes to whole pixels of at least one', () => {
    const { canvas } = createFakeCanvas();
    const renderer = new WebGL2Renderer(canvas);
    expect([renderer.width, renderer.height]).toEqual([300, 150]);
    renderer.resize(640.9, 0);
    expect([canvas.width, canvas.height]).toEqual([640, 1]);
  });
});

describe('WebGL2Renderer drawing', () => {
  it('draws all quads of a frame with one draw call', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    drawFrame(renderer, () => {
      for (let index = 0; index < 5; index++) {
        renderer.drawQuad(new Mat3(), null, WHITE);
      }
    });
    const draws = fake.calls.filter((call) => call.name === 'drawElements');
    expect(draws).toHaveLength(1);
    // Five quads of two triangles each.
    expect(draws[0]!.args[1]).toBe(30);
    expect(renderer.stats).toEqual({ drawCalls: 1, quads: 5 });
    expect(fake.count('clear')).toBe(1);
  });

  it('starts a new batch when the view changes, and draws nothing for an empty frame', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    drawFrame(renderer, () => {
      renderer.drawQuad(new Mat3(), null, WHITE);
      renderer.setViewProjection(new Mat3(2, 0, 0, 2, 0, 0));
      renderer.drawQuad(new Mat3(), null, WHITE);
    });
    expect(renderer.stats).toEqual({ drawCalls: 2, quads: 2 });

    drawFrame(renderer, () => {});
    expect(renderer.stats).toEqual({ drawCalls: 0, quads: 0 });
  });

  it('binds each texture of a batch to its own texture unit', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    const first = renderer.createTexture(
      { width: 1, height: 1, pixels: new Uint8Array(4) },
      'linear',
    );
    const second = renderer.createTexture(
      { width: 1, height: 1, pixels: new Uint8Array(4) },
      'linear',
    );
    fake.calls.length = 0;
    drawFrame(renderer, () => {
      renderer.drawQuad(new Mat3(), first, WHITE);
      renderer.drawQuad(new Mat3(), second, WHITE);
      renderer.drawQuad(new Mat3(), first, WHITE);
    });
    const units = fake.calls
      .filter((call) => call.name === 'activeTexture')
      .map((call) => call.args[0]);
    expect(units).toEqual([33984, 33985]);
    expect(renderer.stats.drawCalls).toBe(1);
  });
});

describe('WebGL2Renderer textures', () => {
  it('uploads image sources premultiplied by the browser and releases them', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    fake.calls.length = 0;
    const dispose = vi.fn();
    const image = {} as TexImageSource;
    const texture = renderer.createTexture({ width: 8, height: 4, image, dispose }, 'nearest');

    expect(texture).toMatchObject({ width: 8, height: 4 });
    expect(dispose).toHaveBeenCalledOnce();
    const upload = fake.calls.find((call) => call.name === 'texImage2D')!;
    expect(upload.args.at(-1)).toBe(image);
    const premultiply = fake.calls.find(
      (call) => call.name === 'pixelStorei' && call.args[1] === true,
    );
    expect(premultiply).toBeDefined();
  });

  it('premultiplies raw pixels itself', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    fake.calls.length = 0;
    renderer.createTexture(
      { width: 1, height: 1, pixels: new Uint8Array([200, 100, 50, 128]) },
      'linear',
    );
    const upload = fake.calls.find((call) => call.name === 'texImage2D')!;
    expect([...(upload.args.at(-1) as Uint8Array)]).toEqual([100, 50, 25, 128]);
  });

  it('uses the requested filter for both shrinking and enlarging', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    const filtersOf = (filter: 'nearest' | 'linear'): unknown[] => {
      fake.calls.length = 0;
      renderer.createTexture({ width: 1, height: 1, pixels: new Uint8Array(4) }, filter);
      return fake.calls
        .filter((call) => call.name === 'texParameteri')
        .slice(0, 2)
        .map((call) => call.args[2]);
    };
    const nearest = filtersOf('nearest');
    const linear = filtersOf('linear');
    expect(nearest[0]).toBe(nearest[1]);
    expect(linear[0]).toBe(linear[1]);
    expect(nearest[0]).not.toBe(linear[0]);
  });

  it('rejects a texture source without data and deletes textures once', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    expect(() => renderer.createTexture({ width: 1, height: 1 }, 'linear')).toThrow(
      'needs either an image or pixels',
    );

    const texture = renderer.createTexture(
      { width: 1, height: 1, pixels: new Uint8Array(4) },
      'linear',
    );
    fake.calls.length = 0;
    renderer.destroyTexture(texture);
    renderer.destroyTexture(texture);
    expect(fake.count('deleteTexture')).toBe(1);
  });
});

describe('WebGL2Renderer context loss', () => {
  it('stops drawing while the context is lost and asks the browser to restore it', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    const lost = new Event('webglcontextlost', { cancelable: true });
    fake.canvas.dispatchEvent(lost);

    // Without preventDefault the browser would never restore the context.
    expect(lost.defaultPrevented).toBe(true);
    expect(renderer.isContextLost).toBe(true);
    fake.calls.length = 0;
    drawFrame(renderer, () => renderer.drawQuad(new Mat3(), null, WHITE));
    expect(fake.calls).toEqual([]);
    expect(renderer.stats).toEqual({ drawCalls: 0, quads: 0 });
  });

  it('rebuilds its resources and announces it when the context comes back', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    const stale = renderer.createTexture(
      { width: 1, height: 1, pixels: new Uint8Array(4) },
      'linear',
    );
    const restored = vi.fn();
    renderer.onContextRestored.connect(restored);

    fake.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.calls.length = 0;
    fake.canvas.dispatchEvent(new Event('webglcontextrestored'));

    expect(renderer.isContextLost).toBe(false);
    expect(fake.count('createProgram')).toBe(1);
    expect(restored).toHaveBeenCalledOnce();

    // A texture from before the loss has no GPU data; it draws as a solid color instead.
    drawFrame(renderer, () => renderer.drawQuad(new Mat3(), stale, WHITE));
    expect(renderer.stats).toEqual({ drawCalls: 1, quads: 1 });
  });

  it('creates textures without GPU data while the context is lost', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    fake.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    fake.calls.length = 0;
    const texture = renderer.createTexture(
      { width: 2, height: 2, pixels: new Uint8Array(16) },
      'linear',
    );
    expect(texture).toMatchObject({ width: 2, height: 2 });
    expect(fake.count('texImage2D')).toBe(0);
  });
});

describe('WebGL2Renderer disposal', () => {
  it('frees its GPU resources once and stops reacting to context events', () => {
    const fake = createFakeCanvas();
    const renderer = new WebGL2Renderer(fake.canvas);
    renderer.createTexture({ width: 1, height: 1, pixels: new Uint8Array(4) }, 'linear');
    fake.calls.length = 0;

    renderer.dispose();
    renderer.dispose();
    // The texture that was created plus the built-in white texture.
    expect(fake.count('deleteTexture')).toBe(2);
    expect(fake.count('deleteProgram')).toBe(1);
    expect(fake.count('deleteBuffer')).toBe(2);

    fake.calls.length = 0;
    fake.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(fake.calls).toEqual([]);
  });
});
