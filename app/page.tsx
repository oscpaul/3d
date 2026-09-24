"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import usePartySocket from "partysocket/react";
import Robot, { type RobotHandle } from "@/components/Robot";
import RiveRobot from "@/components/RiveRobot";


// Must match NEW_RAMP in the server exactly — this is only used for
// rendering, the server is authoritative for collision/height.
// A standalone wedge-shaped ramp, positioned at (6, 0, 15) — clear of both
// STRUCTURES entries since it sits at a different z than STRUCTURES[0]
// and a different x than STRUCTURES[1].
// Must match NEW_RAMP in the server exactly — this is only used for
// rendering, the server is authoritative for collision/height.
const NEW_RAMP = { xStart: 6, xEnd: 16, zMin: 15, zMax: 25, height: 5 };
const ARENA_SIZE = 200;
const OBSTACLE = { x: 0, z: 0, size: 3 };
const BALL_BOUNDARY = {
minX: -4,
  maxX: NEW_RAMP.xEnd + 5,
  minZ: NEW_RAMP.zMin - 5,
  maxZ: NEW_RAMP.zMax + 5,
};
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


// ── Map zones: split the arena into 4 equal quadrants at x=0 / z=0 ─────────
const ARENA_HALF = ARENA_SIZE / 2; // 100
const ZONES = [
  { id: 0, label: "NE", xMin: 0, xMax: ARENA_HALF, zMin: 0, zMax: ARENA_HALF },
  { id: 1, label: "NW", xMin: -ARENA_HALF, xMax: 0, zMin: 0, zMax: ARENA_HALF },
  { id: 2, label: "SW", xMin: -ARENA_HALF, xMax: 0, zMin: -ARENA_HALF, zMax: 0 },
  { id: 3, label: "SE", xMin: 0, xMax: ARENA_HALF, zMin: -ARENA_HALF, zMax: 0 },
] as const;

function getZone(x: number, z: number): number {
  if (x >= 0 && z >= 0) return 0;
  if (x < 0 && z >= 0) return 1;
  if (x < 0 && z < 0) return 2;
  return 3;
}

// Precomputed once, since these objects never move.
const OBSTACLE_ZONE = getZone(OBSTACLE.x, OBSTACLE.z);
const NEW_RAMP_ZONE = getZone(
  (NEW_RAMP.xStart + NEW_RAMP.xEnd) / 2,
  (NEW_RAMP.zMin + NEW_RAMP.zMax) / 2
);
const STRUCTURE_ZONES = STRUCTURES.map(({ ramp, platform }) => {
  const minX = Math.min(ramp.xStart, platform.xMin);
  const maxX = Math.max(ramp.xEnd, platform.xMax);
  const minZ = Math.min(ramp.zMin, platform.zMin);
  const maxZ = Math.max(ramp.zMax, platform.zMax);
  return getZone((minX + maxX) / 2, (minZ + maxZ) / 2);
});


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
  | { type: "leave"; id: string }
  | { type: "ball"; x: number; y: number; z: number };   // ← add

const TURN_STEP = Math.PI / 2; // 90° per turn press

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
const [ballPosition, setBallPosition] = useState<PlayerState | null>(null);
const [heading, setHeading] = useState(0);

const [showRiveRobot, setShowRiveRobot] = useState(false);
const riveTimerRef = useRef<number | null>(null);


  const socket = usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST!, // e.g. "localhost:1999"
    room: "game-room",
onMessage(event) {
  const msg: ServerMessage = JSON.parse(event.data);

  switch (msg.type) {
case "ball": {
  setBallPosition({ x: msg.x, y: msg.y, z: msg.z });
  break;
}
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

 const moveAlongHeading = useCallback(
  (sign: 1 | -1) => {
    const selfId = selfIdRef.current;
    if (!selfId) return;

    // Down (sign === -1) turns the character 180° and walks forward in
    // that new direction, instead of walking backward while still facing
    // the old way. Since FollowCamera reads `heading` too, the camera
    // swings around with him.
    const moveHeading = sign === 1 ? heading : wrapAngle(heading + Math.PI);

    const dx = Math.round(Math.sin(moveHeading));
    const dz = Math.round(Math.cos(moveHeading));
    if (dx === 0 && dz === 0) return;

    setPlayers((prev) => {
      const current = prev[selfId];
      if (!current) return prev;
      return { ...prev, [selfId]: { x: current.x + dx, y: current.y, z: current.z + dz } };
    });
    setFacings((prev) => ({ ...prev, [selfId]: moveHeading }));
    if (sign === -1) setHeading(moveHeading);
    robotHandles.current[selfId]?.notifyMove(runMode);

    socket.send(JSON.stringify({ type: "move", dx, dz, running: runMode }));
  },
  [socket, runMode, heading]
);

const TWO_PI = Math.PI * 2;
const wrapAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI;

const turn = useCallback((sign: 1 | -1) => {
  const selfId = selfIdRef.current;
  setHeading((h) => {
const next = wrapAngle(h + sign * TURN_STEP);
    if (selfId) setFacings((prev) => ({ ...prev, [selfId]: next }));
    return next;
  });
}, []);

const handleBallClick = useCallback(() => {
setShowRiveRobot(true);

if (riveTimerRef.current !== null) {
window.clearTimeout(riveTimerRef.current);
}

riveTimerRef.current = window.setTimeout(() => {
setShowRiveRobot(false);
riveTimerRef.current = null;
}, 1500);
}, []);



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
    if (e.key === "ArrowUp") { e.preventDefault(); moveAlongHeading(1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); moveAlongHeading(-1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); turn(1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); turn(-1); }
  }
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [moveAlongHeading, turn]);


  // Stop the page from scrolling/zooming under the on-screen touch controls.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);



