import { Behaviour, Color, MathUtils, Vec2, type ScriptLifecycle } from 'rowan';
import { harnessOf } from './support';

/** Exercises the math types available to scripts: Vec2, Color and MathUtils. */
export default class MathProbe extends Behaviour implements ScriptLifecycle {
  onStart(): void {
    const test = harnessOf(this);
    const vector = new Vec2(3, 4);

    test.check('Vec2 x and y', vector.x === 3 && vector.y === 4);
    test.check(
      'Vec2.zero, one, up and right',
      Vec2.zero().add(Vec2.one()).equals(Vec2.up().add(Vec2.right())),
    );
    test.check('Vec2.fromAngle', Vec2.fromAngle(0).equals(Vec2.right()));
    test.check('Vec2.fromArray and toArray', Vec2.fromArray([7, 8]).toArray().join() === '7,8');
    test.check('Vec2.set', new Vec2().set(1, 2).equals(new Vec2(1, 2)));
    test.check('Vec2.copy', new Vec2().copy(vector).equals(vector));
    test.check('Vec2.clone', vector.clone() !== vector && vector.clone().equals(vector));
    test.check('Vec2.add', vector.clone().add(new Vec2(1, 1)).equals(new Vec2(4, 5)));
    test.check('Vec2.sub', vector.clone().sub(new Vec2(1, 1)).equals(new Vec2(2, 3)));
    test.check('Vec2.scale', vector.clone().scale(2).equals(new Vec2(6, 8)));
    test.check('Vec2.multiply', vector.clone().multiply(new Vec2(2, 0.5)).equals(new Vec2(6, 2)));
    test.check('Vec2.negate', vector.clone().negate().equals(new Vec2(-3, -4)));
    test.check('Vec2.dot', vector.dot(new Vec2(1, 2)) === 11);
    test.check('Vec2.cross', Vec2.right().cross(Vec2.up()) === 1);
    test.check('Vec2.length', vector.length() === 5);
    test.check('Vec2.lengthSquared', vector.lengthSquared() === 25);
    test.near('Vec2.normalize', vector.clone().normalize().length(), 1);
    test.check('Vec2.distanceTo', vector.distanceTo(Vec2.zero()) === 5);
    test.near('Vec2.angle', Vec2.up().angle(), Math.PI / 2);
    test.check(
      'Vec2.rotate',
      Vec2.right()
        .rotate(Math.PI / 2)
        .equals(Vec2.up()),
    );
    test.check('Vec2.lerp', Vec2.zero().lerp(new Vec2(10, 20), 0.5).equals(new Vec2(5, 10)));
    test.check('Vec2.toString', vector.toString() === 'Vec2(3, 4)');

    const orange = new Color(1, 0.5, 0, 1);
    test.check(
      'Color r, g, b and a',
      orange.r === 1 && orange.g === 0.5 && orange.b === 0 && orange.a === 1,
    );
    test.check(
      'Color.white, black and transparent',
      Color.white().r === 1 && Color.black().r === 0 && Color.transparent().a === 0,
    );
    test.check('Color.fromHex', Color.fromHex('#ff0000').equals(new Color(1, 0, 0, 1)));
    test.check('Color.toHex', orange.toHex() === '#ff8000' && orange.toHex(true) === '#ff8000ff');
    test.check(
      'Color.fromArray and toArray',
      Color.fromArray([0, 1, 0, 0.5]).toArray().join() === '0,1,0,0.5',
    );
    test.check('Color.set', new Color().set(0, 0, 1).equals(new Color(0, 0, 1, 1)));
    test.check('Color.copy', new Color().copy(orange).equals(orange));
    test.check('Color.clone', orange.clone() !== orange && orange.clone().equals(orange));
    test.check(
      'Color.lerp',
      Color.black()
        .lerp(Color.white(), 0.5)
        .equals(new Color(0.5, 0.5, 0.5, 1)),
    );
    test.check('Color.toString', orange.toString() === 'Color(1, 0.5, 0, 1)');

    test.check('MathUtils.EPSILON', MathUtils.EPSILON > 0 && MathUtils.EPSILON < 0.001);
    test.check(
      'MathUtils.clamp',
      MathUtils.clamp(5, 0, 3) === 3 && MathUtils.clamp(-5, 0, 3) === 0,
    );
    test.check('MathUtils.lerp', MathUtils.lerp(10, 20, 0.25) === 12.5);
    test.check('MathUtils.inverseLerp', MathUtils.inverseLerp(10, 20, 12.5) === 0.25);
    test.near('MathUtils.degToRad', MathUtils.degToRad(180), Math.PI);
    test.near('MathUtils.radToDeg', MathUtils.radToDeg(Math.PI), 180);
    test.check('MathUtils.approximately', MathUtils.approximately(0.1 + 0.2, 0.3));
    test.near('MathUtils.wrapAngle', MathUtils.wrapAngle(Math.PI * 2.5), Math.PI / 2);
    test.check(
      'MathUtils.moveTowards',
      MathUtils.moveTowards(0, 10, 3) === 3 && MathUtils.moveTowards(9, 10, 3) === 10,
    );
    test.check('MathUtils.smoothStep', MathUtils.smoothStep(0, 1, 0.5) === 0.5);
    const random = MathUtils.randomRange(2, 3);
    test.check('MathUtils.randomRange', random >= 2 && random < 3);
  }
}
