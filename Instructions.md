# Web Game Engine

We Are building a indie game engine, that runs natively in the browser, with every feature avaible in the broswer. This is professional-grade software that needs to be stable, fully-tested, and real-world deployable. No hacks, no shortcuts - solid as a rock.

## Dev Workflow

- IMRORTANT! DO NOT look outside of working directory or use other code on my computer as reference
- Start by asking question to determine engine name. Suggest a few
- Testing is of the utmost importance - use unit tests (any framework, simple is good), run automated testing
- Setup a scene used for testing, which tests every single feature in the engine - all components, and entire scripting API
- Do things properly, this is production-grade and not a hack project
- Create AGENTS.md and relevant skills to support development, and contain concrete development guidelines

- Create git repository, commit and push to GitHub repo. IMPORTANT: do a code review before committing, and make sure all changes comply with code style, production-grade quality standards, and have been properly tested/have unit tests that have passed where necessary

## Tech stack
- Up to you, but if you decide to use web technologies, use Typescript. 

## Basic Architecture

- Static library for core engine, executable for editor and runtime (depending on chosen design)
- Need to have editor to build games - this can be embedded into runtime executable (and stripped from distribution builds), or can be a standalone executable
- Simple ECS perhaps, to author scene with entities and components
- Ability to "export" game - executable that runs game without editing ability that we can distribute
- Similar UI and UX interface to unity engine

## 2D Renderer
- Ability to import sprites, png, and other 2d art formats
- Editor has gizmo to position in the world
- Sounds

## 2D Physics

- Use simple 2D physics library of your choosing
- Controllable via scripting, authored via components in editor

## Behavior

- You choose your own scripting language
- Control entities/components and run in update loop, and entity destruction/creation
- Spawn new entities/prefabs

