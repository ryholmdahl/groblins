import type { Plan } from "./groblin";
import type { FoodTracker, RelaxTracker } from "./groblin";

// Component interfaces
interface PositionedComponent {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CollidableComponent {
  group: number;
  collidesWith: Set<number>;
  passthrough: "solid" | "climbable" | "empty";
}

interface MovableComponent {
  velocity: { x: number; y: number };
  density: number;
  landed: EntityWithComponents<["positioned"]> | null;
}

interface EdibleComponent {
  food: number;
}

interface GroblinComponent {
  name: string;
  needs: { food: FoodTracker; relax: RelaxTracker };
  plan: Plan;
  priority: keyof GroblinComponent["needs"];
  crawling: EntityWithComponents<["positioned", "collidable"]> | null;
  vision: number;
  speed: number;
}

// Create a mapped type for component names
type ComponentMap = {
  positioned: PositionedComponent;
  collidable: CollidableComponent;
  movable: MovableComponent;
  edible: EdibleComponent;
  groblin: GroblinComponent;
};

type ComponentName = keyof ComponentMap;

// Utility type to convert union to intersection
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void
  ? I
  : never;

type EntityWithComponents<T extends readonly ComponentName[]> = Entity &
  UnionToIntersection<
    {
      [K in T[number]]: ComponentMap[K];
    }[T[number]]
  >;

// Entity class
class Entity {
  private components: Partial<ComponentMap> = {};

  constructor() {
    return new Proxy(this, {
      get(target: Entity, prop: string | symbol) {
        if (prop in target) {
          return (target as any)[prop];
        }
        for (const component of Object.values(target.components)) {
          if (component && prop in component) {
            return (component as any)[prop];
          }
        }
      },
      set(target: Entity, prop: string | symbol, value: any) {
        for (const component of Object.values(target.components)) {
          if (component && prop in component) {
            (component as any)[prop] = value;
            return true;
          }
        }
        return false;
      }
    }) as any;
  }

  addComponent<T extends ComponentName>(name: T, component: ComponentMap[T]): void {
    this.components[name] = component;
  }

  getComponent<T extends ComponentName>(name: T): ComponentMap[T] | undefined {
    return this.components[name];
  }

  hasComponent(name: ComponentName): boolean {
    return name in this.components;
  }

  listComponents(): ComponentName[] {
    return Object.keys(this.components) as ComponentName[];
  }
}

// Helper function to create entities with specific components
function createEntity<T extends readonly ComponentName[]>(
  componentNames: T,
  values: UnionToIntersection<ComponentMap[T[number]]>
): EntityWithComponents<T> {
  const entity = new Entity();
  componentNames.forEach((name) => {
    entity.addComponent(name, values as ComponentMap[typeof name]);
  });
  return entity as EntityWithComponents<T>;
}

type CreateEntityArgs<K extends readonly ComponentName[]> = UnionToIntersection<
  ComponentMap[K[number]]
>;

function hasComponents<T extends ComponentName[]>(
  entity: Entity,
  components: T
): entity is EntityWithComponents<T> {
  return components.every((component) => entity.hasComponent(component));
}

export { createEntity, hasComponents };
export type { Entity, EntityWithComponents, CreateEntityArgs, ComponentName, ComponentMap };
