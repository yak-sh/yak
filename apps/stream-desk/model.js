// What the desk does with the store's rows, kept apart from the page and the
// socket: which cues to play, what each sends OBS, and what is on air.
import { ptz } from './obs.js'

/** The one entity the desk writes what OBS shows on. */
export let DESK = 'b7d64f0e-3c2a-4f8e-9d17-5e0c4a9b2f61'

/** A cue older than this when the desk first sees it is not played: the
 * moment it was pressed for has passed. */
export let STALE = 30_000

/** How long a zoom step runs the camera's zoom motor. */
export let NUDGE = 400

/** How long a camera is given to reach its preset before its scene is cut
 * to, when the cut changes the scene. */
export let SETTLE = 1500

/** How often the desk says it is still there, and how long a desk not
 * heard from is taken to be away. */
export let BEAT = 30_000
export let AWAY = 75_000

/** The desk's own row while it is there, else null. */
export let present = (rows, now) => {
  let desk = rows.find((r) => r.entity.eid == DESK)?.desk
  return desk?.seen && now - Date.parse(desk.seen) <= AWAY ? desk : null
}

/** A reference as a read speaks it: the eid, or `{eid, name}`. */
export let idOf = (v) => typeof v == 'string' ? v : v?.eid ?? null

/** The shots in button order. */
export let shots = (rows) =>
  rows.filter((r) => r.shot).toSorted((a, b) =>
    (a.shot.n ?? 0) - (b.shot.n ?? 0)
  )

/** The cues not yet aired or missed, split into those to play, oldest first,
 * and those pressed too long ago (`STALE`). */
export let due = (cues, now) => {
  let open = cues.filter((c) => !c.aired && !c.missed)
    .toSorted((a, b) => a.created.at.localeCompare(b.created.at))
  let old = (c) => now - Date.parse(c.created.at) > STALE
  return { play: open.filter((c) => !old(c)), stale: open.filter(old) }
}

/** What playing a cue sends OBS, in order: `[requestType, requestData]`, or
 * `{wait}` milliseconds. A preset is recalled before its scene is cut to, so
 * the camera moves while it is off air. */
export let steps = (cue, shot, onAir) => {
  if (cue.zoom) {
    return [
      ptz('ptz_move', { zoom: cue.zoom * 0.5 }),
      { wait: NUDGE },
      ptz(
        'ptz_move',
        { zoom: 0 },
      ),
    ]
  }
  if (!shot) return []
  let { scene, preset } = shot.shot
  let cut = scene && scene != onAir
  return [
    ...preset ? [ptz('ptz_preset_recall', { id: preset })] : [],
    ...preset && cut ? [{ wait: SETTLE }] : [],
    ...cut ? [['SetCurrentProgramScene', { sceneName: scene }]] : [],
  ]
}

/** The shot on air: the newest aired shot cue whose scene OBS shows now, so
 * a cut made in OBS itself lights no button. */
export let onAir = (cues, all, scene) => {
  let scenes = new Map(all.map((s) => [s.entity.eid, s.shot.scene]))
  return cues.filter((c) => c.aired && scenes.get(idOf(c.cue.shot)) == scene)
    .toSorted((a, b) => b.aired.at.localeCompare(a.aired.at))
    .map((c) => idOf(c.cue.shot))[0] ?? null
}
