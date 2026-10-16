import { B } from "./building";

export type Pt = { x: number; z: number };
export type Target = { x: number; z: number; floor: number };

const H = B.H;
const MARGIN = 2;
const RECT = {
  x0: B.x0 - MARGIN, x1: B.x0 + B.w + MARGIN,
  z0: B.z0 - MARGIN, z1: B.z0 + B.d + MARGIN,
};

// Door (north wall, centred)
const DOOR_X = B.x0 + B.w / 2;
const DOOR_OUT: Pt = { x: DOOR_X, z: RECT.z1 };          // just outside
const DOOR_IN: Pt = { x: DOOR_X, z: B.z0 + B.d - 3 };    // just inside

// West ramps (floors 0->1 and 2->3): low end at the south wall, rising toward +z
const WEST_X = B.x0 + 1 + B.rampW / 2;
const WEST_LANE = B.x0 + 1 + B.rampW + 1;   // walking lane beside the ramp
const WEST_LOW_Z = B.z0 + 1;
const WEST_HIGH_Z = B.z0 + 1 + B.rampL;

// East ramp (floor 1->2): low end at the north wall, rising toward -z
const EAST_X0 = B.x0 + B.w - 1 - B.rampW;
const EAST_X = EAST_X0 + B.rampW / 2;
const EAST_LANE = EAST_X0 - 1;
const EAST_LOW_Z = B.z0 + B.d - 1;
const EAST_HIGH_Z = EAST_LOW_Z - B.rampL;

// The ramps' low ends touch a wall, so you step onto them from the side lane.
const upWest: Pt[] = [
  { x: WEST_LANE, z: WEST_LOW_Z }, { x: WEST_X, z: WEST_LOW_Z }, { x: WEST_X, z: WEST_HIGH_Z + 1 },
];
const upEast: Pt[] = [
  { x: EAST_LANE, z: EAST_LOW_Z }, { x: EAST_X, z: EAST_LOW_Z }, { x: EAST_X, z: EAST_HIGH_Z - 1 },
];
const downWest: Pt[] = [
  { x: WEST_X, z: WEST_HIGH_Z + 1 }, { x: WEST_X, z: WEST_LOW_Z }, { x: WEST_LANE, z: WEST_LOW_Z },
];
const downEast: Pt[] = [
  { x: EAST_X, z: EAST_HIGH_Z - 1 }, { x: EAST_X, z: EAST_LOW_Z }, { x: EAST_LANE, z: EAST_LOW_Z },
];

const UP: Pt[][] = [upWest, upEast, upWest];            // from floor 0, 1, 2
const DOWN: Pt[][] = [[], downWest, downEast, downWest]; // from floor 1, 2, 3

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function inBuilding(x: number, z: number) {
  return x > B.x0 && x < B.x0 + B.w && z > B.z0 && z < B.z0 + B.d;
}

// Does an axis-aligned segment pass through the (margined) building box?
function segHits(a: Pt, b: Pt) {
  return (
    Math.min(a.x, b.x) < RECT.x1 && Math.max(a.x, b.x) > RECT.x0 &&
    Math.min(a.z, b.z) < RECT.z1 && Math.max(a.z, b.z) > RECT.z0
  );
}

// The walker moves along x first, then z. Would that cut through the building?
function blocked(a: Pt, b: Pt) {
  const c = { x: b.x, z: a.z };
  return segHits(a, c) || segHits(c, b);
}

const laneX = (x: number) => (x >= DOOR_X ? Math.max(x, RECT.x1) : Math.min(x, RECT.x0));

function toDoor(p: Pt): Pt[] {
  if (p.z >= RECT.z1) return [DOOR_OUT];
  const lx = laneX(p.x);
  return [{ x: lx, z: p.z }, { x: lx, z: RECT.z1 }, DOOR_OUT];
}

function fromDoor(p: Pt): Pt[] {
  if (p.z >= RECT.z1) return [p];
  const lx = laneX(p.x);
  return [{ x: lx, z: RECT.z1 }, { x: lx, z: p.z }, p];
}

export function planPath(cur: { x: number; y: number; z: number }, tgt: Target): Pt[] {
  const curIn = inBuilding(cur.x, cur.z);
  const tgtIn = inBuilding(tgt.x, tgt.z);
  const t: Pt = { x: tgt.x, z: tgt.z };

  // Both outside: walk straight unless that would cut through the building.
  if (!curIn && !tgtIn) {
    return blocked(cur, t) ? [...toDoor(cur), ...fromDoor(t)] : [t];
  }

  const path: Pt[] = [];
  let floor = 0;
  if (curIn) floor = clamp(Math.round(cur.y / H), 0, 3);
  else path.push(...toDoor(cur), DOOR_IN);

  const goal = tgtIn ? clamp(tgt.floor, 0, 3) : 0;
  while (floor < goal) { path.push(...UP[floor]); floor++; }
  while (floor > goal) { path.push(...DOWN[floor]); floor--; }

  if (tgtIn) path.push(t);
  else path.push(DOOR_IN, DOOR_OUT, ...fromDoor(t));
  return path;
}