import mapboxgl from 'mapbox-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export function createMovableLayer(
  coordinatesRef: React.MutableRefObject<[number, number] | undefined>
): mapboxgl.CustomLayerInterface {
  return {
    id: 'r3f-movable-tower-layer',
    type: 'custom',
    renderingMode: '3d',
    onAdd: function (map, gl) {
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();

      const ambientLight = new THREE.AmbientLight(0xffffff, 1.7);
      this.scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
      directionalLight.position.set(0, -70, 100).normalize();
      this.scene.add(directionalLight);

      const loader = new GLTFLoader();
      loader.load('/tower.glb', (gltf) => {
        if (!this.scene) return;
        this.scene.add(gltf.scene);
        map.triggerRepaint();
      });

      this.map = map;
      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true
      });
      this.renderer.autoClear = false;
    },
    render: function (gl, matrix) {
      const activeCoords = coordinatesRef.current;
      if (!activeCoords || (activeCoords[0] === 0 && activeCoords[1] === 0)) return;

      const rotationX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const m = mapboxgl.MercatorCoordinate.fromLngLat(activeCoords, 0);
      const l = m.meterInMercatorCoordinateUnits();
      
      const scale = new THREE.Matrix4().makeScale(l * 0.9, l * 0.9, l * 1.4);
      const translation = new THREE.Matrix4().makeTranslation(m.x, m.y, m.z);

      const lMatrix = new THREE.Matrix4()
        .fromArray(matrix)
        .multiply(translation)
        .multiply(rotationX)
        .multiply(scale);

      this.renderer.resetState();
      this.camera.projectionMatrix = lMatrix;
      this.renderer.render(this.scene, this.camera);
      this.map.triggerRepaint();
    }
  };
}
