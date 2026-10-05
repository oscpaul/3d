"use client";

import React, { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Rive, Fit, Alignment, Layout } from "@rive-app/canvas";

// true = show the raw Rive canvas top-left so you can see if Rive is animating
const DEBUG_SHOW_CANVAS = false;

// Timelines to play. Your file has "Timeline 1" and "Timeline 2".
const ANIMATIONS = ["Timeline 1", "Timeline 2"];

export default function Flag3D() {
  const { riveCanvas, canvasTexture } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;

    Object.assign(
      canvas.style,
      DEBUG_SHOW_CANVAS
        ? {
            position: "fixed",
            left: "8px",
            top: "8px",
            width: "200px",
            height: "200px",
            zIndex: "9999",
            background: "#444",
          }
        : {
            position: "fixed",
            left: "0",
            top: "0",
            width: "512px",
            height: "512px",
            opacity: "0",
            pointerEvents: "none",
            zIndex: "-1",
          }
    );
    document.body.appendChild(canvas);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    return { riveCanvas: canvas, canvasTexture: texture };
  }, []);

  useEffect(() => {
    Rive.suppressDeprecationWarnings = ["animations-param", "animation-names"];
    let cancelled = false;

    const flagRive = new Rive({
      src: "/untitled.riv",
      canvas: riveCanvas,
      autoplay: true,
      animations: ANIMATIONS,
      layout: new Layout({ fit: Fit.Contain, alignment: Alignment.Center }),
      onLoad: () => {
        if (cancelled) return;
        console.log("Rive loaded. Animations:", flagRive.animationNames);
        flagRive.resizeDrawingSurfaceToCanvas();
      },
      onLoadError: (err) => console.error("Rive load error:", err),
    });

    return () => {
      cancelled = true;
      flagRive.cleanup();
    };
  }, [riveCanvas]);

  useEffect(() => {
    return () => riveCanvas.remove();
  }, [riveCanvas]);

  // Re-upload the Rive canvas to the GPU every frame
  useFrame(() => {
    canvasTexture.needsUpdate = true;
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Pole */}
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 4, 16]} />
        <meshStandardMaterial color="#888888" roughness={0.3} metalness={0.8} />
      </mesh>

      {/* Flag */}
      <mesh position={[1, 3.2, 0.01]}>
        <planeGeometry args={[2, 1.5]} />
        <meshBasicMaterial
          map={canvasTexture}
          side={THREE.DoubleSide}
          transparent
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
