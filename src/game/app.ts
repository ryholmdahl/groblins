import { Application, Assets } from "pixi.js";
import bunnyPng from "../../resources/bunny.png";
import cherryPng from "../../resources/cherries.png";
import blockPng from "../../resources/icon.png";
import { PixiWorld } from "./world";
import { FoodTracker, RelaxTracker } from "./groblin";
import type { Groblin } from "./groblin";
import type { Edible, Block, Cave } from "./objects";
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

  const width = 50;
  const height = 30;

  const world = new PixiWorld(width, height, app, 20, {
    groblin: await Assets.load(bunnyPng),
    berry: await Assets.load(cherryPng),
    block: await Assets.load(blockPng),
    cave: await Assets.load(cherryPng)
  });

  const addBlock = (x: number, y: number) => {
    world.add<Block>({
      x,
      y,
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
  };

  const addCave = (x: number, y: number) => {
    world.add<Cave>({
      x,
      y,
      width: 1,
      height: 1,
      group: 1,
      collidesWith: new Set([0]),
      collidable: true,
      cave: true
    });
  };

  const terrain = generateTerrain(width, height);
  terrain.forEach(({ x, y, cave }) => {
    // const upTo = x === 11 ? y - 4 : y;
    if (cave) {
      addCave(x, y);
    } else {
      addBlock(x, y);
    }
  });

  for (let x = 0; x <= width; x++) {
    addBlock(x, height);
    addBlock(x, 0);
  }
  for (let y = 0; y <= height; y++) {
    addBlock(width, y);
    addBlock(0, y);
  }

  world.add<Groblin>({
    x: 10,
    y: 5,
    width: 0.9, // keep objects slightly narrower so they don't get stuck between blocks
    height: 1,
    density: 1,
    velocity: { x: 0, y: 0 },
    landed: null,
    crawling: null,
    needs: {
      food: new FoodTracker(50, 100, {
        starving: 10,
        hungry: 30,
        full: 70
      }),
      relax: new RelaxTracker(50, 100)
    },
    name: "Greebus",
    group: 0,
    collidesWith: new Set([0, 1]),
    collidable: true,
    movable: true,
    groblin: true
  });

  world.add<Edible>({
    x: 10,
    y: 5,
    width: 0.9,
    height: 0.9,
    density: 1,
    velocity: { x: 0, y: 0 },
    landed: null,
    food: 20,
    group: 0,
    collidesWith: new Set([0, 1]),
    collidable: true,
    movable: true,
    edible: true
  });

  app.canvas.addEventListener("pointerdown", (event) => world.pointerDown(event.x, event.y));
  // Add an animation loop callback to the application's ticker.
  app.ticker.add((time) => {
    world.tick(time.deltaMS / 1000);
  });
}

export { createApp };
