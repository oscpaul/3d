"use client";

import { useEffect, useMemo, useRef } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
// Ships with the "three" package itself — no extra install needed.
// Required because multiple robot instances can't share one skeleton;
// each player needs its own cloned bones or they'd all mirror one pose.
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

const MODEL_URL = "/models/RobotExpressive.glb";

// Looping "state" clips — exactly one is ever active. Movement always wins
// over a manually-selected pose (Dance/Sitting/Standing/Death).
const LOOP_STATES = new Set([
  "Idle",
  "Walking",
  "Running",
  "Dance",
  "Death",
  "Sitting",
  "Standing",
]);

// One-shot gesture clips: play once, then fall back to whatever state
// should be active. Values are approximate clip durations in ms.
const ONE_SHOT_EMOTES: Record<string, number> = {
  Jump: 1000,
  Yes: 1200,
  No: 1200,
  Wave: 1000,
  Punch: 900,
  ThumbsUp: 1800,
};

export type RobotHandle = {
  /** Call whenever a validated move happens for this player. */
  notifyMove: (running: boolean) => void;
  /** Call when a state or gesture button fires for this player. */
  notifyAction: (action: string) => void;
};

type Props = {
  position: [number, number, number];
  facing: number; // radians — target Y rotation, updated on each move
  color?: string;
  onReady?: (handle: RobotHandle) => void;
};

export default function Robot({ position, facing, color, onReady }: Props) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(MODEL_URL);

  const clonedScene = useMemo(() => cloneSkeleton(scene), [scene]);
  const { actions } = useAnimations(animations, group);

  // Give each player their own material instance so tinting one robot
  // doesn't recolor every player sharing the source asset.
  useEffect(() => {
    if (!color) return;
    clonedScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const base = (
        Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      ) as THREE.MeshStandardMaterial;
      const tinted = base.clone();
      tinted.color = new THREE.Color(color);
      mesh.material = tinted;
    });
  }, [clonedScene, color]);

  // ---- Local animation state machine ----
  // currentClip/oneShotUntil/selectedState/movingUntil are refs (not React
  // state) because they update every frame and don't need re-renders.
  const currentClip = useRef("Idle");
  const oneShotUntil = useRef(0);
  const selectedState = useRef("Idle");
  const movingUntil = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    actions["Idle"]?.reset().play();
    currentClip.current = "Idle";
  }, [actions]);

  function playClip(name: string, fade = 0.25) {
    const next = actions[name];
    if (!next || currentClip.current === name) return;
    const prev = actions[currentClip.current];
    next.reset().fadeIn(fade).play();
    prev?.fadeOut(fade);
    currentClip.current = name;
  }

  useEffect(() => {
    if (!onReady) return;
    onReady({
      notifyMove: (running) => {
        runningRef.current = running;
        movingUntil.current = performance.now() + 350; // "still walking" window
        selectedState.current = "Idle"; // moving cancels any seated/dance pose
      },
      notifyAction: (action) => {
        if (ONE_SHOT_EMOTES[action] !== undefined) {
          oneShotUntil.current = performance.now() + ONE_SHOT_EMOTES[action];
          playClip(action, 0.15);
        } else if (LOOP_STATES.has(action)) {
          selectedState.current = action;
        }
      },
    });
    // Intentionally only re-registers if the animations map changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions]);

  useFrame((_, delta) => {
    const now = performance.now();

    if (oneShotUntil.current <= now) {
      const base =
        movingUntil.current > now
          ? runningRef.current
            ? "Running"
            : "Walking"
          : selectedState.current;
      playClip(base);
    }

    // Smoothly turn to face the last movement direction (shortest-path lerp).
    if (group.current) {
      const current = group.current.rotation.y;
      const diff = Math.atan2(Math.sin(facing - current), Math.cos(facing - current));
      group.current.rotation.y = current + diff * Math.min(1, delta * 10);
    }
  });

  return (
    <group ref={group} position={position}>
      <primitive object={clonedScene} scale={0.6} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
