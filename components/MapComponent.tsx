'use client';
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { createMovableLayer } from './MovableLayer';
import type { Landmark } from './landmarks';
import 'mapbox-gl/dist/mapbox-gl.css';



type Props = {
  location: Landmark | null;          // null = popup hidden
  onClose?: () => void;
  width?: number | string;     // ← was number
  height?: number | string;    // ← was number
  style?: React.CSSProperties;        // override position, e.g. { top: 16, left: 16 }
};

export default function MapComponent({
  location,
  onClose,
  width = "40vw",
  height = "40vh",
  style,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
const coordinatesRef = useRef<[number, number] | undefined>(undefined);
  const [map, setMap] = useState<mapboxgl.Map | null>(null);

  // Create the map once
  useEffect(() => {
    if (!containerRef.current) return;

    const m = new mapboxgl.Map({
      container: containerRef.current,
      center: [0, 0],
      zoom: 1,
      pitch: 60,
      style: 'mapbox://styles/mapbox/light-v11',
    });

    m.on('style.load', () => {
      m.addLayer({
        id: '3d-buildings',
        source: 'composite',
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#ddd',
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'min_height'],
          'fill-extrusion-opacity': 0.5,
        },
      });
      m.addLayer(createMovableLayer(coordinatesRef));
      setMap(m);
    });

    return () => m.remove();
  }, []);

  // React to the location prop
  useEffect(() => {
    if (!map) return;

    if (!location) {
      coordinatesRef.current = undefined; // tells the 3D layer to stop drawing
      return;
    }

    coordinatesRef.current = location.coordinates;
    map.resize(); // make sure the canvas matches the popup size
    map.jumpTo({
      center: location.coordinates,
      zoom: 16.2,
      pitch: 58,
      bearing: Math.random() * 360,
    });
  }, [map, location]);

  const active = !!location;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: "0%",
        width,
        height,
        zIndex: 20,
        borderRadius: 12,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 8px 24px rgba(0,0,0,.35)',
        display: 'flex',
        flexDirection: 'column',
        // hide with visibility (not display:none) so Mapbox keeps its size
        visibility: active ? 'visible' : 'hidden',
        opacity: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
        transition: 'opacity 0.3s ease-in-out',
        ...style,
      }}
    >
      {/* Title bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: '#1f2937',
          color: '#fff',
          fontSize: 13,
          fontWeight: 'bold',
          flexShrink: 0,
        }}
      >
        <span>📍 {location?.name ?? ''}</span>
        {onClose && (
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
            aria-label="Close map"
          >
            ×
          </button>
        )}
      </div>

      {/* Map area */}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
