import type { EntityWithComponents } from "./ecs";
import type { WorldView } from "./world";
import PF from "pathfinding";

type Plan =
  | {
      type: "move";
      to: { x: number; y: number };
      path: number[][];
    }
  | { type: "eat"; what: EntityWithComponents<["edible", "positioned"]> }
  | {
      type: "wait";
    };

abstract class NeedTracker {
  private _value: number = 0;
  private _max: number;
  private _min: number;

  constructor(initial: number, min: number, max: number) {
    this._min = min;
    this._max = max;
    this.set(initial);
  }

  get() {
    return this._value;
  }

  set(value: number) {
    this._value = value;
    if (this._value > this._max) {
      this._value = this._max;
    }
    if (this._value < this._min) {
      this._value = this._min;
    }
  }

  add(delta: number) {
    this.set(this.get() + delta);
  }

  min() {
    return this._min;
  }

  max() {
    return this._max;
  }

  abstract urgency(): number;

  tick(delta: number) {}

  abstract plan(
    planner: EntityWithComponents<["movable", "positioned", "groblin", "collidable"]>,
    view: WorldView
  ): Plan;

  abstract clear(): void;
}

function route(
  planner: EntityWithComponents<["positioned"]>,
  to: { x: number; y: number },
  grid: PF.Grid
) {
  return new PF.AStarFinder({
    diagonalMovement: PF.DiagonalMovement.Never
  }).findPath(
    Math.round(planner.x),
    Math.round(planner.y),
    Math.round(to.x),
    Math.round(to.y),
    grid.clone()
  );
}

function explore(
  planner: EntityWithComponents<["positioned", "groblin"]>,
  grid: PF.Grid,
  exploreDirection: 1 | -1
) {
  function getKey(x: number, y: number) {
    return x + "," + y;
  }

  function dist(x1: number, y1: number, x2: number, y2: number) {
    return Math.sign(x2 - x1) === exploreDirection && Math.abs(x2 - x1) >= 1
      ? Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
      : -1;
  }
  // the goal here is not to get to any particular point, but to find the path that goes the farthest from the groblin
  // while still being in vision range
  const shortestPathToPoint = new Map<string, [number, number][]>();
  const toVisit: { x: number; y: number; path: [number, number][] }[] = [
    {
      x: Math.round(planner.x),
      y: Math.round(planner.y),
      path: []
    }
  ];
  let farthestPoint: { x: number; y: number } = {
    x: Math.round(planner.x),
    y: Math.round(planner.y)
  };
  while (toVisit.length > 0) {
    const current = toVisit.pop()!;
    if (
      !shortestPathToPoint.has(getKey(current.x, current.y)) ||
      current.path.length < shortestPathToPoint.get(getKey(current.x, current.y))!.length
    ) {
      shortestPathToPoint.set(getKey(current.x, current.y), current.path);
    }
    const distance = dist(current.x, current.y, planner.x, planner.y);
    if (distance > dist(farthestPoint.x, farthestPoint.y, planner.x, planner.y)) {
      farthestPoint = { x: current.x, y: current.y };
    }
    const neighbors = grid.getNeighbors(
      grid.getNodeAt(current.x, current.y),
      PF.DiagonalMovement.Never
    );
    for (const neighbor of neighbors) {
      if (
        grid.isInside(neighbor.x, neighbor.y) &&
        grid.isWalkableAt(neighbor.x, neighbor.y) &&
        Math.sqrt((neighbor.x - planner.x) ** 2 + (neighbor.y - planner.y) ** 2) < planner.vision &&
        (!shortestPathToPoint.has(getKey(neighbor.x, neighbor.y)) ||
          shortestPathToPoint.get(getKey(neighbor.x, neighbor.y))!.length > current.path.length + 1)
      ) {
        toVisit.push({
          x: neighbor.x,
          y: neighbor.y,
          path: [...current.path, [neighbor.x, neighbor.y]]
        });
      }
    }
  }
  return shortestPathToPoint.get(getKey(farthestPoint.x, farthestPoint.y)) ?? [];
}

