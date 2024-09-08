import { createEntity, type CreateEntityArgs } from "./ecs";

const BlockComponents = ["positioned", "collidable"] as const;
const block = (
  args: Omit<
    CreateEntityArgs<typeof BlockComponents>,
    "group" | "collidesWith" | "width" | "height" | "passthrough"
  >
) =>
  createEntity(BlockComponents, {
    ...args,
    width: 1,
    height: 1,
    group: 1,
    passthrough: "solid",
    collidesWith: new Set([0] as [0])
  });

const CaveComponents = ["positioned", "collidable"] as const;
const cave = (
  args: Omit<
    CreateEntityArgs<typeof CaveComponents>,
    "group" | "collidesWith" | "width" | "height" | "passthrough"
  >
) =>
  createEntity(CaveComponents, {
    ...args,
    group: 1,
    collidesWith: new Set([0] as [0]),
    width: 1,
    height: 1,
    passthrough: "climbable"
  });

const BerryComponents = ["positioned", "collidable", "movable", "edible"] as const;
const berry = (
  args: Omit<
    CreateEntityArgs<typeof BerryComponents>,
    "group" | "collidesWith" | "landed" | "passthrough"
  >
) =>
  createEntity(BerryComponents, {
    ...args,
    group: 0,
    collidesWith: new Set([0, 1]),
    landed: null,
    passthrough: "empty"
  });

const BASE_STATS = {
  vision: 20,
  speed: 3
};

const GroblinComponents = ["positioned", "collidable", "movable", "groblin"] as const;
const groblin = (
  args: Omit<
    CreateEntityArgs<typeof GroblinComponents>,
    | "priority"
    | "plan"
    | "group"
    | "collidesWith"
    | "landed"
    | "crawling"
    | "passthrough"
    | keyof typeof BASE_STATS
  >
) => {
  // jitter each stat, then normalize
  const statMultipliers = {
    vision: 1 + Math.random(),
    speed: 1 + Math.random()
  };
  const stats = {
    ...BASE_STATS
  };
  Object.entries(statMultipliers).forEach(([state, multiplier]) => {
    stats[state] =
      ((BASE_STATS[state] * multiplier) /
        Object.values(statMultipliers).reduce((a, b) => a + b, 0)) *
      Object.values(statMultipliers).length;
  });
  return createEntity(GroblinComponents, {
    ...args,
    group: 0,
    collidesWith: new Set([0, 1]),
    priority: "food",
    plan: { type: "wait" },
    landed: null,
    crawling: null,
    passthrough: "empty",
    ...stats
  });
};

export { block, cave, berry, groblin };
