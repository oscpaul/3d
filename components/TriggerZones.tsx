"use client";
import { useRef, useState } from "react";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import { Html } from "@react-three/drei";
import { pickRandomLandmark, type Landmark } from "@/components/landmarks";
import MapComponent from "@/components/MapComponent";
import "./style.css";

type ZoneDef = {
  name: string;
  center: [number, number]; // [x, z] on the ground
  size: [number, number]; // [width, depth]
  color: string;
};


const VICINITY_COLOR = "#4da6ff"; // change this to recolor the outer rectangle

const STORE_NAMES = ["Red", "Green", "Orange", "Blue", "Purple", "Gold"];
const STORE_COLORS = ["tomato", "seagreen", "orange", "royalblue", "orchid", "goldenrod"];
const SHIFT_RIGHT = 10;
// A straight aisle along z with `perSide` stores on each side facing it.
function makeMallZones({
  origin = [0, 0],
  aisleWidth = 8,
  storeSize = [6, 6],
  gap = 2,
  perSide = 3,
}: {
  origin?: [number, number];
  aisleWidth?: number;
  storeSize?: [number, number];
  gap?: number;
  perSide?: number;
} = {}): ZoneDef[] {
  const [w, d] = storeSize;
  const xOffset = aisleWidth / 2 + w / 2;
  const pitch = d + gap;
  const zones: ZoneDef[] = [];

  for (let i = 0; i < perSide; i++) {
    const z = origin[1] + (i - (perSide - 1) / 2) * pitch;
    for (const side of [0, 1]) {
      const idx = side * perSide + i;
      zones.push({
        name: STORE_NAMES[idx] ?? `Store ${idx + 1}`,
        center: [origin[0] + (side === 0 ? -xOffset : xOffset), z],
        size: [w, d],
        color: STORE_COLORS[idx % STORE_COLORS.length],
      });
    }
  }
  return zones;
}

// Where the player spawns (x, z). Heading 0 faces +z, so "straight ahead" is +z.
// Change SPAWN if your server puts players somewhere else.
const SPAWN: [number, number] = [0, 0];
// Empty space between the spawn point and the first row of stores.
const START_DISTANCE = 8;

const MALL = { aisleWidth: 8, storeSize: [6, 6] as [number, number], gap: 2, perSide: 3 };
const mallDepth = MALL.perSide * MALL.storeSize[1] + (MALL.perSide - 1) * MALL.gap;

// Aisle centered on the spawn's x, starting START_DISTANCE ahead, running away along +z.
const DEFAULT_ZONES = makeMallZones({
  ...MALL,
  origin: [SPAWN[0] - SHIFT_RIGHT, SPAWN[1] + START_DISTANCE + mallDepth / 2],
});

// How far the vicinity sensor extends past each store edge (world units).
const VICINITY_MARGIN = 2;

const isPlayer = (other: any) => other.rigidBodyObject?.name === "player";

function Zone({
  name,
  center,
  size,
  color,
  onSphereClick,
  onEnter,
  onLeave,
}: ZoneDef & {
  onSphereClick?: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const [w, d] = size;
  // Count player colliders inside each sensor so a log fires once on the way
  // in and once on the way out, even if Rapier sends duplicate events.
  const inside = useRef(0);
  const near = useRef(0);
  return (
    <RigidBody type="fixed" colliders={false} position={[center[0], 0, center[1]]}>
      {/* visual rectangle lying on the ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>





<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
  <planeGeometry args={[w + VICINITY_MARGIN * 2, d + VICINITY_MARGIN * 2]} />
  <meshBasicMaterial color={VICINITY_COLOR} transparent opacity={0.3} />
</mesh>





      {/* a small sphere with a button label, one per store */}
      <mesh position={[0, 2, 0]}>
        <sphereGeometry />
        <meshStandardMaterial color={color} />
        <Html position={[1, 1, 0]} wrapperClass="label" center distanceFactor={20}>
          <button onClick={onSphereClick}>{name} 👍</button>
        </Html>
      </mesh>

      {/* sensor: half-extents, tall enough to catch the player near the ground */}
      <CuboidCollider
        sensor
        args={[w / 2, 3, d / 2]}
        activeCollisionTypes={ActiveCollisionTypes.ALL}
       onIntersectionEnter={({ other }) => {
  if (!isPlayer(other)) return;
  if (inside.current++ === 0) {
    console.log(`Entered zone: ${name}`);
    onEnter?.();
  }
}}
onIntersectionExit={({ other }) => {
  if (!isPlayer(other)) return;
  inside.current = Math.max(0, inside.current - 1);
  if (inside.current === 0) {
    console.log(`Left zone: ${name}`);
    onLeave?.();
  }
}}
      />

      {/* vicinity sensor: slightly larger, fires when you get close */}
      <CuboidCollider
        sensor
        args={[w / 2 + VICINITY_MARGIN, 3, d / 2 + VICINITY_MARGIN]}
        activeCollisionTypes={ActiveCollisionTypes.ALL}
       onIntersectionEnter={({ other }) => {
  if (!isPlayer(other)) return;
  if (near.current++ === 0) console.log(`Near zone: ${name}`);
}}
onIntersectionExit={({ other }) => {
  if (!isPlayer(other)) return;
  near.current = Math.max(0, near.current - 1);
  if (near.current === 0) console.log(`Moved away from zone: ${name}`);
}}
      />
    </RigidBody>
  );
}

// Render this INSIDE <Canvas><Physics>…</Physics></Canvas>.
export default function TriggerZones({ zones = DEFAULT_ZONES }: { zones?: ZoneDef[] }) {
  // One landmark state for the whole component, not one per zone.
  const [landmark, setLandmark] = useState<Landmark | null>(null);
const [anchor, setAnchor] = useState<[number, number]>([0, 0]); // [x, z] of the active store
const activeZone = useRef<string | null>(null); // which store currently owns the map
const openMap = (z: ZoneDef) => {
  activeZone.current = z.name;
  setAnchor(z.center);
  setLandmark((l) => l ?? pickRandomLandmark()); // keep the current landmark if already open
};

const closeMap = (name: string) => {
  if (activeZone.current !== name) return; // ignore leaves from a store that no longer owns the map
  activeZone.current = null;
  setLandmark(null);
};

  return (
    <>
    {zones.map((z) => (
  <Zone
    key={z.name}
    {...z}
    onEnter={() => openMap(z)}
    onLeave={() => closeMap(z.name)}
    onSphereClick={() => openMap(z)}
  />
))}

      {/* one map for all stores */}
     <Html position={[anchor[0], 0, anchor[1]]}>
        <MapComponent location={landmark} onClose={() => setLandmark(null)} />
      </Html>
    </>
  );
}
