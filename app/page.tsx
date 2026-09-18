"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import usePartySocket from "partysocket/react";
import Robot, { type RobotHandle } from "@/components/Robot";

const ARENA_SIZE = 200;
const OBSTACLE = { x: 0, z: 0, size: 3 };
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
type PlayerState = { x: number; y: number; z: number };
type Players = Record<string, PlayerState>;
type Facings = Record<string, number>;

type ServerMessage =
  | { type: "state"; selfId: string; players: Players }
  | {
      type: "update";
      id: string;
      x: number;
      z: number;
   y: number;        // ← add
      dx: number;
      dz: number;
      running: boolean;
    }
  | { type: "snapback"; x: number; y: number; z: number }   // ← add y
  | { type: "action"; id: string; action: string }
  | { type: "leave"; id: string };

const DIRECTIONS: Record<string, { dx: number; dz: number }> = {
  ArrowUp: { dx: 0, dz: -1 },
  ArrowDown: { dx: 0, dz: 1 },
  ArrowLeft: { dx: -1, dz: 0 },
  ArrowRight: { dx: 1, dz: 0 },
};

// Looping poses vs. one-shot gestures — see components/Robot.tsx for how
// these are actually played back.
const STATE_BUTTONS = ["Dance", "Sitting", "Standing", "Death"];
const EMOTE_BUTTONS = ["Wave", "Jump", "Yes", "No", "Punch", "ThumbsUp"];

export default function GamePage() {
  const [players, setPlayers] = useState<Players>({});
  const [facings, setFacings] = useState<Facings>({});
  const [runMode, setRunMode] = useState(false);
  const selfIdRef = useRef<string | null>(null);
  const robotHandles = useRef<Record<string, RobotHandle>>({});

  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!, // e.g. "localhost:1999"
    room: "game-room",
    onMessage(event) {
      const msg: ServerMessage = JSON.parse(event.data);

      switch (msg.type) {
        case "state": {
          selfIdRef.current = msg.selfId;
          setPlayers(msg.players);
          break;
        }
        case "update": {
  setPlayers((prev) => ({ ...prev, [msg.id]: { x: msg.x, y: msg.y, z: msg.z } }));
          if (msg.dx !== 0 || msg.dz !== 0) {
            setFacings((prev) => ({ ...prev, [msg.id]: Math.atan2(msg.dx, msg.dz) }));
          }
          robotHandles.current[msg.id]?.notifyMove(msg.running);
          break;
        }
        case "snapback": {
          const selfId = selfIdRef.current;
          if (!selfId) return;
  setPlayers((prev) => ({ ...prev, [selfId]: { x: msg.x, y: msg.y, z: msg.z } }));
          break;
        }
        case "action": {
          robotHandles.current[msg.id]?.notifyAction(msg.action);
          break;
        }
        case "leave": {
          setPlayers((prev) => {
            const next = { ...prev };
            delete next[msg.id];
            return next;
          });
          delete robotHandles.current[msg.id];
          break;
        }
      }
    },
  });

  const requestMove = useCallback(
    (dx: number, dz: number) => {
      const selfId = selfIdRef.current;
      if (!selfId) return;

      // Optimistic local prediction for responsiveness — the server is still
      // the source of truth and will snap us back if this guess is wrong.
      setPlayers((prev) => {
        const current = prev[selfId];
        if (!current) return prev;
  return { ...prev, [selfId]: { x: current.x + dx, y: current.y, z: current.z + dz } };
      });
      if (dx !== 0 || dz !== 0) {
        setFacings((prev) => ({ ...prev, [selfId]: Math.atan2(dx, dz) }));
      }
      robotHandles.current[selfId]?.notifyMove(runMode);

      socket.send(JSON.stringify({ type: "move", dx, dz, running: runMode }));
    },
    [socket, runMode]
  );

  const requestAction = useCallback(
    (action: string) => {
      const selfId = selfIdRef.current;
      if (!selfId) return;
      robotHandles.current[selfId]?.notifyAction(action); // optimistic, cosmetic only
      socket.send(JSON.stringify({ type: "action", action }));
    },
    [socket]
  );

  // Desktop keyboard support.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const dir = DIRECTIONS[e.key];
      if (!dir) return;
      e.preventDefault();
      requestMove(dir.dx, dir.dz);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestMove]);

  // Stop the page from scrolling/zooming under the on-screen touch controls.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        background: "#111",
        position: "relative",
        touchAction: "none",
        overscrollBehavior: "none",
      }}
    >
      <Canvas camera={{ position: [0, 14, 14], fov: 50 }}>
  <CameraRig target={selfIdRef.current ? players[selfIdRef.current] ?? null : null} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 10, 5]} intensity={1} />

        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[ARENA_SIZE, ARENA_SIZE]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>

        <mesh position={[OBSTACLE.x, 0.5, OBSTACLE.z]}>
          <boxGeometry args={[OBSTACLE.size, 1, OBSTACLE.size]} />
          <meshStandardMaterial color="red" />
        </mesh>

