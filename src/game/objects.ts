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
  landed: boolean;
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
    block: true;
  };

// class WorldObject {
//   x: number;
//   y: number;
//   constructor(data: { x: number; y: number }) {
//     this.x = data.x;
//     this.y = data.y;
//   }
// }

// // tiles have position and collision properties, but no velocity
// // all collisions are registered, but only collisions with blocks have physics

// class CollidableObject extends WorldObject {
//   width: number;
//   height: number;
//   constructor(data: ConstructorParameters<typeof WorldObject>[0] & { width: number; height: number }) {
//     super(data);
//     this.width = data.width;
//     this.height = data.height;
//   }
// }

// class MovableCollidableObject extends CollidableObject {
//   density: number;
//   velocity: { x: number; y: number };
//   constructor(data: ConstructorParameters<typeof CollidableObject>[0] & { density: number }) {
//     super(data);
//     this.density = data.density;
//     this.velocity = { x: 0, y: 0 };
//   }

//   tick(delta: number, objects: ObjectContainer) {
//     this.x += this.velocity.x * delta;
//     this.y += this.velocity.y * delta;
//     // this.velocity.y += delta * this.density;
//   }
// }

// class Berry extends MovableCollidableObject {
//   food: number;
//   constructor(data: ConstructorParameters<typeof MovableCollidableObject>[0] & { food: number }) {
//     super(data);
//     this.food = data.food;
//   }
// }

// class WorldObject {
//   x: number;
//   y: number;
//   constructor(data: { x: number; y: number }) {
//     this.x = data.x;
//     this.y = data.y;
//   }
// }
// // tiles have position and collision properties, but no velocity
// // all collisions are registered, but only collisions with blocks have physics
// class CollidableObject extends WorldObject {
//   width: number;
//   height: number;
//   constructor(data: ConstructorParameters<typeof WorldObject>[0] & { width: number; height: number }) {
//     super(data);
//     this.width = data.width;
//     this.height = data.height;
//   }
// }
// class MovableCollidableObject extends CollidableObject {
//   density: number;
//   velocity: { x: number; y: number };
//   constructor(data: ConstructorParameters<typeof CollidableObject>[0] & { density: number }) {
//     super(data);
//     this.density = data.density;
//     this.velocity = { x: 0, y: 0 };
//   }
//   tick(delta: number, objects: ObjectContainer) {
//     this.x += this.velocity.x * delta;
//     this.y += this.velocity.y * delta;
//     // this.velocity.y += delta * this.density;
//   }
// }
// class Berry extends MovableCollidableObject {
//   food: number;
//   constructor(data: ConstructorParameters<typeof MovableCollidableObject>[0] & { food: number }) {
//     super(data);
//     this.food = data.food;
//   }
// }
export type { WorldObject, Collidable, Movable, Edible, Block };
