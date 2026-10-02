// Mouse aiming shared by the input, simulation and stage. Rays meet terrain;
// a cast keeps its landing point even when the mouse moves during the swing.
export type Point = { x: number; y: number; z: number }
export let cursor = (
  x: number,
  y: number,
  width: number,
  height: number,
  locked: boolean,
): [number, number] => locked ? [0, 0] : [x / width * 2 - 1, 1 - y / height * 2]

export let groundRay = (
  from: Point,
  ray: Point,
  height: (x: number, z: number) => number,
  far = 120,
): Point => {
  let at = (d: number) => ({
    x: from.x + ray.x * d,
    y: from.y + ray.y * d,
    z: from.z + ray.z * d,
  })
  let above = (d: number) => {
    let p = at(d)
    return p.y - height(p.x, p.z)
  }
  for (let d = 0.5; d <= far; d += 0.5) {
    if (above(d) > 0) continue
    let lo = d - 0.5, hi = d
    for (let n = 0; n < 10; n++) {
      let mid = (lo + hi) / 2
      if (above(mid) > 0) lo = mid
      else hi = mid
    }
    let p = at(hi)
    return { ...p, y: height(p.x, p.z) }
  }
  let p = at(far)
  return { ...p, y: height(p.x, p.z) }
}

export let landing = (from: Point, to: Point, reach: number): Point => {
  let d = Math.hypot(to.x - from.x, to.z - from.z)
  let k = Math.min(1, reach / (d || 1))
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    z: from.z + (to.z - from.z) * k,
  }
}

/** First entity under a ray, before the terrain; independent of array order. */
export let pickRay = <M extends { eid: string; body: Point; radius: number }>(
  marks: M[], from: Point, ray: Point, far = Infinity,
): M | null => {
  let best: M | null = null, near = far
  for (let m of marks) {
    let x = m.body.x - from.x, y = m.body.y - from.y, z = m.body.z - from.z
    let along = x * ray.x + y * ray.y + z * ray.z
    let across = x * x + y * y + z * z - along * along
    if (across > m.radius * m.radius) continue
    let hit = along - Math.sqrt(m.radius * m.radius - across)
    if (hit < 0 || hit >= near) continue
    best = m
    near = hit
  }
  return best
}
