import http from "http";
import { WebSocketServer } from "ws";

// ============================================================================
// SERVER-AUTHORITATIVE WORLD DEFINITION — identical logic to party/server.ts,
// just running as a plain Node process instead of on Cloudflare's runtime.
// ============================================================================

const ARENA_BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

const OBSTACLE = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };

const PLAYER_HALF_SIZE = 0.5;
const MOVE_STEP = 1;

const STRUCTURES = [
  {
    ramp: { xStart: 6, xEnd: 12, zMin: -3, zMax: 3, height: 4 },
    platform: { xMin: 12, xMax: 18, zMin: -3, zMax: 3, height: 4 },
  },
  {
    ramp: { xStart: -20, xEnd: -14, zMin: 10, zMax: 16, height: 6 },
    platform: { xMin: -14, xMax: -6, zMin: 10, zMax: 16, height: 6 },
  },
  // add as many of these as you want — each is fully independent
];

function isOnPlatform(x, z) {
  return STRUCTURES.some(
    ({ platform }) =>
      x >= platform.xMin && x <= platform.xMax && z >= platform.zMin && z <= platform.zMax
  );
}

function isOnRamp(x, z) {
  return STRUCTURES.some(
    ({ ramp }) => x >= ramp.xStart && x <= ramp.xEnd && z >= ramp.zMin && z <= ramp.zMax
  );
}

function getHeightAt(x, z) {
  for (const { ramp, platform } of STRUCTURES) {
    if (x >= platform.xMin && x <= platform.xMax && z >= platform.zMin && z <= platform.zMax) {
      return platform.height;
    }
    if (x >= ramp.xStart && x <= ramp.xEnd && z >= ramp.zMin && z <= ramp.zMax) {
      const t = (x - ramp.xStart) / (ramp.xEnd - ramp.xStart);
      return t * ramp.height;
    }
  }
  return 0;
}

// NOTE: this in-memory Map is the entire game state. Cloud Run must be
// pinned to exactly ONE running instance (see deploy command) or different
// players could land on different containers with separate, disconnected
// game states.
const players = new Map(); // id -> { x, y, z }
const sockets = new Map(); // id -> ws
let nextId = 1;

function isValidPosition(x, z) {
  const half = PLAYER_HALF_SIZE;

  const outOfBounds =
    x - half < ARENA_BOUNDS.minX ||
    x + half > ARENA_BOUNDS.maxX ||
    z - half < ARENA_BOUNDS.minZ ||
    z + half > ARENA_BOUNDS.maxZ;
  if (outOfBounds) return false;

  const overlapsObstacle =
    x - half < OBSTACLE.maxX &&
    x + half > OBSTACLE.minX &&
    z - half < OBSTACLE.maxZ &&
    z + half > OBSTACLE.minZ;
  if (overlapsObstacle) return false;

  return true;
}

function clampDelta(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

// Animation/emote names the client is allowed to broadcast. These are purely
// cosmetic (no cheat/exploit surface), so the server just whitelists and
// relays them rather than simulating anything.
const ALLOWED_ACTIONS = new Set([
  "Dance",
  "Sitting",
  "Standing",
  "Death",
  "Jump",
  "Yes",
  "No",
  "Wave",
  "Punch",
  "ThumbsUp",
]);

function broadcast(msg, excludeId) {
  const data = JSON.stringify(msg);
  for (const [id, sock] of sockets) {
    if (id === excludeId) continue;
    if (sock.readyState === sock.OPEN) sock.send(data);
  }
}

function handleMove(id, msg) {
  const current = players.get(id);
  if (!current) return;

  const dx = clampDelta(msg.dx);
  const dz = clampDelta(msg.dz);
  const running = Boolean(msg.running);
  const nextX = current.x + dx * MOVE_STEP;
  const nextZ = current.z + dz * MOVE_STEP;

  const nextY = getHeightAt(nextX, nextZ);
  const enteringPlatform = isOnPlatform(nextX, nextZ);
  const cameFromRampOrPlatform = isOnRamp(current.x, current.z) || isOnPlatform(current.x, current.z);
  const platformEntryBlocked = enteringPlatform && !cameFromRampOrPlatform;

  if (isValidPosition(nextX, nextZ) && !platformEntryBlocked) {
    players.set(id, { x: nextX, y: nextY, z: nextZ });
    broadcast({ type: "update", id, x: nextX, y: nextY, z: nextZ, dx, dz, running });
  } else {
    sockets
      .get(id)
      ?.send(JSON.stringify({ type: "snapback", x: current.x, y: current.y, z: current.z }));
  }
}

function handleAction(id, msg) {
  if (!ALLOWED_ACTIONS.has(msg.action)) return;
  broadcast({ type: "action", id, action: msg.action });
}

// Plain HTTP server: also answers Cloud Run's health-check GET requests.
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  const id = `p${nextId++}`;
  sockets.set(id, ws);
  players.set(id, { x: 0, y: 0, z: 5 }); // always spawn somewhere known-valid

  ws.send(
    JSON.stringify({
      type: "state",
      selfId: id,
      players: Object.fromEntries(players),
    })
  );

  broadcast({ type: "update", id, x: 0, y: 0, z: 5, dx: 0, dz: 0, running: false }, id);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return; // drop malformed packets silently
    }
    if (msg.type === "move") handleMove(id, msg);
    else if (msg.type === "action") handleAction(id, msg);
  });

  ws.on("close", () => {
    players.delete(id);
    sockets.delete(id);
    broadcast({ type: "leave", id });
  });
});

const port = process.env.PORT || 8080;
server.listen(port, () => console.log(`Game server listening on ${port}`));
