export type Landmark = { name: string; coordinates: [number, number] };

const LANDMARKS: Landmark[] = [
  { name: "Central Park, New York", coordinates: [-73.9654, 40.7829] },
  { name: "Shibuya Crossing, Tokyo", coordinates: [139.7006, 35.6595] },
  { name: "Eiffel Tower Grid, Paris", coordinates: [2.2945, 48.8584] },
  { name: "Colosseum Plaza, Rome", coordinates: [12.4922, 41.8902] },
  { name: "Pyramids Plateau, Cairo", coordinates: [31.1342, 29.9792] },
  { name: "Opera House Harbor, Sydney", coordinates: [151.2153, -33.8568] },
];

export function pickRandomLandmark(): Landmark {
  const l = LANDMARKS[Math.floor(Math.random() * LANDMARKS.length)];
  return { ...l, coordinates: [...l.coordinates] as [number, number] };
}