{STRUCTURES.map(({ ramp, platform }, i) => (
  <group key={i}>
    <mesh
      position={[
        (ramp.xStart + ramp.xEnd) / 2,
        ramp.height / 2,
        (ramp.zMin + ramp.zMax) / 2,
      ]}
      rotation={[0, 0, Math.atan2(ramp.height, ramp.xEnd - ramp.xStart)]}
    >
      <boxGeometry
        args={[Math.hypot(ramp.xEnd - ramp.xStart, ramp.height), 0.4, ramp.zMax - ramp.zMin]}
      />
      <meshStandardMaterial color="#888" />
    </mesh>

    <mesh
      position={[
        (platform.xMin + platform.xMax) / 2,
        platform.height / 2,
        (platform.zMin + platform.zMax) / 2,
      ]}
    >
      <boxGeometry
        args={[platform.xMax - platform.xMin, platform.height, platform.zMax - platform.zMin]}
      />
      <meshStandardMaterial color="#666" />
    </mesh>
  </group>
))}
        {Object.entries(players).map(([id, p]) => (
          <Robot
            key={id}
position={[p.x, p.y, p.z]}
            facing={facings[id] ?? 0}
            color={id === selfIdRef.current ? "#4da6ff" : "#ffa64d"}
            onReady={(handle) => {
              robotHandles.current[id] = handle;
            }}
          />
        ))}
      </Canvas>
<CoordsDisplay position={selfIdRef.current ? players[selfIdRef.current] ?? null : null} />

      <DPad onMove={requestMove} runMode={runMode} onToggleRun={() => setRunMode((r) => !r)} />
      <ActionBar onAction={requestAction} />
    </div>
  );
}
function CameraRig({ target }: { target: PlayerState | null }) {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!target) return;
    desired.current.set(target.x, target.y + 14, target.z + 14);
    camera.position.lerp(desired.current, 0.1);
    camera.lookAt(target.x, target.y, target.z);
  });

  return null;
}
function CoordsDisplay({ position }: { position: PlayerState | null }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        padding: "6px 10px",
        borderRadius: 8,
        background: "rgba(0,0,0,0.5)",
        color: "white",
        fontSize: 13,
        fontFamily: "monospace",
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      x: {position ? position.x.toFixed(1) : "—"} &nbsp;
      y: {position ? position.y.toFixed(1) : "—"} &nbsp;
      z: {position ? position.z.toFixed(1) : "—"}
    </div>
  );
}
function DPad({
  onMove,
  runMode,
  onToggleRun,
}: {
  onMove: (dx: number, dz: number) => void;
  runMode: boolean;
  onToggleRun: () => void;
}) {
  // clamp() shrinks these on narrow/mobile viewports while staying capped
  // at the original 56px on desktop — no JS viewport detection needed.
  const btnSize = "clamp(42px, 11vw, 56px)";
  const btnStyle: CSSProperties = {
    width: btnSize,
    height: btnSize,
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.15)",
    color: "white",
    fontSize: "clamp(16px, 4.5vw, 22px)",
    touchAction: "none",
    userSelect: "none",
    WebkitTouchCallout: "none",
  };
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
        display: "grid",
        gridTemplateColumns: `repeat(3, ${btnSize})`,
        gridTemplateRows: `repeat(3, ${btnSize})`,
        gap: 6,
      }}
    >
      <div />
      <button style={btnStyle} onPointerDown={() => onMove(0, -1)}>
        ↑
      </button>
      <div />
      <button style={btnStyle} onPointerDown={() => onMove(-1, 0)}>
        ←
      </button>
      <button
        style={{ ...btnStyle, background: runMode ? "#4da6ff" : "rgba(255,255,255,0.15)" }}
        onPointerDown={onToggleRun}
      >
        Run
      </button>
      <button style={btnStyle} onPointerDown={() => onMove(1, 0)}>
        →
      </button>
      <div />
      <button style={btnStyle} onPointerDown={() => onMove(0, 1)}>
        ↓
      </button>
      <div />
    </div>
  );
}

function ActionBar({ onAction }: { onAction: (action: string) => void }) {
  const buttons = [...STATE_BUTTONS, ...EMOTE_BUTTONS];
  const btnStyle: CSSProperties = {
    padding: "clamp(6px, 2vw, 10px) clamp(9px, 3vw, 14px)",
    borderRadius: 10,
    border: "none",
    background: "rgba(255,255,255,0.15)",
    color: "white",
    fontSize: "clamp(11px, 2.8vw, 13px)",
    touchAction: "none",
    userSelect: "none",
    WebkitTouchCallout: "none",
  };
  return (
    <div
      style={{
        position: "absolute",
        right: 16,
        bottom: 16,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        maxWidth: 220,
        justifyContent: "flex-end",
      }}
    >
      {buttons.map((b) => (
        <button key={b} style={btnStyle} onPointerDown={() => onAction(b)}>
          {b}
        </button>
      ))}
    </div>
  );
}