const playerPos = selfIdRef.current ? players[selfIdRef.current] ?? null : null;
const selfFacing = selfIdRef.current ? facings[selfIdRef.current] ?? 0 : 0;
const selfZone = playerPos ? getZone(playerPos.x, playerPos.z) : null;
const ballZone = ballPosition ? getZone(ballPosition.x, ballPosition.z) : null;

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

{showRiveRobot && <RiveRobot />}

      <Canvas camera={{ position: [0, 14, 14], fov: 50 }}>
<FollowCamera target={playerPos} facing={heading} />

        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 10, 5]} intensity={1} />

    <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[ARENA_SIZE, ARENA_SIZE]} />
          <meshStandardMaterial color="#2a2a2a" />
        </mesh>

        <mesh position={[OBSTACLE.x, 0.5, OBSTACLE.z]}>
  <boxGeometry args={[OBSTACLE.size, 1, OBSTACLE.size]} />
  <ZoneMaterial active={selfZone === OBSTACLE_ZONE} color="red" />
</mesh>

{/* Green outlines marking the 4 map quadrants */}
{ZONES.map((zone) => (
  <lineLoop key={zone.id} position={[0, 0.07, 0]}>
    <bufferGeometry>
      <bufferAttribute
        attach="attributes-position"
        args={[
          new Float32Array([
            zone.xMin, 0, zone.zMin,
            zone.xMax, 0, zone.zMin,
            zone.xMax, 0, zone.zMax,
            zone.xMin, 0, zone.zMax,
          ]),
          3,
        ]}
      />
    </bufferGeometry>
    <lineBasicMaterial
      color="#00ff44"
      linewidth={selfZone === zone.id ? 4 : 1.5}
      transparent
      opacity={selfZone === zone.id ? 1 : 0.35}
    />
  </lineLoop>
))}

{/* A soft light over each zone that switches on while you're standing in it */}
{ZONES.map((zone) => (
  <ZoneLight
    key={zone.id}
    active={selfZone === zone.id}
    position={[(zone.xMin + zone.xMax) / 2, 10, (zone.zMin + zone.zMax) / 2]}
  />
))}





<lineLoop
  position={[0, 0.05, 0]}
>
  <bufferGeometry>
    <bufferAttribute
      attach="attributes-position"
      args={[
        new Float32Array([
          BALL_BOUNDARY.minX, 0, BALL_BOUNDARY.minZ,
          BALL_BOUNDARY.maxX, 0, BALL_BOUNDARY.minZ,
          BALL_BOUNDARY.maxX, 0, BALL_BOUNDARY.maxZ,
          BALL_BOUNDARY.minX, 0, BALL_BOUNDARY.maxZ,
        ]),
        3,
      ]}
    />
  </bufferGeometry>
  <lineBasicMaterial color="red" linewidth={3} />
</lineLoop>





{ballPosition && (
  <mesh position={[ballPosition.x, ballPosition.y, ballPosition.z]} castShadow onClick={handleBallClick}>
    <sphereGeometry args={[0.5, 32, 32]} />
<ZoneMaterial active={selfZone !== null && selfZone === ballZone} color="#ff6633" glowColor="#ff6633" />
  </mesh>
)}

{STRUCTURES.map(({ ramp, platform }, i) => {
  const active = selfZone === STRUCTURE_ZONES[i];
  return (
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
        <ZoneMaterial active={active} color="#888" />
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
        <ZoneMaterial active={active} color="#666" />
      </mesh>
    </group>
  );
})}



