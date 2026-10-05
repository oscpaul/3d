import { useTexture } from '@react-three/drei'

export default function HauntedHouse(props) {
  const door = useTexture({
    map: '/door/color.jpg',
    alphaMap: '/door/alpha.jpg',
    aoMap: '/door/ambientOcclusion.jpg',
    displacementMap: '/door/height.jpg',
    normalMap: '/door/normal.jpg',
    metalnessMap: '/door/metalness.jpg',
    roughnessMap: '/door/roughness.jpg',
  })
  const floorAlpha = useTexture('/floor/alpha.jpg')

  return (
    <group {...props}>
      <mesh position={[0, 1, 0]}>
  <sphereGeometry args={[1, 32, 32]} />
  <meshStandardMaterial roughness={0.7} />
</mesh>
    </group>
  )
}