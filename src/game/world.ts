import type { Application, ContainerChild, TextStyleOptions, Texture } from "pixi.js";
import { Sprite, BitmapText } from "pixi.js";
import type { Entity, EntityWithComponents, ComponentMap } from "./ecs";
import { hasComponents } from "./ecs";
import { berry, block, cave } from "./objects";
import type { Entries } from "type-fest";
import PF from "pathfinding";

const TERMINAL_VELOCITY = 10;
const BERRY_TIMER_MAX = 0.1;
const GRAVITY = 100;
const JUMP_POP = 15;
const WALL_ELASTICITY = 0.1;
const DRAG = 3;
const PAN_SPEED = 1000;
const GRID_SIZE = 2;

class Profiler {
  private starts: [string, number][] = [];
  private deltas: Map<string, [number, number]> = new Map(); // delta and depth
  private lastLogTime: number = performance.now();

  start(key: string) {
    this.starts.push([key, performance.now()]);
  }

  end(expectedKey: string) {
    const [key, time] = this.starts.pop()!;
    if (key !== expectedKey) {
      throw new Error(`Expected key ${expectedKey} but got ${key}`);
    }
    if (!this.deltas.has(key)) {
      this.deltas.set(key, [0, this.starts.length]);
    }
    const [delta, depth] = this.deltas.get(key)!;
    this.deltas.set(key, [delta + performance.now() - time, Math.max(depth, this.starts.length)]);
  }

  log(metadata: Partial<Record<string, number>>) {
    const logDelta = performance.now() - this.lastLogTime;
    if (logDelta > 3000) {
      console.log(
        [...this.deltas.entries()]
          .reverse()
          .map(
            ([key, [delta, depth]]) =>
              `${" ".repeat(depth * 2)}${key}: ${delta.toFixed(2)}ms (${((delta / logDelta) * 100).toFixed(2)}%)`
          )
          .join("\n")
      );
      console.log(metadata);
      this.starts.length = 0;
      this.deltas.clear();
      this.lastLogTime = performance.now();
    }
  }
}

const PROFILER = new Profiler();

function collision(
  object1: EntityWithComponents<["positioned", "collidable"]>,
  object2: EntityWithComponents<["positioned", "collidable"]>
) {
  return (
    object1.collidesWith.has(object2.group) &&
    object2.collidesWith.has(object1.group) &&
    intersection(object1, object2)
  );
}

