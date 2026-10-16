export const B = { x0: 30, z0: -50, w: 20, d: 20, H: 4, T: 0.4, rampW: 4, rampL: 10 };

function box(x1, x2, y1, y2, z1, z2) {
  return {
    cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, cz: (z1 + z2) / 2,
    hx: (x2 - x1) / 2, hy: (y2 - y1) / 2, hz: (z2 - z1) / 2,
  };
}

function rampSpec(s) {
  const { x0, z0, w, d, rampW, rampL } = B;
  const west = s % 2 === 0;
  const xMin = west ? x0 + 1 : x0 + w - 1 - rampW;
  const zMin = west ? z0 + 1 : z0 + d - 1 - rampL;
  return { xMin, xMax: xMin + rampW, zMin, zMax: zMin + rampL, rising: west ? 1 : -1 };
}

function slab(level, hole) {
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

function walls(s) {
  const { x0, z0, w, d, H, T } = B;
  const y1 = s * H, y2 = (s + 1) * H;
  const X1 = x0 + w, Z1 = z0 + d;
  const out = [
    box(x0, X1, y1, y2, z0, z0 + T),
    box(x0, x0 + T, y1, y2, z0, Z1),
    box(X1 - T, X1, y1, y2, z0, Z1),
  ];
  if (s === 0) {
    const dx1 = x0 + w / 2 - 2, dx2 = x0 + w / 2 + 2;
    out.push(box(x0, dx1, y1, y2, Z1 - T, Z1));
    out.push(box(dx2, X1, y1, y2, Z1 - T, Z1));
    out.push(box(dx1, dx2, y1 + 3, y2, Z1 - T, Z1));
  } else {
    out.push(box(x0, X1, y1, y2, Z1 - T, Z1));
  }
  return out;
}

export const buildingBoxes = [];
export const buildingRamps = [];

//for (let s = 0; s < 4; s++) buildingBoxes.push(...walls(s));

for (let level = 1; level <= 3; level++) {
  buildingBoxes.push(...slab(level, rampSpec(level - 1)));
}

for (let s = 0; s < 3; s++) {
  const { xMin, xMax, zMin, zMax, rising } = rampSpec(s);
  const y0 = s * B.H, y1 = (s + 1) * B.H;
  const topZ = rising > 0 ? zMax : zMin;
  buildingRamps.push({
    points: [
      [xMin, y0, zMin], [xMax, y0, zMin], [xMin, y0, zMax], [xMax, y0, zMax],
      [xMin, y1, topZ], [xMax, y1, topZ],
    ],
  });
}