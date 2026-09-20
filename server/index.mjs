import http from "http";
import { WebSocketServer } from "ws";
import RAPIER from "@dimforge/rapier3d-compat";
await RAPIER.init();
const BALL_TICK_HZ = 30;

// ============================================================================
// SERVER-AUTHORITATIVE WORLD DEFINITION — identical logic to party/server.ts,
// just running as a plain Node process instead of on Cloudflare's runtime.
// ============================================================================
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / BALL_TICK_HZ;
const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
world.createCollider(RAPIER.ColliderDesc.cuboid(100, 1, 100), floorBody);

// Spawn the ball above the new ramp (xStart..xEnd = 30..40) so it actually
// rolls down it instead of just dropping onto flat ground.


// Spawn just above the TOP of the ramp (x near 40, height 5) with a short
// drop, so first contact is gentle and it rolls the full length down
// instead of bouncing off a mid-slope impact.
const BALL_SPAWN = { x: 15, y: 6.5, z: 20 };
const ballBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(BALL_SPAWN.x, BALL_SPAWN.y, BALL_SPAWN.z)
    .setCcdEnabled(true)
    // Without damping, a rolling sphere never loses energy from friction
    // alone — it would roll at ~constant speed forever instead of settling.
    // These bleed off speed/spin so it actually comes to rest near the
    // base of the ramp, goes to sleep, and triggers the respawn.
    .setLinearDamping(1.5)
    .setAngularDamping(2)
);
world.createCollider(
  RAPIER.ColliderDesc.ball(0.5).setRestitution(0.1).setFriction(0.8),
  ballBody
);

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



// A standalone wedge-shaped ramp, positioned away from everything else so it's easy to spot.
// A standalone wedge-shaped ramp, positioned well clear of both STRUCTURES
// entries (which occupy x: 6–18 and x: -20–-6) so nothing overlaps.
// A standalone wedge-shaped ramp, positioned at (6, 0, 15) — clear of both
// STRUCTURES entries since it sits at a different z than STRUCTURES[0]
// and a different x than STRUCTURES[1].
const NEW_RAMP = { xStart: 6, xEnd: 16, zMin: 15, zMax: 25, height: 5 };
const rampLength = NEW_RAMP.xEnd - NEW_RAMP.xStart;
const rampWidth = NEW_RAMP.zMax - NEW_RAMP.zMin;

// Six vertices: a flat rectangular base at y=0, rising to a single top edge at y=height.
const rampVertices = new Float32Array([
  0, 0, 0,
  0, 0, rampWidth,
  rampLength, 0, 0,
  rampLength, 0, rampWidth,
  rampLength, NEW_RAMP.height, 0,
  rampLength, NEW_RAMP.height, rampWidth,
]);

const newRampBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.fixed().setTranslation(NEW_RAMP.xStart, 0, NEW_RAMP.zMin)
);
world.createCollider(RAPIER.ColliderDesc.convexHull(rampVertices), newRampBody);






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

// ============================================================================
// ===================== HELLO WORLD BALL PHYSICS ============================
// No physics engine at all — just gravity + a floor bounce, so there's a
// ball that visibly works end-to-end (server -> broadcast -> client render)
// before anything fancier (rolling, ramps, obstacle collision, a real
// physics engine) gets added. Deliberately the simplest thing that works.
// ============================================================================

const BALL_RADIUS = 0.5;

const BALL_GRAVITY = -9.81;
const BALL_BOUNCE = 0.6; // 0 = no bounce, 1 = bounces forever
const BALL_RESPAWN_DELAY_SEC = 2.5; // add next to the other BALL_ constants



// Tracks how long the ball has been at rest; only reset once it's been
// asleep for BALL_RESPAWN_DELAY_SEC, instead of the instant it settles.
// Rapier's isSleeping() can stay false indefinitely if the ball keeps
// jittering slightly on the ramp's collider, so track "at rest" ourselves
// using actual velocity instead — much more reliable for triggering respawn.
const AT_REST_SPEED = 0.3; // units/sec, both linear and angular
let atRestSinceMs = null;

function respawnBall() {
  ballBody.setTranslation(BALL_SPAWN, true);
  ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  ballBody.wakeUp();
  atRestSinceMs = null;
}

function tickBall() {
  world.step();

  const pos = ballBody.translation();
  const linvel = ballBody.linvel();
  const angvel = ballBody.angvel();
  const speed = Math.hypot(linvel.x, linvel.y, linvel.z);
  const spin = Math.hypot(angvel.x, angvel.y, angvel.z);
  const isAtRest = speed < AT_REST_SPEED && spin < AT_REST_SPEED;

  // Hard safety net: if it ever strays far from the ramp (regardless of
  // speed), reset immediately instead of letting it roll off indefinitely.
    const strayedTooFar =
    pos.x < NEW_RAMP.xStart - 5 ||
    pos.x > NEW_RAMP.xEnd + 5 ||
    pos.z < NEW_RAMP.zMin - 5 ||
    pos.z > NEW_RAMP.zMax + 5;

  if (strayedTooFar) {
    respawnBall();
  } else if (isAtRest) {
    if (atRestSinceMs === null) {
      atRestSinceMs = Date.now();
    } else if (Date.now() - atRestSinceMs >= BALL_RESPAWN_DELAY_SEC * 1000) {
      respawnBall();
    }
  } else {
    atRestSinceMs = null;
  }

  broadcast({ type: "ball", x: pos.x, y: pos.y, z: pos.z });

}
setInterval(tickBall, 1000 / BALL_TICK_HZ);// =============================== END SECTION ================================

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

  // ---- HELLO WORLD BALL PHYSICS: tell the new client where the ball is ----
ws.send(JSON.stringify({ type: "ball", x: ballBody.translation().x, y: ballBody.translation().y, z: ballBody.translation().z }));  // ---- end ----

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
