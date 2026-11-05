// Where segments and boxes meet, for placing shapes and finding tangles.
// Pure.

/** A point. */
export type Spot = [number, number]

// Whether the segment a–b meets the box of half size w, h centred at c: the
// segment clipped to the box's slabs leaves something.
export let meets = (
  [ax, ay]: Spot,
  [bx, by]: Spot,
  [cx, cy]: Spot,
  w: number,
  h: number,
) => {
  let lo = 0, hi = 1
  let slabs = [[ax, bx - ax, cx - w, cx + w], [ay, by - ay, cy - h, cy + h]]
  for (let [p, d, min, max] of slabs) {
    if (!d) {
      if (p <= min || p >= max) return false
      continue
    }
    let t0 = (min - p) / d, t1 = (max - p) / d
    lo = Math.max(lo, Math.min(t0, t1))
    hi = Math.min(hi, Math.max(t0, t1))
    if (lo >= hi) return false
  }
  return true
}

// Whether segments a–b and c–d cross: at a point inside both, or at the start
// of either, so a crossing where two paths' stretches meet counts once.
export let cross = (
  [ax, ay]: Spot,
  [bx, by]: Spot,
  [cx, cy]: Spot,
  [dx, dy]: Spot,
) => {
  let d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx)
  if (!d) return false
  let t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d
  let u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d
  return t >= 0 && t < 1 && u >= 0 && u < 1
}
