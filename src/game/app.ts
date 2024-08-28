import { Application, Assets } from "pixi.js";
import bunnyPng from "../../resources/bunny.png";
import cherryPng from "../../resources/cherries.png";
import blockPng from "../../resources/icon.png";
import { PixiWorld } from "./world";
import { FoodTracker, RelaxTracker } from "./groblin";
import type { Groblin } from "./groblin";
import type { Edible, Block } from "./objects";
import { generateTerrain } from "./mapgen";

async function createApp() {
  // Create a PixiJS application.
  const app = new Application();

  // Intialize the application.
  await app.init({ background: "#1099bb", resizeTo: window });

  // Then adding the application's canvas to the DOM body.
  document.body.appendChild(app.canvas);

  // Load the bunny texture.

  // Create a new Sprite from an image path.
  //   const bunny = new Sprite(texture);

  const world = new PixiWorld(100, 100, app, 20, {
    groblin: await Assets.load(bunnyPng),
    berry: await Assets.load(cherryPng),
    block: await Assets.load(blockPng)
  });

  const terrain = generateTerrain(50, 20);
  terrain.forEach(({ x, y }) => {
    for (let i = 49; i > y; i--) {
      world.add<Block>({
        x,
        y: i,
        width: 1,
        height: 1,
        group: 1,
        exposed: {
          top: true,
          bottom: true,
          left: true,
          right: true
        },
        collidesWith: new Set([0]),
        collidable: true,
        block: true
      });
    }
  });

  world.add<Groblin>({
    x: 10,
    y: 0,
    width: 0.75,
    height: 0.75,
    density: 1,
    velocity: { x: 0, y: 0 },
    landed: false,
    needs: {
      food: new FoodTracker(50, 100, {
        starving: 10,
        hungry: 30,
        full: 70
      }),
      relax: new RelaxTracker(50, 100)
    },
    group: 0,
    collidesWith: new Set([0, 1]),
    collidable: true,
    movable: true,
    groblin: true
  });

  world.add<Edible>({
    x: 20,
    y: 0,
    width: 1,
    height: 1,
    density: 1,
    velocity: { x: 0, y: 0 },
    landed: false,
    food: 100,
    group: 0,
    collidesWith: new Set([0, 1]),
    collidable: true,
    movable: true,
    edible: true
  });

  // Add an animation loop callback to the application's ticker.
  app.ticker.add((time) => {
    world.tick(time.deltaMS / 1000);
  });
}

export { createApp };
