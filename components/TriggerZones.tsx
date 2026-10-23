"use client";
import { useCallback, useEffect, useRef, useState, type CSSProperties, useMemo, Suspense} from "react";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import { Canvas } from "@react-three/fiber";
import { Physics, RigidBody, CuboidCollider } from "@react-three/rapier";
import { Box } from "@react-three/drei";
const SQ = 2;        // square half-size (4 x 4)
const RW = .5;      // rectangle half-thickness (x)
const RL = 2;        // rectangle half-length (z), same as the square's edge
const AISLE = 6;     // distance from aisle centre (x = 0) to the square centres
const COUNT = 5;     // squares per side
const STEP = 6;      // spacing along z (must be >= 2 * SQ)

const items: { pos: [number, number, number]; side: number }[] = [];
const OFFSET_X = -10;
const OFFSET_Z = 10;
const isPlayer = (other: any) => other.rigidBodyObject?.name === "player";



for (const side of [-1, 1]) {
  for (let i = 0; i < COUNT; i++) {
    items.push({
      pos: [side * AISLE + OFFSET_X, 0.5, i * STEP + OFFSET_Z],
      side,
    });
  }
}

function Zone({
  name,
  pos,
  side,
  onEnter,
  onLeave,
}: {
  name: string;
  pos: [number, number, number];
  side: number;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const inside = useRef(0);

  return (
    <RigidBody type="fixed" colliders={false} position={pos}>
      {/* the square */}
      <CuboidCollider args={[SQ, 0.5, SQ]} 
    sensor
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

      {/* sensor rectangle */}
      <CuboidCollider
        args={[RW, 0.5, RL]}
        position={[-side * (SQ + RW), 0, 0]}
    
        
      />
    </RigidBody>
  );
}

export default function TriggerZones() {
  return (
    <>
      {items.map(({ pos, side }, i) => (
        <Zone key={i} name={`rect-${i}`} pos={pos} side={side} />
      ))}
    </>
  );
}