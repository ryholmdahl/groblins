import type { Application, Texture } from "pixi.js";
import { Sprite } from "pixi.js";
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

const GROBLIN_JUMP_HEIGHT = 1;
const GROBLIN_MAX_SPEED = 0.1;
const TERMINAL_VELOCITY = 1;

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

  tick(delta: number): void {
    // check which sides of each block are exposed
    // TODO: make this more efficient; only run it once and when a block is removed
    this.view.objects.block.forEach((block) => {
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
    this.view.objects.movable.forEach((movable) => {
      if (!movable.landed && movable.velocity.y < TERMINAL_VELOCITY) {
        movable.velocity.y += delta;
      }
    });
    // update groblins
    this.view.objects.groblin.forEach((groblin) => {
      Object.entries(groblin.needs).forEach(([need, tracker]) => {
        tracker.tick(delta);
        if (!groblin.priority || tracker.urgency() > groblin.needs[groblin.priority].urgency()) {
          groblin.priority = need as Groblin["priority"];
        }
      });
      groblin.plan = groblin.needs[groblin.priority!].plan(groblin, this.getView(groblin, 100));
      if (groblin.plan && groblin.plan.type === "move") {
        // check if object is to the left or to the right of the groblin
        const to = groblin.plan.to;
        const directionX = Math.sign(to.x - groblin.x);

        // move towards it, jumping over 1 block height if necessary
        if (directionX !== 0) {
          if (Math.abs(groblin.velocity.x) < GROBLIN_MAX_SPEED) {
            groblin.velocity.x += delta * directionX;
          }
          // Check if there's a block in front of the groblin
          const blockInFront = this.view.objects.block.some(
            (block) =>
              Math.abs(block.x - groblin.x) <= 2 &&
              Math.sign(block.x - groblin.x) === directionX &&
              Math.abs(block.y - groblin.y) < 0.5
          );

          if (blockInFront && groblin.landed) {
            const jumpHeight = GROBLIN_JUMP_HEIGHT;
            groblin.velocity.y = -Math.sqrt(0.04 * jumpHeight);
          }
        }
      }
      if (groblin.plan!.type === "eat") {
        this.remove(groblin.plan.what);
      }
    });
    this.view.objects.movable.forEach((movable) => {
      movable.landed = false;
    });
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
            if (
              o2.exposed.top &&
              o1.velocity.y > 0 &&
              o1.y + o1.height / 2 <= o2.y - o2.height / 2 + o1.velocity.y
            ) {
              o1.velocity.y = 0;
              o1.y = o2.y - o2.height / 2 - o1.height / 2;
              o1.landed = true;
            } else if (
              o2.exposed.left &&
              o1.velocity.x > 0 &&
              o1.x + o1.width / 2 <= o2.x - o2.width / 2 + o1.velocity.x
            ) {
              o1.velocity.x = 0;
              o1.x = o2.x - o2.width / 2 - o1.width / 2;
            } else if (
              o2.exposed.bottom &&
              o1.velocity.y < 0 &&
              o1.y - o1.height / 2 >= o2.y + o2.height / 2 + o1.velocity.y
            ) {
              o1.velocity.y = 0;
              o1.y = o2.y + o2.height / 2 + o1.height / 2;
            } else if (
              o2.exposed.right &&
              o1.velocity.x < 0 &&
              o1.x - o1.width / 2 >= o2.x + o2.width / 2 + o1.velocity.x
            ) {
              o1.velocity.x = 0;
              o1.x = o2.x + o2.width / 2 + o1.width / 2;
            }
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
    });
  }
}

class PixiWorld extends World {
  app: Application;
  blockSize: number;
  textures: { groblin: Texture; berry: Texture; block: Texture };
  sprites: Map<WorldObject, Sprite> = new Map();

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
    if (isInstance(object, "groblin")) {
      texture = this.textures.groblin;
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
    });
  }
}

export { PixiWorld };
export type { WorldView };