function intersection(
  object1: { x: number; y: number; width: number; height: number },
  object2: { x: number; y: number; width: number; height: number }
) {
  return (
    Math.abs(object1.x - object2.x) <= (object1.width + object2.width) / 2 &&
    Math.abs(object1.y - object2.y) <= (object1.height + object2.height) / 2 + 1e-5
  ); // without the 1e-5, objects like berries will jitter between landed and floating
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

class EntityCollection {
  private entities: Set<Entity> = new Set();
  private componentMap: SetMap<keyof ComponentMap, Entity> = new SetMap();

  add(entity: Entity): void {
    this.entities.add(entity);
    entity.listComponents().forEach((component) => {
      this.componentMap.add(component, entity);
    });
  }

  remove(entity: Entity): void {
    this.entities.delete(entity);
    entity.listComponents().forEach((component) => {
      this.componentMap.remove(component, entity);
    });
  }

  all(): EntityWithComponents<[]>[] {
    return Array.from(this.entities);
  }

  having<
    T extends (keyof ComponentMap)[],
    E extends (keyof ComponentMap)[] | undefined = undefined
  >(
    components: T,
    exclude?: E
  ): EntityWithComponents<
    Exclude<T[number], E extends (keyof ComponentMap)[] ? E[number] : never>[]
  >[] {
    const [firstComponent, ...restComponents] = components;
    const candidates = this.componentMap.get(firstComponent) || new Set();
    const included = Array.from(candidates).filter((entity) =>
      restComponents.every((component) => this.componentMap.get(component)?.has(entity))
    ) as EntityWithComponents<T>[];
    return included.filter(
      (entity) =>
        !exclude || !exclude.some((component) => this.componentMap.get(component).has(entity))
    ) as EntityWithComponents<
      Exclude<T[number], E extends (keyof ComponentMap)[] ? E[number] : never>[]
    >[];
  }
}

class Partitions {
  private partitions: SetMap<string, EntityWithComponents<["positioned", "collidable"]>> =
    new SetMap();
  private reversePartitions: Map<EntityWithComponents<["positioned", "collidable"]>, string> =
    new Map();
  private moved: Set<string> = new Set();

  private getCellKey: (x: number, y: number) => string = (x: number, y: number) =>
    `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;

  add(entity: EntityWithComponents<["positioned", "collidable"]>) {
    const key = this.getCellKey(entity.x, entity.y);
    this.partitions.add(key, entity);
    this.reversePartitions.set(entity, key);
    if (hasComponents(entity, ["movable"])) {
      this.moved.add(key);
    }
  }

  remove(entity: EntityWithComponents<["positioned", "collidable"]>) {
    const key = this.getCellKey(entity.x, entity.y);
    this.partitions.remove(key, entity);
    this.reversePartitions.delete(entity);
  }

  move(entity: EntityWithComponents<["positioned", "collidable", "movable"]>) {
    this.moved.add(this.getCellKey(entity.x, entity.y));
    if (this.reversePartitions.get(entity) !== this.getCellKey(entity.x, entity.y)) {
      this.partitions.remove(this.reversePartitions.get(entity)!, entity);
      this.add(entity);
    }
  }

  hasMoved(entity: EntityWithComponents<["positioned", "collidable", "movable"]>) {
    return this.moved.has(this.getCellKey(entity.x, entity.y));
  }

  neighborhoodsWithMovement(): EntityWithComponents<["positioned", "collidable"]>[][] {
    const neighborhoods = Array.from(this.moved).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return this.neighborhood(x * GRID_SIZE + 1, y * GRID_SIZE + 1, GRID_SIZE);
    });
    this.moved.clear();
    return neighborhoods;
  }

  neighborhood(x: number, y: number, range: number) {
    // range is in x,y, not in partitions
    const ranges: [number, number][] = [];
    for (let dx = -Math.ceil(range / GRID_SIZE); dx <= Math.ceil(range / GRID_SIZE); dx++) {
      for (let dy = -Math.ceil(range / GRID_SIZE); dy <= Math.ceil(range / GRID_SIZE); dy++) {
        ranges.push([dx, dy]);
      }
    }
    return ranges
      .map(([dx, dy]) =>
        Array.from(this.partitions.get(this.getCellKey(x + dx * GRID_SIZE, y + dy * GRID_SIZE)))
      )
      .flat()
      .filter((entity) => Math.sqrt((x - entity.x) ** 2 + (y - entity.y) ** 2) <= range);
  }

  clear() {
    this.partitions.clear();
    this.reversePartitions.clear();
    this.moved.clear();
  }
}

type WorldView = {
  entities: EntityCollection;
  collidingPairs: SetMap<
    EntityWithComponents<["positioned", "collidable"]>,
    EntityWithComponents<["positioned", "collidable"]>
  >;
  grid: PF.Grid;
};

class World {
  width: number;
  height: number;
  view: WorldView = {
    entities: new EntityCollection(),
    collidingPairs: new SetMap(),
    grid: new PF.Grid(1, 1)
  };
  positions: Map<{ x: number; y: number }, Array<EntityWithComponents<["positioned"]>>> = new Map();
  berryTimer: number = BERRY_TIMER_MAX;
  initialized: boolean = false;
  keys: Set<string> = new Set();
  // TODO: make this a quadtree
  // TODO: make this by group so we don't check impossible collisions
  partitions: Partitions = new Partitions();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.view.grid = new PF.Grid(width + 1, height + 1);
    for (let x = 0; x <= this.width; x++) {
      for (let y = 0; y <= this.height; y++) {
        this.view.grid.setWalkableAt(x, y, false);
      }
    }
  }

  add<T extends EntityWithComponents<["positioned"]>>(object: T): T {
    this.view.entities.add(object);
    if (hasComponents(object, ["positioned", "collidable"])) {
      this.partitions.add(object);
    }
    return object;
  }

  remove(object: EntityWithComponents<["positioned"]>): void {
    this.view.entities.remove(object);
    if (hasComponents(object, ["positioned", "collidable"])) {
      this.view.collidingPairs
        .get(object)
        .forEach((other) => this.view.collidingPairs.remove(other, object));
      this.view.collidingPairs.delete(object);
    }
    if (hasComponents(object, ["positioned", "collidable"])) {
      this.partitions.remove(object);
    }
  }

  pointerDown(x: number, y: number) {
    const proposed = { x: Math.round(x), y: Math.round(y), width: 0.99, height: 0.99 };
    const existingBlock = this.view.entities
      .having(["collidable", "positioned"], ["movable"])
      .find((block) => block.x === proposed.x && block.y === proposed.y);

    if (existingBlock) {
      // Remove the existing block
      this.remove(existingBlock);
      // Create a Cave in its place
      this.add(
        cave({
          x: proposed.x,
          y: proposed.y
        })
      );
    } else {
      // Add a new block if there isn't one already
      if (
        !this.view.entities
          .having(["collidable", "positioned"])
          .some((collidable) => intersection(collidable, proposed))
      ) {
        this.add(
          block({
            x: proposed.x,
            y: proposed.y
          })
        );
      }
    }

    const toUpdate = [{ x: proposed.x, y: proposed.y }];
    for (let x = proposed.x - 3; x <= proposed.x + 3; x++) {
      for (let y = proposed.y - 3; y <= proposed.y + 3; y++) {
        toUpdate.push({ x, y });
      }
    }
    this.updateGrid(toUpdate);
  }

  keyDown(key: string) {
    this.keys.add(key);
  }

  keyUp(key: string) {
    this.keys.delete(key);
  }

  // TODO: better caching
  protected getView(object: EntityWithComponents<["positioned"]>, range: number = 10): WorldView {
    const visible = new Set(this.partitions.neighborhood(object.x, object.y, range));

    const filteredEntities = new EntityCollection();
    visible.forEach((entity) => filteredEntities.add(entity));

    return {
      entities: filteredEntities,
      collidingPairs: this.view.collidingPairs.filter(
        (key, value) => visible.has(key) && visible.has(value)
      ),
      grid: this.view.grid
    };
  }

  private updateGrid(updated: { x: number; y: number }[]) {
    const allBlocks: Map<string, EntityWithComponents<["positioned", "collidable"]>> = new Map();
    this.view.entities
      .having(["collidable", "positioned"], ["movable"])
      .filter((collidable) => collidable.passthrough === "solid")
      .forEach((block) => {
        allBlocks.set(`${block.x},${block.y}`, block);
      });
    const allCaves: Map<string, EntityWithComponents<["positioned", "collidable"]>> = new Map();
    this.view.entities
      .having(["collidable", "positioned"], ["movable"])
      .filter((collidable) => collidable.passthrough === "climbable")
      .forEach((cave) => {
        allCaves.set(`${cave.x},${cave.y}`, cave);
      });
    // for each block in an updated position, set above it to passable
    // set the side of it to passable if there's a block two below

    updated.forEach((update) => {
      if (allBlocks.has(`${update.x},${update.y}`)) {
        this.view.grid.setWalkableAt(update.x, update.y, false);
      } else if (allCaves.has(`${update.x},${update.y}`)) {
        this.view.grid.setWalkableAt(update.x, update.y, true);
      } else if (
        allBlocks.has(`${update.x},${update.y + 1}`) ||
        allCaves.has(`${update.x},${update.y + 1}`)
      ) {
        this.view.grid.setWalkableAt(update.x, update.y, true);
      } else if (
        allBlocks.has(`${update.x},${update.y + 2}`) &&
        (allBlocks.has(`${update.x + 1},${update.y + 1}`) ||
          allBlocks.has(`${update.x - 1},${update.y + 1}`))
      ) {
        this.view.grid.setWalkableAt(update.x, update.y, true);
      } else if (this.view.grid.isInside(update.x, update.y)) {
        this.view.grid.setWalkableAt(update.x, update.y, false);
      }
    });

    this.view.entities.having(["groblin"]).forEach((groblin) => {
      // force the groblin to reassess its path
      if (groblin.priority) {
        groblin.needs[groblin.priority].clear();
      }
    });

    this.partitions.clear();
    // Populate the grid
    this.view.entities.having(["collidable", "positioned"]).forEach((obj) => {
      this.partitions.add(obj);
    });
  }

  tick(delta: number): void {
    PROFILER.start("base tick");
    if (!this.initialized) {
      this.initialized = true;
      const allCoords: { x: number; y: number }[] = [];
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          allCoords.push({ x, y });
        }
      }
      this.updateGrid(allCoords);
    }

    this.berryTimer -= delta;
    if (this.berryTimer <= 0) {
      this.berryTimer = BERRY_TIMER_MAX;
      this.add(
        berry({
          x: Math.round(2 + Math.random() * (this.width - 5)),
          y: 2,
          width: 0.9,
          height: 0.9,
          density: 1,
          velocity: { x: 0, y: 0 },
          food: 20
        })
      );
    }

    const applyGravity = (movable: EntityWithComponents<["movable"]>) => {
      if (
        !movable.landed &&
        movable.velocity.y < TERMINAL_VELOCITY &&
        (!hasComponents(movable, ["groblin"]) || movable.crawling === null)
      ) {
        movable.velocity.y += delta * GRAVITY * movable.density;
      }
    };

    this.view.entities.having(["movable"]).forEach(applyGravity);

    const groblinSetPlan = (
      groblin: EntityWithComponents<["positioned", "movable", "groblin", "collidable"]>
    ) => {
      Object.entries(groblin.needs).forEach(([need, tracker]) => {
        tracker.tick(delta);
        if (
          !groblin.priority ||
          (need !== groblin.priority &&
            tracker.urgency() > groblin.needs[groblin.priority].urgency())
        ) {
          groblin.priority = need as EntityWithComponents<["groblin"]>["priority"];
          groblin.needs[groblin.priority].clear();
        }
      });
      const view = this.getView(groblin, groblin.vision);
      groblin.plan = groblin.needs[groblin.priority!].plan(groblin, view);
    };

    const groblinMove = (
      groblin: EntityWithComponents<["positioned", "movable", "groblin", "collidable"]>,
      plan: { to: { x: number; y: number }; path: number[][] }
    ) => {
      if (plan.path.length > 0) {
        let xDiff = plan.path[0][0] - groblin.x;
        let yDiff = plan.path[0][1] - groblin.y;
        if (groblin.velocity.y <= 0 || groblin.crawling !== null) {
          if (Math.abs(xDiff) > groblin.speed * delta) {
            groblin.velocity.x = groblin.speed * Math.sign(xDiff);
          } else {
            groblin.velocity.x = xDiff / delta;
          }
        }
        // Allow vertical movement in caves
        if (groblin.crawling !== null) {
          if (Math.abs(yDiff) > groblin.speed * delta) {
            groblin.velocity.y = groblin.speed * Math.sign(yDiff);
          } else {
            groblin.velocity.y = yDiff / delta;
          }
        } else if (yDiff < -0.5 && groblin.landed !== null) {
          groblin.velocity.y = -JUMP_POP;
        }
      }
    };

    PROFILER.start("groblins");
    this.view.entities
      .having(["groblin", "positioned", "movable", "collidable"])
      .forEach((groblin) => {
        PROFILER.start(`groblin set plan`);
        groblinSetPlan(groblin);
        PROFILER.end(`groblin set plan`);
        PROFILER.start(`groblin move`);
        if (groblin.plan && groblin.plan.type === "move") {
          groblinMove(groblin, groblin.plan);
        }
        PROFILER.end(`groblin move`);
        PROFILER.start(`groblin eat`);
        if (
          groblin.plan &&
          groblin.plan.type === "eat" &&
          this.view.entities.having(["edible"]).includes(groblin.plan.what)
        ) {
          groblin.needs.food.add(groblin.plan.what.food);
          this.remove(groblin.plan.what);
        }
        groblin.crawling = null;
        PROFILER.end(`groblin eat`);
      });
    PROFILER.end("groblins");

    // only reset landed if the object has moved
    this.view.entities.having(["movable", "positioned", "collidable"]).forEach((movable) => {
      if (this.partitions.hasMoved(movable)) {
        movable.landed = null;
        this.view.collidingPairs
          .get(movable)
          .forEach((other) => this.view.collidingPairs.remove(other, movable));
        this.view.collidingPairs.delete(movable);
      }
    });

    const collideWithBlock = (
      movable: EntityWithComponents<["positioned", "movable"]>,
      block: EntityWithComponents<["positioned"]>
    ) => {
      const dx = movable.x - block.x;
      const dy = movable.y - block.y;
      const combinedHalfWidth = (movable.width + block.width) / 2;
      const combinedHalfHeight = (movable.height + block.height) / 2;

      const overlapX = combinedHalfWidth - Math.abs(dx);
      const overlapY = combinedHalfHeight - Math.abs(dy);

      if (overlapX >= overlapY) {
        if (dy > 0) {
          // Collision on the bottom side of the block
          movable.velocity.y = Math.max(movable.velocity.y, movable.velocity.y * -WALL_ELASTICITY);
          movable.y = Math.max(movable.y, block.y + block.height / 2 + movable.height / 2);
        } else {
          // Collision on the top side of the block
          movable.landed = block;
          movable.velocity.y = Math.min(0, movable.velocity.y);
          movable.velocity.x -= DRAG * delta * Math.sign(movable.velocity.x);
          if (Math.abs(movable.velocity.x) < DRAG * delta) {
            movable.velocity.x = 0;
          }
          movable.y = Math.min(movable.y, block.y - block.height / 2 - movable.height / 2 + 0.001);
        }
      } else {
        if (dx > 0) {
          // Collision on the right side of the block
          movable.velocity.x = Math.max(movable.velocity.x, movable.velocity.x * -WALL_ELASTICITY);
          movable.x = Math.max(
            movable.x,
            block.x + block.width / 2 + movable.width / 2 + movable.velocity.x * delta
          );
        } else {
          // Collision on the left side of the block
          movable.velocity.x = Math.min(movable.velocity.x, movable.velocity.x * -WALL_ELASTICITY);
          movable.x = Math.min(
            movable.x,
            block.x - block.width / 2 - movable.width / 2 + movable.velocity.x * delta
          );
        }
      }
    };

    // Check collisions using the grid
    PROFILER.start("collisions");
    PROFILER.start("neighborhoods");
    const neighborhoods = this.partitions.neighborhoodsWithMovement();
    PROFILER.end("neighborhoods");
    PROFILER.start("intersecting");
    neighborhoods.forEach((neighborhood) => {
      for (let i = 0; i < neighborhood.length; i++) {
        for (let j = i + 1; j < neighborhood.length; j++) {
          const obj1 = neighborhood[i];
          const obj2 = neighborhood[j];
          if (collision(obj1, obj2)) {
            this.view.collidingPairs.add(obj1, obj2);
            this.view.collidingPairs.add(obj2, obj1);

            if (hasComponents(obj1, ["movable"]) && obj2.passthrough === "solid") {
              collideWithBlock(obj1, obj2);
            }
            if (hasComponents(obj2, ["movable"]) && obj1.passthrough === "solid") {
              collideWithBlock(obj2, obj1);
            }
            if (hasComponents(obj1, ["groblin"]) && obj2.passthrough === "climbable") {
              obj1.crawling = obj2;
            }
            if (hasComponents(obj2, ["groblin"]) && obj1.passthrough === "climbable") {
              obj2.crawling = obj1;
            }
          }
        }
      }
    });
    PROFILER.end("intersecting");
    PROFILER.end("collisions");
    PROFILER.start("move");
    this.view.entities.having(["movable", "positioned", "collidable"]).forEach((movable) => {
      if (movable.velocity.x !== 0 || movable.velocity.y !== 0) {
        movable.x += movable.velocity.x * delta;
        movable.y += movable.velocity.y * delta;
        this.partitions.move(movable);
      }
    });
    PROFILER.end("move");
    PROFILER.end("base tick");
  }
}

class SpritePool {
  // a class that contains sprites of a certain texture, and can return a sprite to the pool when it's no longer needed
  private textures: Map<EntityWithComponents<["positioned"]>, Texture> = new Map();
  private used: Map<EntityWithComponents<["positioned"]>, ContainerChild> = new Map();
  private free: Map<Texture, ContainerChild[]> = new Map();
  private blockSize: number;
  private app: Application;

  constructor(app: Application, blockSize: number) {
    this.app = app;
    this.blockSize = blockSize;
  }

  init(entity: EntityWithComponents<["positioned"]>, texture: Texture) {
    this.textures.set(entity, texture);
  }

  get(entity: EntityWithComponents<["positioned"]>): ContainerChild {
    if (this.used.has(entity)) {
      return this.used.get(entity)!;
    }
    const texture = this.textures.get(entity)!;
    if (this.free.has(texture) && this.free.get(texture)!.length > 0) {
      const sprite = this.free.get(texture)!.pop()!;
      sprite.visible = true;
      this.used.set(entity, sprite);
      return sprite;
    }
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.scale =
      ((this.blockSize * entity.width) / texture.width,
      (this.blockSize * entity.height) / texture.height);
    this.used.set(entity, sprite);
    this.app.stage.addChild(sprite);
    return sprite;
  }

  recycle(entity: EntityWithComponents<["positioned"]>) {
    const sprite = this.used.get(entity);
    const texture = this.textures.get(entity);
    if (sprite && texture) {
      this.used.delete(entity);
      if (this.free.has(texture)) {
        this.free.get(texture)!.push(sprite);
      } else {
        this.free.set(texture, [sprite]);
      }
      sprite.visible = false;
    }
  }

  delete(entity: EntityWithComponents<["positioned"]>) {
    this.recycle(entity);
    this.textures.delete(entity);
  }

  entities() {
    return [...this.used.keys()];
  }
}

class PixiWorld extends World {
  app: Application;
  blockSize: number;
  textures: { groblin: Texture; berry: Texture; block: Texture; cave: Texture };
  sprites: SpritePool;
  followFields: Map<EntityWithComponents<["positioned"]>, BitmapText> = new Map();
  pan: { x: number; y: number } = { x: 0, y: 0 };
  pathSprites: Map<EntityWithComponents<["groblin"]>, ContainerChild[]> = new Map();
  fps: BitmapText;

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
    this.sprites = new SpritePool(app, blockSize);
    this.fps = new BitmapText({
      text: "foobar",
      style: {
        fontFamily: "Arial",
        fontSize: 12,
        fill: "white",
        align: "center"
      }
    });
    this.fps.x = 10;
    this.fps.y = 10;
    this.app.stage.addChild(this.fps);
  }

  add<T extends EntityWithComponents<["positioned"]>>(object: T): T {
    super.add(object);
    let texture: Texture | undefined = undefined;
    let textStyle: TextStyleOptions | undefined = undefined;
    if (hasComponents(object, ["groblin"])) {
      texture = this.textures.groblin;
      textStyle = {
        fontFamily: "Arial",
        fontSize: 12,
        fill: "white",
        align: "center"
      };
    }
    if (hasComponents(object, ["edible"])) {
      texture = this.textures.berry;
      textStyle = {
        fontFamily: "Arial",
        fontSize: 12,
        fill: "white",
        align: "center"
      };
    }
    if (hasComponents(object, ["collidable"]) && object.passthrough === "solid") {
      texture = this.textures.block;
    }
    if (hasComponents(object, ["collidable"]) && object.passthrough === "climbable") {
      texture = this.textures.cave;
    }
    if (texture) {
      this.sprites.init(object, texture);
    }
    if (textStyle) {
      const text = new BitmapText({ text: "foobar", style: textStyle });
      text.zIndex = 1000;
      this.app.stage.addChild(text);
      this.followFields.set(object, text);
    }
    return object;
  }

  remove(object: EntityWithComponents<["positioned"]>) {
    super.remove(object);
    const text = this.followFields.get(object);
    if (text) {
      this.app.stage.removeChild(text);
    }
    this.sprites.delete(object);
  }

  pointerDown(x: number, y: number) {
    return super.pointerDown((x - this.pan.x) / this.blockSize, (y - this.pan.y) / this.blockSize);
  }

  tick(delta: number) {
    PROFILER.start("pixi tick");
    super.tick(delta);

    PROFILER.start("pixi");
    PROFILER.start("pathfinding sprites");
    this.view.entities.having(["groblin"]).forEach((groblin) => {
      if (groblin.plan?.type === "move") {
        const path = groblin.plan.path;
        if (path) {
          const pathSprites = this.pathSprites.get(groblin);
          if (!pathSprites) {
            this.pathSprites.set(groblin, []);
          }
          path.forEach(([x, y], i) => {
            if (i >= this.pathSprites.get(groblin)!.length) {
              const sprite = new Sprite(this.textures.groblin);
              sprite.alpha = 0.5;
              sprite.anchor.set(0.5);
              sprite.scale.set(this.textures.groblin.width / this.blockSize / 4);
              this.app.stage.addChild(sprite);
              this.pathSprites.get(groblin)!.push(sprite);
            }
            const sprite = this.pathSprites.get(groblin)![i];
            sprite.visible = true;
            sprite.x = x * this.blockSize + this.pan.x;
            sprite.y = y * this.blockSize + this.pan.y;
          });
          for (let i = path.length; i < this.pathSprites.get(groblin)!.length; i++) {
            this.pathSprites.get(groblin)![i].visible = false;
          }
        }
      }
    });
    PROFILER.end("pathfinding sprites");

    this.fps.text = `${Math.round(1 / delta)} fps`;

    if (this.keys.has("ArrowUp")) {
      this.pan.y += PAN_SPEED * delta;
    }
    if (this.keys.has("ArrowDown")) {
      this.pan.y -= PAN_SPEED * delta;
    }
    if (this.keys.has("ArrowLeft")) {
      this.pan.x += PAN_SPEED * delta;
    }
    if (this.keys.has("ArrowRight")) {
      this.pan.x -= PAN_SPEED * delta;
    }

    PROFILER.start("viewed objects");
    const viewedObjects = new Set<EntityWithComponents<["positioned"]>>();
    this.view.entities
      .having(["groblin", "positioned"])
      .map((groblin) => this.getView(groblin, groblin.vision).entities.having(["positioned"]))
      .flat()
      .forEach((object) => viewedObjects.add(object));
    PROFILER.end("viewed objects");

    PROFILER.start("entities in window");
    const entitiesInWindow = new Set(
      this.partitions.neighborhood(
        (this.app.screen.width / 2 - this.pan.x) / this.blockSize,
        (this.app.screen.height / 2 - this.pan.y) / this.blockSize,
        Math.max(this.app.screen.width, this.app.screen.height) / this.blockSize
      )
    );
    this.sprites.entities().forEach((object) => {
      if (!entitiesInWindow.has(object as EntityWithComponents<["positioned", "collidable"]>)) {
        this.sprites.recycle(object);
        const text = this.followFields.get(object);
        if (text) {
          text.visible = false;
        }
      }
    });
    PROFILER.end("entities in window");
    PROFILER.start("update sprites");
    entitiesInWindow.forEach((object) => {
      this.sprites.get(object).x = object.x * this.blockSize + this.pan.x;
      this.sprites.get(object).y = object.y * this.blockSize + this.pan.y;
      if (viewedObjects.has(object)) {
        this.sprites.get(object).alpha = 1;
      } else {
        this.sprites.get(object).alpha = 0.5;
      }
      const text = this.followFields.get(object);
      if (text) {
        text.visible = true;
        text.x = object.x * this.blockSize + this.pan.x;
        text.y = object.y * this.blockSize + this.pan.y;
        if (hasComponents(object, ["movable", "groblin"])) {
          const needs = (
            Object.entries(object.needs) as Entries<EntityWithComponents<["groblin"]>["needs"]>
          ).map(
            ([need, tracker]) => `${need}: ${Math.round(tracker.get())} (${tracker.urgency()})\n`
          );
          text.text = `${object.name}\n${needs}\npriority: ${object.priority}\nplan: ${object.plan!.type}\nlanded: ${object.landed ? "yes" : "no"}`;
        }
        if (hasComponents(object, ["edible", "movable"])) {
          text.text = object.landed ? "landed" : "floating";
        }
      }
    });
    PROFILER.end("update sprites");
    PROFILER.end("pixi");
    PROFILER.end("pixi tick");
    PROFILER.log({
      "total movables: ": this.view.entities.having(["movable"]).length
    });
  }
}

export { PixiWorld };
export type { World, WorldView };
