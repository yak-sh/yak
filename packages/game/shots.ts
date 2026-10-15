// Shot flight and arrival timing. The caller chooses hits when loosing a shot
// and applies them when due; this module knows neither damage nor entities.
export type ShotPoint = [number, number, number]
export type ShotFlight = { from: ShotPoint; to: ShotPoint; ms: number }

/** Horizontal flight at speed metres/second. The first shot goes straight;
 * later shots scatter uniformly over a disc and arrive 7% later per shot.
 * `ms` is the hit delay, shared by all hits decided at release. */
export let shotFlight = (
  from: ShotPoint,
  to: ShotPoint,
  speed: number,
  count = 1,
  spread = 0,
  random: () => number = Math.random,
): { ms: number; shots: ShotFlight[] } => {
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError('speed must be positive')
  }
  let ms = Math.hypot(to[0] - from[0], to[2] - from[2]) / speed * 1000
  let shots: ShotFlight[] = []
  for (let i = 0; i < count; i++) {
    let r = i ? spread * Math.sqrt(random()) : 0
    let t = random() * Math.PI * 2
    shots.push({
      from,
      to: [to[0] + Math.cos(t) * r, to[1], to[2] + Math.sin(t) * r],
      ms: ms * (1 + i * 0.07),
    })
  }
  return { ms, shots }
}

/** Split scheduled hits without changing them or their order. The caller
 * consumes due hits even if their target has disappeared or is already down. */
export let arrivals = <S extends { lands: number }>(
  shots: readonly S[],
  now: number,
): { due: S[]; pending: S[] } => {
  let due: S[] = [], pending: S[] = []
  for (let shot of shots) (shot.lands > now ? pending : due).push(shot)
  return { due, pending }
}
