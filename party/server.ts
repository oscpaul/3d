import type * as Party from "partykit/server";

// ============================================================================
// SERVER-AUTHORITATIVE WORLD DEFINITION
// The client never sees or trusts these numbers directly — this is the
// single source of truth for what is/isn't a legal position.
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
  // Add as many of these as you want — each is fully independent.
];

function isOnPlatform(x: number, z: number): boolean {
  return STRUCTURES.some(
    ({ platform }) =>
      x >= platform.xMin &&
      x <= platform.xMax &&
      z >= platform.zMin &&
      z <= platform.zMax,
  );
}

function isOnRamp(x: number, z: number): boolean {
  return STRUCTURES.some(
    ({ ramp }) =>
      x >= ramp.xStart &&
      x <= ramp.xEnd &&
      z >= ramp.zMin &&
      z <= ramp.zMax,
  );
}

function getHeightAt(x: number, z: number): number {
  for (const { ramp, platform } of STRUCTURES) {
    if (
      x >= platform.xMin &&
      x <= platform.xMax &&
      z >= platform.zMin &&
      z <= platform.zMax
    ) {
      return platform.height;
    }

    if (
      x >= ramp.xStart &&
      x <= ramp.xEnd &&
      z >= ramp.zMin &&
      z <= ramp.zMax
    ) {
      const t = (x - ramp.xStart) / (ramp.xEnd - ramp.xStart);
      return t * ramp.height;
    }
  }

  return 0;
}

// Animation/emote names the client is allowed to broadcast.
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

type PlayerState = {
  x: number;
  y: number;
  z: number;
};

type IncomingMessage =
  | { type: "move"; dx: number; dz: number; running?: boolean }
  | { type: "action"; action: string };

type OutgoingMessage =
  | {
      type: "state";
      selfId: string;
      players: Record<string, PlayerState>;
    }
  | {
      type: "update";
      id: string;
      x: number;
      y: number;
      z: number;
      dx: number;
      dz: number;
      running: boolean;
    }
  | {
      type: "snapback";
      x: number;
      y: number;
      z: number;
    }
  | { type: "action"; id: string; action: string }
  | { type: "leave"; id: string }
  | { type: "ball"; x: number; y: number; z: number };

// ============================================================================
// ===================== HELLO WORLD BALL PHYSICS ============================
// No physics engine at all — no Rapier, no cannon-es, nothing external.
// Just gravity + a floor bounce, so you have a ball that visibly works
// end-to-end (server -> broadcast -> client render) before adding anything
// fancier (rolling, ramps, obstacle collision, a real physics engine, etc).
// Everything in this section is deliberately the simplest thing that could
// possibly work. Replace it whenever you're ready for real physics.
// ============================================================================

const BALL_RADIUS = 0.5;
const BALL_SPAWN = { x: 0, y: 8, z: 0 };
const BALL_TICK_HZ = 30;
const BALL_GRAVITY = -9.81;
const BALL_BOUNCE = 0.6; // 0 = no bounce, 1 = bounces forever

type BallState = { x: number; y: number; z: number; vy: number };

// =============================== END SECTION ================================

export default class GameServer implements Party.Server {
  players: Map<string, PlayerState> = new Map();

  // ---- HELLO WORLD BALL PHYSICS: state + tick timer ----
  private ball: BallState = {
    x: BALL_SPAWN.x,
    y: BALL_SPAWN.y,
    z: BALL_SPAWN.z,
    vy: 0,
  };
  private ballTimer?: ReturnType<typeof setInterval>;
  // ---- end ----

  constructor(readonly room: Party.Room) {}

  onStart() {
    // ---- HELLO WORLD BALL PHYSICS: start the tick loop ----
    const intervalMs = 1000 / BALL_TICK_HZ;
    this.ballTimer = setInterval(() => this.tickBall(), intervalMs);
    // ---- end ----
  }

