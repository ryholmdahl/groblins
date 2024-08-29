import type { Application, ContainerChild, TextStyle, TextStyleOptions, Texture } from "pixi.js";
import { Sprite, BitmapText } from "pixi.js";
import { Groblin } from "./groblin";
import type { WorldObject, Collidable, Edible, Movable, Block } from "./objects";
import type { Entries } from "type-fest";

// what checks for collisions? and what determines what happens?
// "dumb world": world is basically just a container for objects. the objects handle things themselves.
// "smart world": world checks for all interactions and determines the outcomes
// "midwit world": world checks for interactions but lets the objects determine the outcomes
// let's try dumb world!

// simplest approach: at each timestep, recalculate what the groblin can see by iterating over all entities
// this is wasteful, because what a groblin sees can only change as it moves or other things move
// option 1: each groblin maintains a

// each object has a "perception set" of positions

type Components = {
  groblin: Groblin;
  collidable: Collidable;
  movable: Movable;
  edible: Edible;
  block: Block;
};

const GROBLIN_MAX_SPEED = 0.07;
const TERMINAL_VELOCITY = 1;
const BERRY_TIMER_MAX = 2;
const GROBLIN_VISION = 10;
const GRAVITY = 3;
const JUMP_POP = 0.07;

function isInstance<T extends keyof Components>(
  object: Components[T] | WorldObject,
  type: T
): object is Components[T] {
  return (<Components[T]>object)[type as keyof Components] !== undefined;
}

class SetMap<K, T> extends Map<K, Set<T>> {
  get(key: K): Set<T> {
    if (!super.get(key)) {
      this.set(key, new Set<T>());
    }
    return super.get(key)!;
  }
  add(key: K, value: T): void {
    this.get(key).add(value);
  }
  remove(key: K, value: T): void {
    this.get(key).delete(value);
  }
  filter(fn: (key: K, value: T) => boolean): SetMap<K, T> {
    const filtered = new SetMap<K, T>();
    this.forEach((values, key) =>
      values.forEach((value) => {
        if (fn(key, value)) filtered.add(key, value);
      })
    );
    return filtered;
  }
}

type WorldView = {
  objects: { all: WorldObject[] } & { [Property in keyof Components]: Components[Property][] };
  collidingPairs: SetMap<Collidable, Collidable>;
};

class World {
  width: number;
  height: number;
  view: WorldView = {
    objects: { all: [], groblin: [], collidable: [], movable: [], edible: [], block: [] },
    collidingPairs: new SetMap()
  };
  collidablePairs: [Collidable, Collidable][] = [];
  positions: Map<{ x: number; y: number }, Array<WorldObject>> = new Map();
  berryTimer: number = BERRY_TIMER_MAX;
  initialized: boolean = false;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  add<T extends WorldObject>(object: T): T {
    if (isInstance(object, "collidable")) {
      this.view.objects.collidable
        .filter(
          (collidable) =>
            collidable.collidesWith.has(object.group) && object.collidesWith.has(collidable.group)
        )
        .forEach((collidable) => this.collidablePairs.push([collidable, object]));
    }
    (Object.entries(this.view.objects) as Entries<WorldView["objects"]>).forEach(
      ([component, array]) => {
        if (component === "all") {
          (array as WorldObject[]).push(object);
        } else if (isInstance(object, component)) {
          (array as Components[keyof Components][]).push(object as Components[keyof Components]);
        }
      }
    );

    return object;
  }

  remove(object: WorldObject): void {
    (Object.entries(this.view.objects) as Entries<WorldView["objects"]>).forEach(
      ([component, array]) => {
        if (component === "all" || isInstance(object, component)) {
          array.splice(array.indexOf(object as any), 1);
        }
      }
    );
    if (isInstance(object, "collidable")) {
      this.view.objects.collidable.forEach((collidable) =>
        this.collidablePairs.push([collidable, object])
      );
    }
  }

  // TODO: better caching
  private getView(object: WorldObject, range: number = 10): WorldView {
    const visible = new Set<WorldObject>();
    this.view.objects.all
      .filter((other) => Math.sqrt((object.x - other.x) ** 2 + (object.y - other.y) ** 2) <= range)
      .forEach((other) => visible.add(other));
    return {
      objects: Object.fromEntries(
        (Object.entries(this.view.objects) as Entries<WorldView["objects"]>).map(([key, array]) => [
          key,
          array.filter((other) => visible.has(other))
        ])
      ) as WorldView["objects"],
      collidingPairs: this.view.collidingPairs.filter(
        (key, value) => visible.has(key) && visible.has(value)
      )
    };
  }

