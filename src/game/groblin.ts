import type { WorldObject, Collidable, Movable, Edible } from "./objects";
import type { WorldView } from "./world";

type Plan =
  | {
      type: "move";
      to: WorldObject;
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
    console.log(view.objects.edible.length);
    const food = view.objects.edible.length > 0 ? view.objects.edible[0] : null;
    if (food) {
      if (view.collidingPairs.get(planner).has(food)) {
        return { type: "eat", what: food } as Plan;
      }
      return { type: "move", to: food } as Plan;
    }
    return { type: "wait" } as Plan;
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
    needs: { food: FoodTracker; relax: RelaxTracker };
    plan?: Plan;
    priority?: keyof Groblin["needs"];
    groblin: true;
  };

export type { Groblin };
export { FoodTracker, RelaxTracker };