<mesh position={[NEW_RAMP.xStart, 0, NEW_RAMP.zMin]}>
  <bufferGeometry>
    <bufferAttribute
      attach="attributes-position"
      args={[
        new Float32Array([
          0, 0, 0,
          0, 0, NEW_RAMP.zMax - NEW_RAMP.zMin,
          NEW_RAMP.xEnd - NEW_RAMP.xStart, 0, 0,
          NEW_RAMP.xEnd - NEW_RAMP.xStart, 0, NEW_RAMP.zMax - NEW_RAMP.zMin,
          NEW_RAMP.xEnd - NEW_RAMP.xStart, NEW_RAMP.height, 0,
          NEW_RAMP.xEnd - NEW_RAMP.xStart, NEW_RAMP.height, NEW_RAMP.zMax - NEW_RAMP.zMin,
        ]),
        3,
      ]}
    />

    <bufferAttribute
      attach="index"
      args={[
        new Uint16Array([
          0, 1, 2, 1, 3, 2,
          0, 2, 4, 2, 5, 4,
          0, 4, 1, 4, 5, 1,
          2, 3, 4, 3, 5, 4,
        ]),
        1,
      ]}
    />
  </bufferGeometry>

<ZoneMaterial active={selfZone === NEW_RAMP_ZONE} color="#999" side={THREE.DoubleSide} />
</mesh>


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

<DPad
  onUp={() => moveAlongHeading(1)}
  onDown={() => moveAlongHeading(-1)}
  onLeft={() => turn(1)}
  onRight={() => turn(-1)}
  runMode={runMode}
  onToggleRun={() => setRunMode((r) => !r)}
/>
      <ActionBar onAction={requestAction} />
    </div>
  );
}


function FollowCamera({ target, facing }: { target: PlayerState | null; facing: number }) {
  const { camera } = useThree();
  const currentAngle = useRef(facing);
  const hasSighted = useRef(false);

  useFrame((_, delta) => {
    if (!target) return;

    const distance = 12;
    const height = 6;

    if (!hasSighted.current) {
      hasSighted.current = true;
      currentAngle.current = facing;
      const camX = target.x - Math.sin(currentAngle.current) * distance;
      const camZ = target.z - Math.cos(currentAngle.current) * distance;
      camera.position.set(camX, target.y + height, camZ);
      camera.up.set(0, 1, 0);
      camera.lookAt(target.x, target.y, target.z);
      return;
    }

    let diff = facing - currentAngle.current;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    const smoothing = 8;
    const t = 1 - Math.exp(-smoothing * delta);
    currentAngle.current += diff * t;

    const camX = target.x - Math.sin(currentAngle.current) * distance;
    const camZ = target.z - Math.cos(currentAngle.current) * distance;

    camera.position.set(camX, target.y + height, camZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, target.y, target.z);
  });

  return null;
}



// Drop-in replacement for <meshStandardMaterial>: glows and flickers green
// while `active` is true (i.e. the local player is standing in this
// object's zone), and eases back to off when it isn't.
function ZoneMaterial({
  active,
  color,
  glowColor = "#00ff88",
  side,
}: {
  active: boolean;
  color: string;
  glowColor?: string;
  side?: THREE.Side;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    const mat = matRef.current;
    if (!mat) return;
    if (active) {
      const flicker =
        0.6 + Math.sin(clock.elapsedTime * 20) * 0.25 + (Math.random() - 0.5) * 0.2;
      mat.emissiveIntensity = Math.max(0, flicker);
    } else {
      mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, 0, 0.2);
    }
  });

  return (
    <meshStandardMaterial
      ref={matRef}
      color={color}
      emissive={glowColor}
      emissiveIntensity={0}
      side={side}
    />
  );
}

// A point light that switches on and flickers over an object while its
// zone is the active one, and fades out otherwise.
function ZoneLight({
  active,
  position,
  color = "#00ff88",
}: {
  active: boolean;
  position: [number, number, number];
  color?: string;
}) {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const light = lightRef.current;
    if (!light) return;
    if (active) {
      const flicker = 5 + Math.sin(clock.elapsedTime * 22) * 2 + (Math.random() - 0.5) * 1.5;
      light.intensity = Math.max(0, flicker);
    } else {
      light.intensity = THREE.MathUtils.lerp(light.intensity, 0, 0.2);
    }
  });

  return (
    <pointLight ref={lightRef} position={position} color={color} intensity={0} distance={60} decay={2} />
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
  onUp,
  onDown,
  onLeft,
  onRight,
  runMode,
  onToggleRun,
}: {
  onUp: () => void;
  onDown: () => void;
  onLeft: () => void;
  onRight: () => void;
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
 <button style={btnStyle} onPointerDown={onUp}>↑</button>

      <div />
   <button style={btnStyle} onPointerDown={onLeft}>↺</button>

      <button
        style={{ ...btnStyle, background: runMode ? "#4da6ff" : "rgba(255,255,255,0.15)" }}
        onPointerDown={onToggleRun}
      >
        Run
      </button>
     <button style={btnStyle} onPointerDown={onRight}>↻</button>

      <div />
     <button style={btnStyle} onPointerDown={onDown}>↓</button>
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