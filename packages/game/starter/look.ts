// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { aim, type Cam, type CameraIntent, steer } from '@yaks/stage/cam'
import { keepUp, quality, renderer } from '@yaks/stage/render'

export type Pose = { x: number; y: number; z: number; yaw: number }

// The app supplies the world and actor. The look owns their GPU lifetime.
export let look = (
  canvas: HTMLCanvasElement,
  world: THREE.Object3D,
  actor: THREE.Object3D,
  blocked: (point: THREE.Vector3) => boolean = () => false,
) => {
  let scene = new THREE.Scene()
  scene.background = new THREE.Color(0xb6d8db)
  scene.fog = new THREE.Fog(0xb6d8db, 24, 64)
  let camera = new THREE.PerspectiveCamera(44, 1, 0.1, 70)
  let density = Math.min(devicePixelRatio || 1, 2)
  let gpu = renderer(canvas, 1, 1, density)
  let sky = new THREE.HemisphereLight(0xe3f4ff, 0x7c6252, 2)
  let sun = new THREE.DirectionalLight(0xffe4ba, 2.8)
  sun.position.set(-9, 14, 7)
  scene.add(sky, sun, world, actor)
  // A slow phone or a software-rendered browser sheds pixels, then shadows.
  let ease = keepUp(quality(gpu, sun, scene, density))

  let cam: Cam = {
    yaw: 0,
    pitch: 0.57,
    dist: 9,
    reach: 9,
    x: 0,
    y: 0,
    z: 0,
    shake: 0,
    snap: false,
    orbiting: false,
    lift: 0,
  }
  let target = new THREE.Vector3()
  let width = 0, height = 0
  let ray = new THREE.Raycaster()
  let ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  return {
    // `elapsed` is the frame's uncapped wall time, which paces quality.
    draw(pose: Pose, input: CameraIntent, dt: number, elapsed: number) {
      let w = canvas.clientWidth, h = canvas.clientHeight
      if (!w || !h) return
      if (w !== width || h !== height) {
        width = w
        height = h
        gpu.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      actor.position.set(pose.x, pose.y, pose.z)
      actor.rotation.y = -pose.yaw
      steer(cam, input, pose.yaw, dt)
      target.set(pose.x, pose.y + 0.8, pose.z)
      aim(cam, camera, target, blocked, dt)
      gpu.render(scene, camera)
      ease(elapsed)
    },
    pick(x: number, y: number) {
      let rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height) return null
      ray.setFromCamera(
        new THREE.Vector2(
          2 * (x - rect.left) / rect.width - 1,
          1 - 2 * (y - rect.top) / rect.height,
        ),
        camera,
      )
      return ray.ray.intersectPlane(ground, new THREE.Vector3())
    },
    dispose() {
      let resources = new Set<THREE.BufferGeometry | THREE.Material>()
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        resources.add(object.geometry)
        for (let material of [object.material].flat()) resources.add(material)
      })
      for (let resource of resources) resource.dispose()
      gpu.dispose()
    },
  }
}