  private checkExposure() {
    this.view.objects.block.forEach((block: Block) => {
      block.exposed.left = !this.view.objects.block.some(
        (other) => other.y === block.y && other.x === block.x - 1
      );
      block.exposed.right = !this.view.objects.block.some(
        (other) => other.y === block.y && other.x === block.x + 1
      );
      block.exposed.top = !this.view.objects.block.some(
        (other) => other.y === block.y - 1 && other.x === block.x
      );
      block.exposed.bottom = !this.view.objects.block.some(
        (other) => other.y === block.y + 1 && other.x === block.x
      );
    });
  }

  tick(delta: number): void {
    const applyGravity = (movable: Movable) => {
      {
        if (!movable.landed && movable.velocity.y < TERMINAL_VELOCITY) {
          movable.velocity.y += delta * GRAVITY;
        }
      }
    };

    const groblinSetPlan = (groblin: Groblin) => {
      Object.entries(groblin.needs).forEach(([need, tracker]) => {
        tracker.tick(delta);
        if (!groblin.priority || tracker.urgency() > groblin.needs[groblin.priority].urgency()) {
          groblin.priority = need as Groblin["priority"];
        }
      });
      groblin.plan = groblin.needs[groblin.priority!].plan(
        groblin,
        this.getView(groblin, GROBLIN_VISION)
      );
    };

    const groblinMove = (groblin: Groblin, to: { x: number; y: number }) => {
      const directionX = Math.sign(to.x - groblin.x);

      if (directionX !== 0) {
        const blockInFront = this.view.objects.block.some(
          (block) =>
            Math.abs(block.x - groblin.x) <= 1 &&
            Math.sign(block.x - groblin.x) === directionX &&
            Math.abs(block.y - groblin.y) < block.height
        );

        if (blockInFront) {
          groblin.velocity.y = -GROBLIN_MAX_SPEED;
          groblin.velocity.x = 0;
        } else {
          groblin.velocity.x = GROBLIN_MAX_SPEED * directionX;
        }
      }

      // move towards it, jumping over 1 block height if necessary
      // if (groblin.landed && directionX !== 0) {
      //   if (
      //     Math.sign(groblin.velocity.x) !== directionX ||
      //     Math.abs(groblin.velocity.x) < GROBLIN_MAX_SPEED
      //   ) {
      //     groblin.velocity.x = GROBLIN_MAX_SPEED * directionX;
      //   }
      //   // Check if there's a block in front of the groblin
      //   const blockInFront = this.view.objects.block.some(
      //     (block) =>
      //       Math.abs(block.x - groblin.x) <= 2 &&
      //       Math.sign(block.x - groblin.x) === directionX &&
      //       Math.abs(block.y - groblin.y) < 0.5
      //   );

      //   if (blockInFront) {
      //     groblin.velocity.y = -GROBLIN_MAX_SPEED;
      //   }
      // }
    };

    //

    const collideWithBlock = (movable: Movable, block: Block) => {
      if (
        block.exposed.top &&
        movable.velocity.y > 0 &&
        movable.y + movable.height / 2 <= block.y - block.height / 2 + movable.velocity.y + 1e-5
      ) {
        movable.velocity.y = 0;
        movable.y = block.y - block.height / 2 - movable.height / 2;
        movable.landed = true;
      } else if (
        block.exposed.left &&
        movable.velocity.x > 0 &&
        movable.x + movable.width / 2 <= block.x - block.width / 2 + movable.velocity.x
      ) {
        movable.x = block.x - block.width / 2 - movable.width / 2 - movable.velocity.x;
        movable.velocity.x *= -0.25;
      } else if (
        block.exposed.bottom &&
        movable.velocity.y < 0 &&
        movable.y - movable.height / 2 >= block.y + block.height / 2 + movable.velocity.y
      ) {
        movable.velocity.y *= -1;
        movable.y = block.y + block.height / 2 + movable.height / 2;
      } else if (
        block.exposed.right &&
        movable.velocity.x < 0 &&
        movable.x - movable.width / 2 >= block.x + block.width / 2 + movable.velocity.x
      ) {
        movable.x = block.x + block.width / 2 + movable.width / 2 + movable.velocity.x;
        movable.velocity.x *= -0.25;
      }
    };

    if (!this.initialized) {
      this.initialized = true;
      this.checkExposure();
    }

    this.berryTimer -= delta;
    if (this.berryTimer <= 0) {
      this.berryTimer = BERRY_TIMER_MAX;
      this.add<Edible>({
        x: Math.random() * 50,
        y: 0,
        width: 1,
        height: 1,
        density: 1,
        velocity: { x: 0, y: 0 },
        landed: false,
        food: 20,
        group: 0,
        collidesWith: new Set([0, 1]),
        collidable: true,
        movable: true,
        edible: true
      });
    }

    this.view.objects.movable.forEach(applyGravity);
    // update groblins
    this.view.objects.groblin.forEach((groblin) => {
      groblinSetPlan(groblin);
      if (groblin.plan && groblin.plan.type === "move") {
        groblinMove(groblin, groblin.plan.to);
      }
      if (groblin.plan && groblin.plan.type === "eat") {
        groblin.needs.food.add(groblin.plan.what.food);
        this.remove(groblin.plan.what);
      }
    });
    this.view.objects.movable.forEach((movable) => (movable.landed = false));
    // check for collisions among collidables and do something
    // TODO: filter out blocks that aren't exposed
    // TODO: 2d spatial partitioning
    this.collidablePairs.forEach(([object1, object2]) => {
      if (
        Math.abs(object1.x - object2.x) < (object1.width + object2.width) / 2 &&
        Math.abs(object1.y - object2.y) < (object1.height + object2.height) / 2
      ) {
        // Involuntary interactions go here
        this.view.collidingPairs.add(object1, object2);
        this.view.collidingPairs.add(object2, object1);
        [
          [object1, object2],
          [object2, object1]
        ].forEach(([o1, o2]) => {
          if (isInstance(o1, "movable") && isInstance(o2, "block")) {
            collideWithBlock(o1, o2);
          }
        });
      } else {
        this.view.collidingPairs.remove(object1, object2);
        this.view.collidingPairs.remove(object2, object1);
      }
    });
    this.view.objects.movable.forEach((movable) => {
      movable.x += movable.velocity.x;
      movable.y += movable.velocity.y;
      if (movable.landed) {
        movable.velocity.x = 0;
      }
    });
  }
}