function follow(planner: EntityWithComponents<["positioned"]>, plan: Plan & { type: "move" }) {
  let xDiff = plan.path[0][0] - planner.x;
  let yDiff = plan.path[0][1] - planner.y;
  if (Math.abs(xDiff) < 0.5 && Math.abs(yDiff) < 0.5) {
    plan = {
      ...plan,
      path: [...plan.path].splice(1)
    };
  }
  return plan;
}

class FoodTracker extends NeedTracker {
  thresholds: {
    starving: number;
    hungry: number;
    full: number;
  };
  state: "full" | "hungry" | "starving" = "full";
  private _plan: Plan = { type: "wait" };
  private _exploreDirection: { x: 1 | -1; y: 1 | -1 } = { x: -1, y: 1 };
  private _inaccessibleFood: Set<EntityWithComponents<["edible", "positioned"]>> = new Set();
  constructor(
    initial: number,
    max: number,
    thresholds: { starving: number; hungry: number; full: number }
  ) {
    super(initial, 0, max);
    this.thresholds = thresholds;
  }

  set(value: number) {
    super.set(value);
    // full -> hungry
    if (this.state === "full" && this.get() < this.thresholds.hungry) {
      this.state = "hungry";
    }
    // hungry -> full
    if (this.state === "hungry" && this.get() > this.thresholds.full) {
      this.state = "full";
    }
    // hungry -> starving
    if (this.state === "hungry" && this.get() < this.thresholds.starving) {
      this.state = "starving";
    }
    // starving -> hungry
    if (this.state === "starving" && this.get() > this.thresholds.hungry) {
      this.state = "hungry";
    }
  }

  urgency() {
    if (this.state === "starving") {
      return 100;
    }
    if (this.state === "hungry") {
      return 50;
    }
    return 0;
  }

  tick(delta: number) {
    this.add(-delta * 10);
  }

  clear() {
    this._plan = { type: "wait" };
    this._inaccessibleFood.clear();
  }

  plan(
    planner: EntityWithComponents<["movable", "positioned", "groblin", "collidable"]>,
    view: WorldView
  ) {
    const foods = view.entities
      .having(["edible", "positioned", "movable", "collidable"])
      .filter((food) => food.landed !== null && !this._inaccessibleFood.has(food))
      .sort((e1, e2) => Math.abs(e1.x - planner.x) - Math.abs(e2.x - planner.x));

    for (const food of foods) {
      // If touching a food, eat it
      if (view.collidingPairs.get(planner).has(food)) {
        this._plan = { type: "eat", what: food };
        return this._plan;
      }
      // If already planning to get a food, keep at it
      if (this._plan.type === "move" && this._plan.to.x === food.x && this._plan.to.y === food.y) {
        this._plan = follow(planner, this._plan);
        return this._plan;
      }
      // Try to get to the food
      const path = route(planner, food, view.grid);
      if (path.length > 0) {
        this._plan = {
          type: "move",
          to: food,
          path
        };
        return this._plan;
      } else if (planner.landed || planner.crawling) {
        this._inaccessibleFood.add(food);
      }
    }

    if (
      (planner.landed || planner.crawling) && // if this is removed, the groblin will explore every possible path when it's still falling
      (this._plan.type !== "move" ||
        Math.sqrt((this._plan.to.x - planner.x) ** 2 + (this._plan.to.y - planner.y) ** 2) < 0.5)
    ) {
      const path = explore(planner, view.grid, this._exploreDirection.x);
      if (path.length > 1) {
        // use 1 because otherwise the groblin will jump in place
        this._plan = {
          type: "move",
          to: { x: path[path.length - 1][0], y: path[path.length - 1][1] },
          path
        };
        return this._plan;
      }
      this._exploreDirection.x *= -1;
    }

    if (this._plan.type === "move" && this._plan.path.length > 0) {
      this._plan = follow(planner, this._plan);
      return this._plan;
    }
    this._plan = { type: "wait" };
    return this._plan;
  }
}

class RelaxTracker extends NeedTracker {
  constructor(initial: number, max: number) {
    super(initial, 0, max);
  }

  urgency() {
    return 1 - this.get() / this.max();
  }

  plan(
    planner: EntityWithComponents<["movable", "positioned", "groblin", "collidable"]>,
    objects: WorldView
  ) {
    return { type: "wait" } as Plan;
  }

  clear() {}
}

export type { Plan };
export { FoodTracker, RelaxTracker };
