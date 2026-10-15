// Target selection and attack coverage over positions and caller-supplied sizes.
// The game supplies extra aiming reach (including any dash) as metres.
export type Target = {
  eid: string
  down: boolean
  near: number
  body: { x: number; z: number }
}
export type AimOrigin = { x: number; z: number; yaw: number }
export type TargetPoint = { x: number; z: number }
export type TargetWeapon = {
  reach: number
  arc: number
  shot?: string | boolean
}
export type TargetShape = {
  shape: 'one' | 'arc' | 'ring' | 'burst' | 'self'
  far?: number
  arc?: number
}

let off = (me: AimOrigin, m: Target) => {
  let a = Math.atan2(m.body.x - me.x, m.body.z - me.z) - me.yaw
  return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)))
}
let nearest = <M extends Target>(ms: M[]) =>
  ms.reduce<M | null>((b, m) => !b || m.near < b.near ? m : b, null)

/** The nearest target in the shortest available reach. A held target stays
 * until another's score is below 80% of its score. A chosen live target in
 * range wins even behind the origin; a point scores proximity to that point. */
export let aimOf = <M extends Target>(
  mobs: M[],
  me: AimOrigin,
  kit: TargetWeapon,
  size: (m: M) => number,
  held = '',
  extra: number[] = [],
  point?: TargetPoint,
  chosen = '',
): M | null => {
  let reach = (far: number, m: M) =>
    far + (kit.shot ? 0 : 0.7) + kit.reach + size(m)
  let explicit = mobs.find((m) => m.eid == chosen && !m.down)
  if (
    explicit &&
    [0, ...extra].some((far) => explicit.near <= reach(far, explicit))
  ) {
    return explicit
  }
  let before = mobs.filter((m) => !m.down && (point || off(me, m) <= 1.9))
  let fars = [0, ...extra].sort((a, b) => a - b)
  let far = fars.find((f) => before.some((m) => m.near <= reach(f, m)))
  if (far == null) return null
  let can = before.filter((m) => m.near <= reach(far, m))
  let score = (m: M) =>
    point
      ? Math.hypot(m.body.x - point.x, m.body.z - point.z) + m.near * 0.15
      : m.near
  let best = can.reduce((a, b) => score(a) < score(b) ? a : b)
  let was = can.find((m) => m.eid == held)
  return was && score(best) >= score(was) * 0.8 ? was : best
}

/** Live targets covered by an attack. Size is the target's full width, in
 * metres; one-target shots have extra range slack, and shooting arcs use an
 * arm's 1.4-metre reach rather than the weapon's shooting range. */
export let takenBy = <M extends Target>(
  a: TargetShape,
  mobs: M[],
  me: AimOrigin,
  kit: TargetWeapon,
  size: (m: M) => number,
  aimed: M | null,
  point?: TargetPoint,
): M[] => {
  let live = mobs.filter((m) => !m.down)
  let far = a.far ?? 0
  let reach = (m: M) =>
    (kit.shot && a.shape == 'arc' ? 1.4 : kit.reach) + far + size(m) * 0.5
  if (a.shape == 'one') {
    let m = aimed && live.find((m) => m.eid == aimed.eid)
    if (!aimed && point) {
      let dx = point.x - me.x, dz = point.z - me.z
      let d = Math.hypot(dx, dz)
      m = nearest(live.filter((m) => {
        let x = m.body.x - me.x, z = m.body.z - me.z
        let along = d ? (x * dx + z * dz) / d : 0
        let across = d ? Math.abs(x * dz - z * dx) / d : m.near
        return along >= 0 && along <= d + size(m) * 0.5 &&
          across <= size(m) * 0.5 && m.near <= reach(m)
      }))
    }
    let slack = kit.shot && m ? size(m) + 1 : 0.8
    return m && m.near <= reach(m) + slack ? [m] : []
  }
  if (a.shape == 'arc') {
    return live.filter((m) =>
      m.near <= reach(m) && (off(me, m) <= (a.arc ?? kit.arc) || m.near <= 1)
    )
  }
  if (a.shape == 'ring') {
    return live.filter((m) => m.near <= far + size(m) * 0.5)
  }
  if (a.shape == 'burst' && (aimed || point)) {
    let c = aimed?.body ?? point!
    return live.filter((m) =>
      Math.hypot(m.body.x - c.x, m.body.z - c.z) <= far + size(m) * 0.5
    )
  }
  return []
}
