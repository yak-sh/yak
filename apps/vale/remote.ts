// A peer's motion between relayed positions. The sender says a position and
// its velocity; the receiver advances that motion between packets, then eases
// corrections into its drawn position. A long gap stops the prediction, and
// a teleport starts a new trail instead of crossing the land on screen.

export type Motion = {
  x: number
  y: number
  z: number
  yaw: number
  vx: number
  vz: number
  vy: number
  gait: string
  at: number
}

export type Remote = {
  heard: Motion
  received: number
  x: number
  y: number
  z: number
  yaw: number
  speed: number
  ahead: number
}

let moved = (a: Motion, b: Motion) =>
  a.x != b.x || a.y != b.y || a.z != b.z || a.yaw != b.yaw ||
  a.vx != b.vx || a.vz != b.vz || a.vy != b.vy || a.gait != b.gait ||
  a.at != b.at

let start = (heard: Motion, now: number): Remote => ({
  heard,
  received: now,
  x: heard.x,
  y: heard.y,
  z: heard.z,
  yaw: heard.yaw,
  speed: 0,
  ahead: 0,
})

/** Draw the latest peer motion at `now`, advancing at most 0.8 s without a
 * packet and never correcting faster than a sprint. */
export let follow = (
  was: Remote | null,
  heard: Motion,
  now: number,
  dt: number,
): Remote => {
  if (!was || Math.hypot(heard.x - was.heard.x, heard.z - was.heard.z) > 20) {
    return start(heard, now)
  }
  let changed = moved(was.heard, heard)
  let received = changed ? now : was.received
  let lead = Math.max(0, Math.min(0.8, (now - received) / 1000))
  let moving = heard.gait != 'idle' && heard.gait != 'down'
  let x = heard.x + (moving ? heard.vx * lead : 0)
  let z = heard.z + (moving ? heard.vz * lead : 0)
  let y = heard.y + (heard.gait == 'jump' ? heard.vy * Math.min(lead, 0.2) : 0)
  let dx = x - was.x, dz = z - was.z
  let away = Math.hypot(dx, dz)
  let pace = Math.max(9.5, Math.hypot(heard.vx, heard.vz) * 1.5)
  let step = Math.min(away * (1 - Math.exp(-dt * 10)), pace * dt)
  let px = was.x + (away ? dx / away * step : 0)
  let pz = was.z + (away ? dz / away * step : 0)
  let py = was.y + (y - was.y) * (1 - Math.exp(-dt * 20))
  let yaw = was.yaw +
    Math.atan2(Math.sin(heard.yaw - was.yaw), Math.cos(heard.yaw - was.yaw)) *
      (1 - Math.exp(-dt * 12))
  let sec = Math.max(dt, 1e-3)
  let speed = was.speed + (step / sec - was.speed) * 0.25
  let ahead = was.ahead +
    (((px - was.x) * Math.sin(yaw) + (pz - was.z) * Math.cos(yaw)) / sec -
        was.ahead) * 0.25
  return {
    heard,
    received,
    x: px,
    y: py,
    z: pz,
    yaw,
    speed,
    ahead,
  }
}
