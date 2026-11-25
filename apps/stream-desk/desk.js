// The desk: the page on the computer running OBS. It is the one place that
// reaches OBS (a phone's https page may not open ws:// to another machine),
// so every phone's press is a cue in the store, and the desk plays each into
// OBS and marks it aired or missed.
import { BEAT, due, idOf, shots, steps } from './model.js'

let sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Plays every cue not yet played, oldest first, and marks each. `scene()`
 * is the scene OBS has on air. */
export let tend = async (
  { query, apply, obs, scene, now = Date.now(), wait = sleep },
) => {
  let { play, stale } = due(
    await query('.cue&!aired&!missed&?created'),
    now,
  )
  let all = shots(await query('.shot&?doc'))
  if (stale.length) {
    await apply(stale.map((c) => ({
      entity: c.entity,
      missed: { reason: 'Pressed while the desk was away.' },
    })))
  }
  for (let c of play) {
    let shot = all.find((s) => s.entity.eid == idOf(c.cue.shot))
    try {
      for (let step of steps(c.cue, shot, scene())) {
        await (step.wait ? wait(step.wait) : obs.call(...step))
      }
      await apply({ entity: c.entity, aired: { at: new Date().toISOString() } })
    } catch (e) {
      await apply({ entity: c.entity, missed: { reason: e.message } })
    }
  }
}

/** Runs the desk on a connected OBS: follows the scene on air, tells every
 * page through `relay({scene, scenes, seen})` when it changes and every
 * `BEAT`, and answers `kick()`, called on each new cue, by tending the cues,
 * one pass at a time. `stop()` ends the beat. */
export let desk = async ({ query, apply, obs, relay, wait = sleep }) => {
  let list = await obs.call('GetSceneList')
  let scenes = list.scenes.map((s) => s.sceneName).toReversed()
  let scene = list.currentProgramSceneName
  let told = () => relay({ scene, scenes, seen: new Date().toISOString() })
  obs.on((type, data) => {
    if (type == 'CurrentProgramSceneChanged') {
      scene = data.sceneName
      told()
    } else if (type == 'SceneListChanged') {
      scenes = data.scenes.map((s) => s.sceneName).toReversed()
      told()
    }
  })
  await told()
  let beat = setInterval(told, BEAT)
  let running = null
  let again = false
  let kick = () => {
    if (running) return again = true, running
    running = tend({ query, apply, obs, scene: () => scene, wait })
      .finally(() => {
        running = null
        if (again) again = false, kick()
      })
    return running
  }
  return { kick, scene: () => scene, stop: () => clearInterval(beat) }
}
