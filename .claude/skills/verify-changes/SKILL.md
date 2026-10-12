---
name: verify-changes
description: Review and verify a change to Rowan before committing it. Use before every commit, and whenever asked to check, verify, review or finish work in this repository.
---

# Verify changes before committing

Nothing is committed in this repository until it has been reviewed and has passed every check.
Do the steps in order and fix what each one finds before moving on.

## 1. Review the diff

Run `git status --short` and `git diff` (plus `git diff --cached` if anything is staged), and
read every changed line as a reviewer who did not write it. Check against `AGENTS.md`:

- Does each change have a unit test next to it that would fail without the change?
- New or changed component field or scripting API member: is it exercised by a probe script in
  `packages/feature-test/src/scripts/`?
- Are errors actionable `RowanError`s? Is anything swallowed silently?
- Does anything rely on a class or function name at runtime (`type.name`, `constructor.name`)?
  Minified builds break that.
- Per-frame code: does it allocate objects it could reuse?
- Did a serialized format change? Then the version must be bumped and old data migrated.
- Dependency direction: `core` must not import from other packages, the player must not import
  `@rowan/core/compiler`, and `packages/editor/src/core` must not import React or use the DOM.
- Leftovers: debug output, commented-out code, stray files, TODOs without an owner.
- Is `Instructions.md` untouched?

## 2. Run the checks

```sh
npm run check
```

This runs the typecheck, ESLint, the Prettier check and all unit tests. All four must pass with
no warnings. Fix formatting with `npm run format` (it leaves `Instructions.md` alone).

## 3. Run the browser tests when the change can affect what users see

Required when the diff touches `packages/core/src/renderer`, `packages/core/src/runtime`,
`packages/runtime`, `packages/editor`, `packages/feature-test` or `e2e`:

```sh
npm run test:e2e
```

It builds everything first. The tests run the minified build, which is the only place some bugs
show up. If a test fails, the screenshot and trace are under `test-results/`; open a trace with
`npx playwright show-trace <path to trace.zip>`.

## 4. Commit and push

Commit only when steps 1 to 3 are clean. Write a message with a short imperative subject and a
body that says what changed and why. Stage files by name; do not stage `Instructions.md` unless
the owner asked for it. Then `git push origin main`.

Report the outcome truthfully: say which checks ran and their results, and say so plainly if
something was skipped or is still failing.
