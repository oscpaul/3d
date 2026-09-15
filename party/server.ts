import type * as Party from "partykit/server";

// ============================================================================
// SERVER-AUTHORITATIVE WORLD DEFINITION
// The client never sees or trusts these numbers directly — this is the
// single source of truth for what is/isn't a legal position.
// ============================================================================

const ARENA_BOUNDS = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

const OBSTACLE = { minX: -1.5, maxX: 1.5, minZ: -1.5, maxZ: 1.5 };

const PLAYER_HALF_SIZE = 0.5; // player treated as a 1x1 box for AABB math
const MOVE_STEP = 1; // grid-step "Hello World" movement

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

type PlayerState = { x: number; z: number };

type IncomingMessage =
  | { type: "move"; dx: number; dz: number; running?: boolean }
  | { type: "action"; action: string };

type OutgoingMessage =
  | { type: "state"; selfId: string; players: Record<string, PlayerState> }
  | {
      type: "update";
      id: string;
      x: number;
      z: number;
      dx: number;
      dz: number;
      running: boolean;
    }
  | { type: "snapback"; x: number; z: number }
  | { type: "action"; id: string; action: string }
  | { type: "leave"; id: string };

export default class GameServer implements Party.Server {
  players: Map<string, PlayerState> = new Map();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    // Always spawn somewhere known-valid — never trust a client-supplied spawn.
    this.players.set(conn.id, { x: 0, z: 5 });

    conn.send(
      JSON.stringify({
        type: "state",
        selfId: conn.id,
        players: Object.fromEntries(this.players),
      } satisfies OutgoingMessage)
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
      [conn.id]
    );
  }

  onClose(conn: Party.Connection) {
    this.players.delete(conn.id);
    this.room.broadcast(
      JSON.stringify({ type: "leave", id: conn.id } satisfies OutgoingMessage)
    );
  }

  onMessage(message: string, sender: Party.Connection) {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(message);
    } catch {
      return; // drop malformed packets silently
    }

    if (msg.type === "move") {
      this.handleMove(msg, sender);
    } else if (msg.type === "action") {
      this.handleAction(msg, sender);
    }
  }

  private handleMove(
    msg: { dx: number; dz: number; running?: boolean },
    sender: Party.Connection
  ) {
    const current = this.players.get(sender.id);
    if (!current) return;

    // The client sends a DIRECTION, never a coordinate. The server computes
    // the destination itself, so there's no raw position for a client to
    // spoof or teleport with.
    const dx = clampDelta(msg.dx);
    const dz = clampDelta(msg.dz);
    const running = Boolean(msg.running);
    const nextX = current.x + dx * MOVE_STEP;
    const nextZ = current.z + dz * MOVE_STEP;

    if (this.isValidPosition(nextX, nextZ)) {
      this.players.set(sender.id, { x: nextX, z: nextZ });
      this.room.broadcast(
        JSON.stringify({
          type: "update",
          id: sender.id,
          x: nextX,
          z: nextZ,
          dx,
          dz,
          running,
        } satisfies OutgoingMessage)
      );
    } else {
      // Reject: tell ONLY the offending client to resync to last-known-good.
      sender.send(
        JSON.stringify({
          type: "snapback",
          x: current.x,
          z: current.z,
        } satisfies OutgoingMessage)
      );
    }
  }

  private handleAction(msg: { action: string }, sender: Party.Connection) {
    if (!ALLOWED_ACTIONS.has(msg.action)) return; // ignore unknown/garbage input
    this.room.broadcast(
      JSON.stringify({
        type: "action",
        id: sender.id,
        action: msg.action,
      } satisfies OutgoingMessage)
    );
  }

  /** Pure AABB check — arena bounds + obstacle overlap. No physics libs needed. */
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
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}