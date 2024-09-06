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

const GroblinComponents = ["positioned", "collidable", "movable", "groblin"] as const;
const groblin = (
  args: Omit<
    CreateEntityArgs<typeof GroblinComponents>,
    "priority" | "plan" | "group" | "collidesWith" | "landed" | "crawling" | "passthrough"
  >
) =>
  createEntity(GroblinComponents, {
    ...args,
    group: 0,
    collidesWith: new Set([0, 1]),
    priority: "food",
    plan: { type: "wait" },
    landed: null,
    crawling: null,
    passthrough: "empty"
  });

export { block, cave, berry, groblin };
