import { Application, Assets } from "pixi.js";
import bunnyPng from "../../resources/bunny.png";
import cherryPng from "../../resources/cherries.png";
import blockPng from "../../resources/icon.png";
import { PixiWorld } from "./world";
import type { World } from "./world";
import { FoodTracker, RelaxTracker } from "./groblin";
import { block, cave, groblin } from "./objects";
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

  const width = 500;
  const height = 300;

  const world: World = new PixiWorld(width, height, app, 20, {
    groblin: await Assets.load(bunnyPng),
    berry: await Assets.load(cherryPng),
    block: await Assets.load(blockPng),
    cave: await Assets.load(cherryPng)
  });

  const terrain = generateTerrain(width, height);
  terrain.forEach(({ x, y, cave: isCave }) => {
    if (isCave) {
      world.add(cave({ x, y }));
    } else {
      world.add(
        block({
          x,
          y
        })
      );
    }
  });

  for (let x = 0; x <= width; x++) {
    world.add(block({ x, y: height }));
    world.add(block({ x, y: 0 }));
  }
  for (let y = 0; y <= height; y++) {
    world.add(block({ x: width, y }));
    world.add(block({ x: 0, y }));
  }

  world.add(
    groblin({
      x: 10,
      y: 5,
      width: 0.9, // keep objects slightly narrower so they don't get stuck between blocks
      height: 1,
      density: 1,
      velocity: { x: 0, y: 0 },
      needs: {
        food: new FoodTracker(50, 100, {
          starving: 10,
          hungry: 30,
          full: 70
        }),
        relax: new RelaxTracker(50, 100)
      },
      name: "Greebus"
    })
  );

  world.add(
    groblin({
      x: 40,
      y: 5,
      width: 0.9, // keep objects slightly narrower so they don't get stuck between blocks
      height: 1,
      density: 1,
      velocity: { x: 0, y: 0 },
      needs: {
        food: new FoodTracker(50, 100, {
          starving: 10,
          hungry: 30,
          full: 70
        }),
        relax: new RelaxTracker(50, 100)
      },
      name: "Zek"
    })
  );

  app.canvas.addEventListener("pointerdown", (event) => world.pointerDown(event.x, event.y));
  window.addEventListener("keydown", (event) => world.keyDown(event.key));
  window.addEventListener("keyup", (event) => world.keyUp(event.key));
  // Add an animation loop callback to the application's ticker.
  app.ticker.add((time) => {
    world.tick(Math.min(time.deltaMS / 1000, 1 / 60));
  });
}

export { createApp };
