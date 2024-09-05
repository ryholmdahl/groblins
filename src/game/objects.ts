type WorldObject = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Collidable = WorldObject & {
  group: number;
  collidesWith: Set<number>;
  collidable: true;
};

type Movable = WorldObject & {
  density: number;
  velocity: { x: number; y: number };
  landed: Block | null;
  movable: true;
};

type Edible = WorldObject &
  Collidable &
  Movable & {
    food: number;
    edible: true;
  };

type Block = WorldObject &
  Collidable & {
    group: 1;
    exposed: {
      left: boolean;
      right: boolean;
      top: boolean;
      bottom: boolean;
    };
    collidesWith: Set<0>;
    block: true;
  };

type Cave = Collidable & {
  group: 1;
  collidesWith: Set<0>;
  cave: true;
};

export type { WorldObject, Collidable, Movable, Edible, Block, Cave };
