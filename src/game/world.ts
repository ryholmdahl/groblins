import type { Application, ContainerChild, TextStyleOptions, Texture } from "pixi.js";
import { Sprite, BitmapText } from "pixi.js";
import type { Entity, EntityWithComponents, ComponentMap } from "./ecs";
import { hasComponents } from "./ecs";
import { berry, block, cave } from "./objects";
import type { Entries } from "type-fest";
import PF from "pathfinding";

const GROBLIN_MAX_SPEED = 3;
const TERMINAL_VELOCITY = 10;
const BERRY_TIMER_MAX = 2;
const GROBLIN_VISION = 20;
const GRAVITY = 100;
const JUMP_POP = 15;
const WALL_ELASTICITY = 0.1;
const DRAG = 3;
const PAN_SPEED = 1000;
const GRID_SIZE = 5;

// Helper function to get grid cell key

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

  private getCellKey: (x: number, y: number) => string = (x: number, y: number) =>
    `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)}`;

  add(entity: EntityWithComponents<["positioned", "collidable"]>) {
    const key = this.getCellKey(entity.x, entity.y);
    this.partitions.add(key, entity);
    this.reversePartitions.set(entity, key);
  }

  remove(entity: EntityWithComponents<["positioned", "collidable"]>) {
    const key = this.getCellKey(entity.x, entity.y);
    this.partitions.remove(key, entity);
    this.reversePartitions.delete(entity);
  }

  move(entity: EntityWithComponents<["positioned", "collidable"]>) {
    if (this.reversePartitions.get(entity) !== this.getCellKey(entity.x, entity.y)) {
      this.partitions.remove(this.reversePartitions.get(entity)!, entity);
      this.add(entity);
    }
  }

  neighborhood(x: number, y: number, range: number) {
    // range is in x,y, not in partitions
    const neighbors = new Set<EntityWithComponents<["positioned", "collidable"]>>();
    for (let dx = -Math.ceil(range / GRID_SIZE); dx <= Math.ceil(range / GRID_SIZE); dx++) {
      for (let dy = -Math.ceil(range / GRID_SIZE); dy <= Math.ceil(range / GRID_SIZE); dy++) {
        this.partitions
          .get(this.getCellKey(x + dx * GRID_SIZE, y + dy * GRID_SIZE))
          .forEach((neighbor) => {
            if (Math.sqrt((x - neighbor.x) ** 2 + (y - neighbor.y) ** 2) <= range) {
              neighbors.add(neighbor);
            }
          });
      }
    }
    return neighbors;
  }

  clear() {
    this.partitions.clear();
    this.reversePartitions.clear();
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
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
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
      .having(["positioned", "collidable"], ["movable"])
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
          .having(["positioned", "collidable"])
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

    this.resetGridAndPartitions({ x: proposed.x, y: proposed.y });
  }

  keyDown(key: string) {
    this.keys.add(key);
  }

  keyUp(key: string) {
    this.keys.delete(key);
  }

  // TODO: better caching
  protected getView(object: EntityWithComponents<["positioned"]>, range: number = 10): WorldView {
    const visible = this.partitions.neighborhood(object.x, object.y, range);

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

  private resetGridAndPartitions(updated?: { x: number; y: number }) {
    const blocksToCheck = updated
      ? this.view.entities
          .having(["positioned", "collidable"], ["movable"])
          .filter(
            (collidable) =>
              collidable.passthrough === "solid" &&
              Math.abs(collidable.x - updated.x) <= 2 &&
              Math.abs(collidable.y - updated.y) <= 2
          )
      : this.view.entities
          .having(["positioned", "collidable"], ["movable"])
          .filter((collidable) => collidable.passthrough === "solid");

    blocksToCheck.forEach((block) => {
      if (block.y - 1 >= 0) {
        this.view.grid.setWalkableAt(block.x, block.y - 1, true);
      }
      if (
        block.y - 2 >= 0 &&
        blocksToCheck.some((other) => other.y === block.y - 1 && Math.abs(block.x - other.x) === 1)
      ) {
        this.view.grid.setWalkableAt(block.x, block.y - 2, true);
      }
    });

    const cavesToCheck = updated
      ? this.view.entities
          .having(["positioned", "collidable"], ["movable"])
          .filter(
            (collidable) =>
              collidable.passthrough === "climbable" &&
              Math.abs(collidable.x - updated.x) <= 2 &&
              Math.abs(collidable.y - updated.y) <= 2
          )
      : this.view.entities
          .having(["positioned", "collidable"], ["movable"])
          .filter((collidable) => collidable.passthrough === "climbable");

    cavesToCheck.forEach((cave) => {
      this.view.grid.setWalkableAt(cave.x, cave.y, true);
      this.view.grid.setWalkableAt(cave.x, cave.y - 1, true);
    });

    blocksToCheck.forEach((block) => {
      this.view.grid.setWalkableAt(block.x, block.y, false);
    });

    this.view.entities.having(["groblin"]).forEach((groblin) => {
      // force the groblin to reassess its path
      if (groblin.priority) {
        groblin.needs[groblin.priority].clear();
      }
    });

    this.partitions.clear();
    // Populate the grid
    this.view.entities.having(["positioned", "collidable"]).forEach((obj) => {
      this.partitions.add(obj);
    });
  }

  tick(delta: number): void {
    if (!this.initialized) {
      this.initialized = true;
      this.resetGridAndPartitions();
    }

    this.berryTimer -= delta;
    if (this.berryTimer <= 0) {
      this.berryTimer = BERRY_TIMER_MAX;
      this.add(
        berry({
          x: Math.round(2 + Math.random() * 47),
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
      groblin.plan = groblin.needs[groblin.priority!].plan(
        groblin,
        this.getView(groblin, GROBLIN_VISION)
      );
    };

    const groblinMove = (
      groblin: EntityWithComponents<["positioned", "movable", "groblin", "collidable"]>,
      plan: { to: { x: number; y: number }; path: number[][] }
    ) => {
      if (plan.path.length > 0) {
        let xDiff = plan.path[0][0] - groblin.x;
        let yDiff = plan.path[0][1] - groblin.y;
        if (
          ((xDiff > 0 && groblin.velocity.x < GROBLIN_MAX_SPEED) ||
            (xDiff < 0 && groblin.velocity.x > -GROBLIN_MAX_SPEED)) &&
          (groblin.velocity.y <= 0 || groblin.crawling !== null)
        ) {
          groblin.velocity.x = GROBLIN_MAX_SPEED * Math.sign(xDiff);
        }
        // Allow vertical movement in caves
        if (groblin.crawling !== null) {
          if (yDiff > 0 && groblin.velocity.y < GROBLIN_MAX_SPEED) {
            groblin.velocity.y = GROBLIN_MAX_SPEED;
          } else if (yDiff < 0 && groblin.velocity.y > -GROBLIN_MAX_SPEED) {
            groblin.velocity.y = -GROBLIN_MAX_SPEED;
          } else {
            groblin.velocity.y = 0;
          }
        } else if (yDiff < -0.5 && groblin.landed !== null) {
          groblin.velocity.y = -JUMP_POP;
        }
      }
    };

    this.view.entities
      .having(["groblin", "positioned", "movable", "collidable"])
      .forEach((groblin) => {
        groblinSetPlan(groblin);
        if (groblin.plan && groblin.plan.type === "move") {
          groblinMove(groblin, groblin.plan);
        }
        if (
          groblin.plan &&
          groblin.plan.type === "eat" &&
          this.view.entities.having(["edible"]).includes(groblin.plan.what)
        ) {
          groblin.needs.food.add(groblin.plan.what.food);
          this.remove(groblin.plan.what);
        }
        groblin.crawling = null;
      });

    this.view.entities.having(["movable"]).forEach((movable) => (movable.landed = null));

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
          movable.y = Math.min(movable.y, block.y - block.height / 2 - movable.height / 2);
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

    this.view.collidingPairs.clear();

    // Check collisions using the grid
    this.view.entities.having(["positioned", "collidable", "movable"]).forEach((obj1) => {
      // TODO: don't use grid size here
      const neighbors = this.partitions.neighborhood(obj1.x, obj1.y, GRID_SIZE);
      neighbors.forEach((obj2) => {
        if (obj1 !== obj2 && collision(obj1, obj2)) {
          this.view.collidingPairs.add(obj1, obj2);
          this.view.collidingPairs.add(obj2, obj1);

          if (obj2.passthrough === "solid") {
            collideWithBlock(obj1, obj2);
          }
          if (hasComponents(obj1, ["groblin"]) && obj2.passthrough === "climbable") {
            obj1.crawling = obj2;
          }
        }
      });
    });

    this.view.entities.having(["positioned", "collidable", "movable"]).forEach((movable) => {
      movable.x += movable.velocity.x * delta;
      movable.y += movable.velocity.y * delta;
      this.partitions.move(movable);
    });
  }
}
class PixiWorld extends World {
  app: Application;
  blockSize: number;
  textures: { groblin: Texture; berry: Texture; block: Texture; cave: Texture };
  sprites: Map<EntityWithComponents<["positioned"]>, ContainerChild> = new Map();
  followFields: Map<EntityWithComponents<["positioned"]>, BitmapText> = new Map();
  pan: { x: number; y: number } = { x: 0, y: 0 };
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

  remove(object: EntityWithComponents<["positioned"]>) {
    super.remove(object);
    const sprite = this.sprites.get(object);
    if (sprite) {
      this.app.stage.removeChild(sprite);
    }
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
    super.tick(delta);
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
    const viewedObjects = new Set<EntityWithComponents<["positioned"]>>();
    this.view.entities
      .having(["positioned", "groblin"])
      .map((groblin) => this.getView(groblin, GROBLIN_VISION).entities.having(["positioned"]))
      .flat()
      .forEach((object) => viewedObjects.add(object));
    this.view.entities.having(["positioned"]).forEach((object) => {
      this.sprites.get(object)!.x = object.x * this.blockSize + this.pan.x;
      this.sprites.get(object)!.y = object.y * this.blockSize + this.pan.y;
      if (viewedObjects.has(object)) {
        this.sprites.get(object)!.alpha = 1;
      } else {
        this.sprites.get(object)!.alpha = 0.5;
      }
      const text = this.followFields.get(object);
      if (text) {
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
  }
}

export { PixiWorld };
export type { World, WorldView };
