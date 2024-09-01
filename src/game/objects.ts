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
  landed: "bottom" | "top" | "left" | "right" | false;
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
    block: true;
  };

export type { WorldObject, Collidable, Movable, Edible, Block };