class PixiWorld extends World {
  app: Application;
  blockSize: number;
  textures: { groblin: Texture; berry: Texture; block: Texture };
  sprites: Map<WorldObject, ContainerChild> = new Map();
  followFields: Map<WorldObject, BitmapText> = new Map();

  constructor(
    width: number,
    height: number,
    app: Application,
    blockSize: number,
    textures: PixiWorld["textures"]
  ) {
    super(width, height);
    this.app = app;
    this.blockSize = blockSize;
    this.textures = textures;
  }

  add<T extends WorldObject>(object: T): T {
    super.add(object);
    let texture: Texture | undefined = undefined;
    let textStyle: TextStyleOptions | undefined = undefined;
    if (isInstance(object, "groblin")) {
      texture = this.textures.groblin;
      textStyle = {
        fontFamily: "Arial",
        fontSize: 12,
        fill: "white",
        align: "center"
      };
    }
    if (isInstance(object, "edible")) {
      texture = this.textures.berry;
    }
    if (isInstance(object, "block")) {
      texture = this.textures.block;
    }
    if (texture) {
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale =
        ((this.blockSize * object.width) / texture.width,
        (this.blockSize * object.height) / texture.height);
      this.app.stage.addChild(sprite);
      this.sprites.set(object, sprite);
    }
    if (textStyle) {
      const text = new BitmapText({ text: "foobar", style: textStyle });
      this.app.stage.addChild(text);
      this.followFields.set(object, text);
    }
    return object;
  }

  remove(object: WorldObject) {
    super.remove(object);
    const sprite = this.sprites.get(object);
    if (sprite) {
      this.app.stage.removeChild(sprite);
    }
    this.sprites.delete(object);
  }

  tick(delta: number) {
    super.tick(delta);
    this.view.objects.all.forEach((object) => {
      this.sprites.get(object)!.x = object.x * this.blockSize;
      this.sprites.get(object)!.y = object.y * this.blockSize;
      const text = this.followFields.get(object);
      if (text) {
        text.x = object.x * this.blockSize;
        text.y = object.y * this.blockSize;
        if (isInstance(object, "groblin")) {
          const needs = (Object.entries(object.needs) as Entries<Groblin["needs"]>).map(
            ([need, tracker]) => `${need}: ${Math.round(tracker.get())}\n`
          );
          text.text = `${object.name}\n${needs}\npriority: ${object.priority}\nplan: ${object.plan!.type}`;
        }
      }
    });
  }
}

export { PixiWorld };
export type { WorldView };
