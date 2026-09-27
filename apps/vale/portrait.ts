// A hero's likeness, for the Character tab (character.ts): their figure
// (figures.ts) in the colours being picked and what they wear, standing a
// little turned in the midday light, drawn by the page's own renderer as the
// world draws them, so it is them to the last shade, and copied onto a canvas
// of its own. It is drawn only when asked, and asked only when what it shows
// changed; the page draws its world over the renderer's canvas the same
// frame.
// @ts-types="npm:@types/three@^0.186.0"
import * as THREE from 'three'
import { type Build, type Dress, hero, stature } from './figures.ts'
import type { Look } from './make.ts'

/** Draw likenesses of heroes built `build` with `renderer`. */
export let portrait = (renderer: THREE.WebGLRenderer, build: Build) => {
  let scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x6b7f4a, 1.05))
  let sun = new THREE.DirectionalLight(0xfff6e2, 2.4)
  sun.position.set(2, 4, 3)
  scene.add(sun)
  let tall = stature(build)
  let eye = new THREE.PerspectiveCamera(24, 1, 0.1, 20)
  eye.position.set(0, tall * 0.62, tall * 3)
  eye.lookAt(0, tall * 0.5, 0)
  let was = new THREE.Vector4()
  let size = new THREE.Vector2()

  /** Draw a hero who looks `look`, wearing `dress`, onto `canvas`, as big
   * as it shows. */
  return (canvas: HTMLCanvasElement, look: Look, dress: Dress) => {
    let k = renderer.getPixelRatio()
    let w = Math.round(canvas.clientWidth * k)
    let h = Math.round(canvas.clientHeight * k)
    renderer.getDrawingBufferSize(size)
    if (!w || !h || w > size.x || h > size.y) return
    canvas.width = w
    canvas.height = h
    scene.background = new THREE.Color(getComputedStyle(canvas).backgroundColor)
    let f = hero(build, look, dress)
    f.root.rotation.y = -0.45
    f.animate({
      speed: 0,
      air: false,
      swing: -1,
      hurt: 0,
      roll: -1,
      down: false,
      t: 0,
    }, 0)
    scene.add(f.root)
    eye.aspect = w / h
    eye.updateProjectionMatrix()
    renderer.getViewport(was)
    renderer.setViewport(0, 0, w / k, h / k)
    renderer.setScissor(0, 0, w / k, h / k)
    renderer.setScissorTest(true)
    renderer.render(scene, eye)
    renderer.setScissorTest(false)
    renderer.setViewport(was)
    scene.remove(f.root)
    f.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    f.material.dispose()
    canvas.getContext('2d')?.drawImage(
      renderer.domElement,
      0,
      size.y - h,
      w,
      h,
      0,
      0,
      w,
      h,
    )
  }
}
