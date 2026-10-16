export const B = { x0: 30, z0: -50, w: 20, d: 20, H: 4, T: 0.4, rampW: 4, rampL: 10 };
// Occupies x 30..50, z -50..-30 (the SE zone), clear of your other objects.

export type Box = { cx: number; cy: number; cz: number; hx: number; hy: number; hz: number };
export type Ramp = { points: [number, number, number][] };

// Build a box from min/max corners (hx/hy/hz are HALF sizes, which is what Rapier wants).
function box(x1: number, x2: number, y1: number, y2: number, z1: number, z2: number): Box {
  return {
    cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, cz: (z1 + z2) / 2,
    hx: (x2 - x1) / 2, hy: (y2 - y1) / 2, hz: (z2 - z1) / 2,
  };
}

// Ramp s goes from floor s up to floor s+1. Even ramps sit on the west side
// and rise toward +z; odd ramps sit on the east side and rise toward -z.
function rampSpec(s: number) {
  const { x0, z0, w, d, rampW, rampL } = B;
  const west = s % 2 === 0;
  const xMin = west ? x0 + 1 : x0 + w - 1 - rampW;
  const zMin = west ? z0 + 1 : z0 + d - 1 - rampL;
  return { xMin, xMax: xMin + rampW, zMin, zMax: zMin + rampL, rising: west ? 1 : -1 };
}

// A floor slab. The hole (where the ramp below arrives) is built by
// using four boxes around it instead of one.
function slab(level: number, hole: ReturnType<typeof rampSpec> | null): Box[] {
  const { x0, z0, w, d, H, T } = B;
  const top = level * H, bot = top - T;
  const X1 = x0 + w, Z1 = z0 + d;
  if (!hole) return [box(x0, X1, bot, top, z0, Z1)];
  const { xMin, xMax, zMin, zMax } = hole;
  return [
    box(x0, X1, bot, top, z0, zMin),
    box(x0, X1, bot, top, zMax, Z1),
    box(x0, xMin, bot, top, zMin, zMax),
    box(xMax, X1, bot, top, zMin, zMax),
  ].filter((b) => b.hx > 0 && b.hz > 0);
}

function walls(s: number): Box[] {
  const { x0, z0, w, d, H, T } = B;
  const y1 = s * H, y2 = (s + 1) * H;
  const X1 = x0 + w, Z1 = z0 + d;
  const out: Box[] = [
    box(x0, X1, y1, y2, z0, z0 + T),   // south
    box(x0, x0 + T, y1, y2, z0, Z1),   // west
    box(X1 - T, X1, y1, y2, z0, Z1),   // east
  ];
  if (s === 0) {
    // north wall with a 4-wide, 3-tall doorway in the middle
    const dx1 = x0 + w / 2 - 2, dx2 = x0 + w / 2 + 2;
    out.push(box(x0, dx1, y1, y2, Z1 - T, Z1));
    out.push(box(dx2, X1, y1, y2, Z1 - T, Z1));
    out.push(box(dx1, dx2, y1 + 3, y2, Z1 - T, Z1)); // lintel above the door
  } else {
    out.push(box(x0, X1, y1, y2, Z1 - T, Z1));
  }
  return out;
}

export const buildingBoxes: Box[] = [];
export const buildingRamps: Ramp[] = [];

//for (let s = 0; s < 4; s++) buildingBoxes.push(...walls(s));

// Floors 1..3 each have a hole where the ramp below arrives; level 4 is the roof.
for (let level = 1; level <= 3; level++) {
  buildingBoxes.push(...slab(level, rampSpec(level - 1)));
}
for (let s = 0; s < 3; s++) {
  const { xMin, xMax, zMin, zMax, rising } = rampSpec(s);
  const y0 = s * B.H, y1 = (s + 1) * B.H;
  const topZ = rising > 0 ? zMax : zMin;
  buildingRamps.push({
    points: [
      [xMin, y0, zMin], [xMax, y0, zMin], [xMin, y0, zMax], [xMax, y0, zMax], // base
      [xMin, y1, topZ], [xMax, y1, topZ],                                      // top edge
    ],
  });
}