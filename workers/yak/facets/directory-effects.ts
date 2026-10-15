// The directory's own schedules, seeded by one start-up run a release: each
// domain's calendar job, tagged with the sweep that does it (sweep-vocab.ts),
// and the wrap pass brought forward to the release's moment, since a release
// owes every app worker its wrapper (rewrap.ts). One run and one write for all
// of them, where a run each would cost the release its pool bookkeeping five
// times over.
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { seeded, type Wake } from '../wake.ts'
import { DAILY as GIT } from '../git.ts'
import { EVERY as KILLS } from '../kills.ts'
import { DAILY as TRASH } from '../trash.ts'
import { DAILY as WRAP, forward, ROW } from '../rewrap.ts'

/** What the directory is born holding: a schedule for each sweep. */
export let schedules: Wake[] = [{
  entity: { eid: 'yak-git' },
  wake: { every: GIT, note: 'Commit yaks.app deploys nothing has committed' },
  sweep: { kind: 'git' },
}, {
  entity: { eid: 'yak-kills' },
  wake: { every: KILLS, note: 'Report what the runtime killed for its limits' },
  sweep: { kind: 'kills' },
}, {
  entity: { eid: 'yak-meter' },
  wake: { every: '@hourly', note: 'Read yaks.app usage for this month' },
  sweep: { kind: 'meter' },
}, {
  entity: { eid: 'yak-trash' },
  wake: { every: TRASH, note: 'Collect expired yaks.app trash' },
  sweep: { kind: 'trash' },
}, {
  entity: { eid: ROW },
  wake: { every: WRAP, note: "Put this release's wrapper on app workers" },
  sweep: { kind: 'wrap' },
}]

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    sweep_install: async () => {
      let now = Date.now()
      await seeded(at.graph, schedules, now)
      let [wrap] = await at.graph.read(`.entity.eid=${ROW} ?wake`)
      await at.graph.apply(forward(wrap, now))
    },
  }
}
