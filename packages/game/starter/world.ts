// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'

export let trees = [
  [-7, -5],
  [-4, -8],
  [3, -6],
  [7, -8],
  [7, -1],
  [5, 5],
  [-6, 4],
]

let mesh = (shape: THREE.BufferGeometry, color: number) =>
  new THREE.Mesh(
    shape,
    new THREE.MeshStandardMaterial({ color, flatShading: true }),
  )

export let field = (tree: () => THREE.Object3D): THREE.Group => {
  let world = new THREE.Group()
  let ground = mesh(new THREE.BoxGeometry(24, 1, 24), 0x729851)
  ground.position.y = -0.5
  world.add(ground)
  for (let [x, z] of trees) {
    let item = tree()
    item.position.set(x, 0, z)
    world.add(item)
  }
  let marker = mesh(new THREE.OctahedronGeometry(1), 0xc47e49)
  marker.scale.set(0.7, 1.5, 0.7)
  marker.position.set(0, 1.2, -7)
  world.add(marker)
  return world
}

export let pine = (): THREE.Group => {
  let tree = new THREE.Group()
  let trunk = mesh(new THREE.CylinderGeometry(0.13, 0.2, 1.2, 5), 0x79583d)
  let crown = mesh(new THREE.ConeGeometry(0.85, 2.3, 5), 0x315f49)
  trunk.position.y = 0.6
  crown.position.y = 1.9
  tree.add(trunk, crown)
  return tree
}

export let traveler = (): THREE.Group => {
  let actor = new THREE.Group()
  let coat = mesh(new THREE.CylinderGeometry(0.31, 0.43, 0.73, 6), 0x24496b)
  let head = mesh(new THREE.IcosahedronGeometry(0.28), 0xffbc80)
  let scarf = mesh(new THREE.BoxGeometry(0.32, 0.16, 0.16), 0xe57447)
  coat.position.y = 0.43
  head.position.y = 1
  scarf.position.set(0, 0.71, -0.33)
  actor.add(coat, head, scarf)
  return actor
}
