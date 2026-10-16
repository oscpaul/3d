import { useCallback, useEffect, useRef, useState, type CSSProperties, useMemo, Suspense} from "react";
import { useThree } from "@react-three/fiber";


export default function OverviewCamera() {
  const { camera } = useThree();

  // Runs once, on mount only — nothing here ever updates per-frame, so
  // once it's positioned it stays exactly where it is, angle and all,
  // regardless of where the player moves.
  useEffect(() => {
    camera.position.set(0, 16, 16);
    camera.up.set(0, 1, 0);
    camera.lookAt(10, 0, 10);
  }, [camera]);

  return null;
}
