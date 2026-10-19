import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createMovableLayer(
  coordinatesRef: { current: [number, number] | undefined }
): mapboxgl.CustomLayerInterface {
  // Closure state instead of `this.*`
  let camera: THREE.Camera | null = null;
  let scene: THREE.Scene | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let mapRef: mapboxgl.Map | null = null;

  return {
    id: 'r3f-movable-tower-layer',
    type: 'custom',
    renderingMode: '3d',

    onAdd(map, gl) {
      mapRef = map;
      camera = new THREE.Camera();
      scene = new THREE.Scene();

      scene.add(new THREE.AmbientLight(0xffffff, 1.7));

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(0, -70, 100).normalize();
      scene.add(directionalLight);

      const loader = new GLTFLoader();
      loader.load('/tower.glb', (gltf) => {
        if (!scene) return;
        scene.add(gltf.scene);
        map.triggerRepaint();
      });

      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
    },

    render(gl, matrix) {
      if (!renderer || !camera || !scene || !mapRef) return;

      const activeCoords = coordinatesRef.current;
      if (!activeCoords || (activeCoords[0] === 0 && activeCoords[1] === 0)) return;

      const rotationX = new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(1, 0, 0),
        Math.PI / 2
      );
      const m = mapboxgl.MercatorCoordinate.fromLngLat(activeCoords, 0);
      const l = m.meterInMercatorCoordinateUnits();

      const scale = new THREE.Matrix4().makeScale(l * 0.9, l * 0.9, l * 1.4);
      const translation = new THREE.Matrix4().makeTranslation(m.x, m.y, m.z);

      const lMatrix = new THREE.Matrix4()
        .fromArray(matrix)
        .multiply(translation)
        .multiply(rotationX)
        .multiply(scale);

      renderer.resetState();
      camera.projectionMatrix = lMatrix;
      renderer.render(scene, camera);
      mapRef.triggerRepaint();
    },
  };
}