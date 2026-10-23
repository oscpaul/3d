"use client";
import { useMemo, useRef } from "react";
import { useTexture } from "@react-three/drei";
import { RigidBody, CuboidCollider, CylinderCollider } from "@react-three/rapier";
import { ActiveCollisionTypes } from "@dimforge/rapier3d-compat";
import * as THREE from "three";

const isPlayer = (other: any) => other.rigidBodyObject?.name === "player";

// One sensor cylinder with its own enter/leave counter
function Zone({
  label,
  radius,
  onEnter,
  onLeave,
}: {
  label: string;
  radius: number;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  const inside = useRef(0);
  return (
    <CylinderCollider
      args={[2, radius]}          // [halfHeight, radius]
      position={[0, 1, 0]}        // spans y = -1 to 3
      sensor
      activeCollisionTypes={ActiveCollisionTypes.ALL}
      onIntersectionEnter={({ other }) => {
        if (!isPlayer(other)) return;
        if (inside.current++ === 0) {
          console.log(`Entered ${label}`);
          onEnter?.();
        }
      }}
      onIntersectionExit={({ other }) => {
        if (!isPlayer(other)) return;
        inside.current = Math.max(0, inside.current - 1);
        if (inside.current === 0) {
          console.log(`Left ${label}`);
          onLeave?.();
        }
      }}
    />
  );
}

export default function HauntedHouse({
  name,
  position = [0, 0, 0],
  rotationY = 0,
  bigRadius = 6,
  smallRadius = 3.5,
  onEnterBig,
  onLeaveBig,
  onEnterSmall,
  onLeaveSmall,
}: {
  name: string;
  position?: [number, number, number];
  rotationY?: number;
  bigRadius?: number;
  smallRadius?: number;
  onEnterBig?: () => void;
  onLeaveBig?: () => void;
  onEnterSmall?: () => void;
  onLeaveSmall?: () => void;
}) {
  const wallMaps = useTexture({
    map: "/wall/castle_brick_broken_06_1k/castle_brick_broken_06_diff_1k.webp",
    aoMap: "/wall/castle_brick_broken_06_1k/castle_brick_broken_06_arm_1k.webp",
    normalMap: "/wall/castle_brick_broken_06_1k/castle_brick_broken_06_nor_gl_1k.webp",
  });
  const roofMaps = useTexture({
    map: "/roof/roof_slates_02_1k/roof_slates_02_diff_1k.webp",
    aoMap: "/roof/roof_slates_02_1k/roof_slates_02_arm_1k.webp",
    normalMap: "/roof/roof_slates_02_1k/roof_slates_02_nor_gl_1k.webp",
  });
  const bushMaps = useTexture({
    map: "/bush/leaves_forest_ground_1k/leaves_forest_ground_diff_1k.webp",
    aoMap: "/bush/leaves_forest_ground_1k/leaves_forest_ground_arm_1k.webp",
    normalMap: "/bush/leaves_forest_ground_1k/leaves_forest_ground_nor_gl_1k.webp",
  });
  const doorMaps = useTexture({
    map: "/door/color.webp",
    alphaMap: "/door/alpha.webp",
    aoMap: "/door/ambientOcclusion.webp",
    displacementMap: "/door/height.webp",
    normalMap: "/door/normal.webp",
    metalnessMap: "/door/metalness.webp",
    roughnessMap: "/door/roughness.webp",
  });

  // Textures are cached and shared between houses, so this is safe to repeat
  useMemo(() => {
    wallMaps.map.colorSpace = THREE.SRGBColorSpace;
    roofMaps.map.colorSpace = THREE.SRGBColorSpace;
    bushMaps.map.colorSpace = THREE.SRGBColorSpace;
    doorMaps.map.colorSpace = THREE.SRGBColorSpace;

    [roofMaps.map, roofMaps.aoMap, roofMaps.normalMap].forEach((t) => {
      t.repeat.set(3, 1);
      t.wrapS = THREE.RepeatWrapping;
    });
    [bushMaps.map, bushMaps.aoMap, bushMaps.normalMap].forEach((t) => {
      t.repeat.set(2, 1);
      t.wrapS = THREE.RepeatWrapping;
    });
  }, [wallMaps, roofMaps, bushMaps, doorMaps]);

  const bushes = [
    { s: 0.5, p: [0.8, 0.2, 2.2] },
    { s: 0.25, p: [1.4, 0.1, 2.1] },
    { s: 0.4, p: [-0.8, 0.1, 2.2] },
    { s: 0.15, p: [-1, 0.05, 2.6] },
  ];

  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={position}
      rotation={[0, rotationY, 0]}
    >
      {/* solid walls */}
      <CuboidCollider args={[2, 1.25, 2]} position={[0, 1.25, 0]} />

      {/* bigger zone, then smaller zone */}
      <Zone
        label={`${name} BIG zone`}
        radius={bigRadius}
        onEnter={onEnterBig}
        onLeave={onLeaveBig}
      />
      <Zone
        label={`${name} SMALL zone`}
        radius={smallRadius}
        onEnter={onEnterSmall}
        onLeave={onLeaveSmall}
      />

      {/* visuals */}
      <mesh position-y={1.25}>
        <boxGeometry args={[4, 2.5, 4]} />
        <meshStandardMaterial {...wallMaps} roughnessMap={wallMaps.aoMap} metalnessMap={wallMaps.aoMap} />
      </mesh>

      <mesh position-y={3.25} rotation-y={Math.PI * 0.25}>
        <coneGeometry args={[3.5, 1.5, 4]} />
        <meshStandardMaterial {...roofMaps} roughnessMap={roofMaps.aoMap} metalnessMap={roofMaps.aoMap} />
      </mesh>

      <mesh position={[0, 1, 2.01]}>
        <planeGeometry args={[2.2, 2.2, 20, 20]} />
        <meshStandardMaterial {...doorMaps} transparent displacementScale={0.15} displacementBias={-0.04} />
      </mesh>

      {bushes.map((b, i) => (
        <mesh key={i} scale={b.s} position={b.p as [number, number, number]} rotation-x={-0.75}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshStandardMaterial color="#ccffcc" {...bushMaps} roughnessMap={bushMaps.aoMap} metalnessMap={bushMaps.aoMap} />
        </mesh>
      ))}
    </RigidBody>
  );
}