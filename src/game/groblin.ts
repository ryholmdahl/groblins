import type { WorldObject, Collidable, Movable, Edible } from "./objects";
import type { WorldView } from "./world";
import PF from "pathfinding";

type Plan =
  | {
      type: "move";
      to: { x: number; y: number };
      path: number[][];
    }
  | { type: "eat"; what: Edible }
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

  abstract plan(planner: Groblin, view: WorldView): Plan;
}

class FoodTracker extends NeedTracker {
  thresholds: {
    starving: number;
    hungry: number;
    full: number;
  };
  state: "full" | "hungry" | "starving" = "full";
  private _plan: Plan = { type: "wait" };
  private _exploreDirection: 1 | -1 = -1;
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

  plan(planner: Groblin, view: WorldView) {
    const foods =
      view.objects.edible.length > 0
        ? view.objects.edible
            .filter((food) => food.landed)
            .sort((e1, e2) => Math.abs(e1.x - planner.x) - Math.abs(e2.x - planner.x))
        : undefined;
    if (foods) {
      for (const food of foods) {
        if (view.collidingPairs.get(planner).has(food)) {
          this._plan = { type: "eat", what: food };
          return this._plan;
        }
        if (
          this._plan.type === "move" &&
          this._plan.to.x === food.x &&
          this._plan.to.y === food.y
        ) {
          // TODO: reassess path feasibility?
          let xDiff = this._plan.path[0][0] - planner.x;
          let yDiff = this._plan.path[0][1] - planner.y;
          if (Math.abs(xDiff) < 0.5 && Math.abs(yDiff) < 0.5) {
            this._plan.path = this._plan.path.splice(1);
          }
          return this._plan;
        } else {
          const path = new PF.AStarFinder({
            diagonalMovement: PF.DiagonalMovement.Always
          }).findPath(
            Math.round(planner.x),
            Math.round(planner.y),
            Math.round(food.x),
            Math.round(food.y),
            view.grid.clone()
          );
          if (path.length > 0) {
            this._plan = {
              type: "move",
              to: food,
              path
            };
            return this._plan;
          }
        }
      }
    }
    // There's no food. Explore.
    // If not already exploring, pick a destination
    if (
      this._plan.type !== "move" ||
      Math.sqrt((this._plan.to.x - planner.x) ** 2 + (this._plan.to.y - planner.y) ** 2) < 0.1
    ) {
      // is the spot in direction, one above, or one below open?
      let choseNew = false;
      [-1, 0, 1].forEach((dy) => {
        if (
          view.grid.isWalkableAt(
            Math.round(planner.x + this._exploreDirection),
            Math.round(planner.y + dy)
          )
        ) {
          this._plan = {
            type: "move",
            to: {
              x: Math.round(planner.x + this._exploreDirection),
              y: Math.round(planner.y + dy)
            },
            path: [[Math.round(planner.x + this._exploreDirection), Math.round(planner.y + dy)]]
          };
          choseNew = true;
        }
      });
      if (choseNew) {
        return this._plan;
      } else {
        this._exploreDirection *= -1;
      }
    }
    if (this._plan.type === "move" && this._plan.path.length > 0) {
      let xDiff = this._plan.path[0][0] - planner.x;
      let yDiff = this._plan.path[0][1] - planner.y;
      if (Math.abs(xDiff) < 0.5 && Math.abs(yDiff) < 0.5) {
        this._plan.path = this._plan.path.splice(1);
      }
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

  plan(planner: Groblin, objects: WorldView) {
    return { type: "wait" } as Plan;
  }
}

type Groblin = WorldObject &
  Collidable &
  Movable & {
    name: string;
    needs: { food: FoodTracker; relax: RelaxTracker };
    plan?: Plan;
    priority?: keyof Groblin["needs"];
    groblin: true;
  };

export type { Groblin };
export { FoodTracker, RelaxTracker };