  onConnect(conn: Party.Connection) {
    // Always spawn somewhere known-valid — never trust a client-supplied spawn.
    this.players.set(conn.id, { x: 0, y: 0, z: 5 });

    conn.send(
      JSON.stringify({
        type: "state",
        selfId: conn.id,
        players: Object.fromEntries(this.players),
      } satisfies OutgoingMessage),
    );

    this.room.broadcast(
      JSON.stringify({
        type: "update",
        id: conn.id,
        ...this.players.get(conn.id)!,
        dx: 0,
        dz: 0,
        running: false,
      } satisfies OutgoingMessage),
      [conn.id],
    );

    // ---- HELLO WORLD BALL PHYSICS: tell the new client where the ball is ----
    conn.send(
      JSON.stringify({
        type: "ball",
        x: this.ball.x,
        y: this.ball.y,
        z: this.ball.z,
      } satisfies OutgoingMessage),
    );
    // ---- end ----
  }

  onClose(conn: Party.Connection) {
    this.players.delete(conn.id);

    this.room.broadcast(
      JSON.stringify({
        type: "leave",
        id: conn.id,
      } satisfies OutgoingMessage),
    );
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: IncomingMessage;

    try {
      msg = JSON.parse(message) as IncomingMessage;
    } catch {
      return;
    }

    if (msg.type === "move") {
      this.handleMove(msg, sender);
    } else if (msg.type === "action") {
      this.handleAction(msg, sender);
    }
  }

  private handleMove(
    msg: { dx: number; dz: number; running?: boolean },
    sender: Party.Connection,
  ) {
    const current = this.players.get(sender.id);
    if (!current) return;

    // The client sends a DIRECTION, never a coordinate.
    const dx = clampDelta(msg.dx);
    const dz = clampDelta(msg.dz);
    const running = Boolean(msg.running);

    const nextX = current.x + dx * MOVE_STEP;
    const nextZ = current.z + dz * MOVE_STEP;
    const nextY = getHeightAt(nextX, nextZ);

    const enteringPlatform = isOnPlatform(nextX, nextZ);
    const cameFromRampOrPlatform =
      isOnRamp(current.x, current.z) ||
      isOnPlatform(current.x, current.z);

    const platformEntryBlocked =
      enteringPlatform && !cameFromRampOrPlatform;

    if (this.isValidPosition(nextX, nextZ) && !platformEntryBlocked) {
      const nextState = {
        x: nextX,
        y: nextY,
        z: nextZ,
      };

      this.players.set(sender.id, nextState);

      this.room.broadcast(
        JSON.stringify({
          type: "update",
          id: sender.id,
          x: nextX,
          y: nextY,
          z: nextZ,
          dx,
          dz,
          running,
        } satisfies OutgoingMessage),
      );
    } else {
      sender.send(
        JSON.stringify({
          type: "snapback",
          x: current.x,
          y: current.y,
          z: current.z,
        } satisfies OutgoingMessage),
      );
    }
  }

  private handleAction(
    msg: { action: string },
    sender: Party.Connection,
  ) {
    if (!ALLOWED_ACTIONS.has(msg.action)) return;

    this.room.broadcast(
      JSON.stringify({
        type: "action",
        id: sender.id,
        action: msg.action,
      } satisfies OutgoingMessage),
    );
  }

  // ==========================================================================
  // ===================== HELLO WORLD BALL PHYSICS ==========================
  // Just gravity pulling the ball down and a bounce off y = 0. No ramps, no
  // obstacle, no rolling. See the top of this file for why.
  // ==========================================================================
  private tickBall() {
    const dt = 1 / BALL_TICK_HZ;
    const b = this.ball;

    b.vy += BALL_GRAVITY * dt;
    b.y += b.vy * dt;

    const floor = BALL_RADIUS; // ball rests with its center one radius above y = 0
    if (b.y <= floor) {
      b.y = floor;
      b.vy = -b.vy * BALL_BOUNCE;
      if (Math.abs(b.vy) < 0.5) b.vy = 0; // stop tiny endless bounces
    }

    this.room.broadcast(
      JSON.stringify({
        type: "ball",
        x: b.x,
        y: b.y,
        z: b.z,
      } satisfies OutgoingMessage),
    );
  }
  // =============================== END SECTION =============================

  /** Pure AABB check — arena bounds + obstacle overlap. */
  isValidPosition(x: number, z: number): boolean {
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
}

/** Defensive clamp — a single move request is only ever one grid step. */
function clampDelta(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}
