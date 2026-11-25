// The directory's own schedules, seeded by one start-up run a release: each
// domain's calendar job, tagged with the sweep that does it (sweep-vocab.ts),
// and the wrap pass brought forward to the release's moment, since a release
// owes every app worker its wrapper (rewrap.ts). One run and one write for all
// of them, where a run each would cost the release its pool bookkeeping five
// times over. And the month an invite gives once its invitee builds their
// first app (reward.ts).
import { derivedEid } from '@yaks/graph/identity'
import type { Taken } from '@yaks/graph'
import { purgeEntities } from '@yaks/graph/trash'
import { line } from '@yaks/query'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'
import { seeded, type Wake } from '../wake.ts'
import { DAILY as GIT } from '../git.ts'
import { EVERY as KILLS } from '../kills.ts'
import { DAILY as TRASH } from '../trash.ts'
import { DAILY as WRAP, forward, ROW } from '../rewrap.ts'
import { directoryRows, type Row } from '../directory.ts'
import { rewarding } from '../reward.ts'
import { plans } from '../payments.ts'
import { carry } from '../support-reply.ts'
import type { Env } from '../env.ts'
import { retired } from '../file-retirement.ts'
import { r2RawObjects } from '../lib/objects.ts'
import { drawingIcons } from './app-icons.ts'
import { drawingSplashes } from './app-splash.ts'
import {
  type Retirement,
  retireOrphans,
} from '@yaks/connections/mcp-retirement'
import { letterRows } from '../mail.ts'
import { vaultOf } from '../vault.ts'

/** What the directory is born holding: a schedule for each sweep. */
export let schedules: Wake[] = [{
  entity: { eid: derivedEid('domain renewal sweep') },
  wake: { every: '@daily', note: 'Prepare annual domain renewals' },
  sweep: { kind: 'domains' },
}, {
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
  entity: { eid: 'yak-refusals' },
  wake: {
    every: '@hourly',
    note: "Report the hour's tool refusals to TaskMaster",
  },
  sweep: { kind: 'refusals' },
}, {
  entity: { eid: 'yak-trash' },
  wake: { every: TRASH, note: 'Collect expired yaks.app trash' },
  sweep: { kind: 'trash' },
}, {
  entity: { eid: ROW },
  wake: { every: WRAP, note: "Put this release's wrapper on app workers" },
  sweep: { kind: 'wrap' },
}]

/** The directory's own decisions over its store's graph, as its door answers
 * them, for a handler that runs inside it. */
export let inStore = (at: Options['store']) =>
  directoryRows({
    query: async (q) =>
      (await at.graph.read(q) as Row[]).map((row) => ({
        ...row,
        policy: { revision: 0 },
      })),
    apply: async (entities) =>
      await at.graph.apply(entities, { trusted: true }),
  })

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  let dir = () => inStore(at)
  return {
    ...drawingIcons(at, dir()),
    ...drawingSplashes(at, dir()),
    delete_retired_files: async (event, _tx, _write, attempt) => {
      if (!at.env.BLOBS) return
      await retired(
        at.graph,
        dir(),
        r2RawObjects(at.env.BLOBS),
        event.entity.eid,
        attempt,
      )
    },
    sweep_install: async () => {
      let now = Date.now()
      await seeded(at.graph, schedules, now)
      let [wrap] = await at.graph.read(line`.entity.eid=${ROW} ?wake`)
      await at.graph.apply(forward(wrap, now))
    },
    collect_mcp_orphans: () => retireOrphans(at.graph),
    erase_mcp_credentials: async ({ entity }, tx, write) => {
      let [row] = await tx.get([entity.eid], ['mcp_retirement'])
      let on = row?.mcp_retirement as Retirement | undefined
      if (!on) return
      await vaultOf(at.env).erase(on.secrets)
      await purgeEntities(at.graph, on.rows)
      await write([
        ...on.notices.flatMap((letter) => letterRows(letter, at.env)),
        { entity, tombstone: {} },
      ])
    },
    // Carried until every place it goes took it, as trash is (trash-effects.ts):
    // a reply nobody hears is the one thing a support thread is for.
    ...(at.env.BUILDER && at.env.WIRE
      ? {
        chat_dm_arrived: async (event) => {
          let { carryDirect } = await import('../chat.ts')
          await carryDirect(at.env as Env, at.graph, event.entity.eid)
        },
        chat_linked: async (event) => {
          let { linkedNow } = await import('../chat.ts')
          await linkedNow(at.env as Env, at.graph, event.entity.eid)
        },
        support_reply: async (event, _tx, _write, attempt) => {
          try {
            await carry(
              at.env as Env,
              {
                query: async (q) => await at.graph.read(q as Taken),
                apply: async (rows) =>
                  await at.graph.apply(rows, { trusted: true }),
              },
              event.entity.eid,
            )
          } catch (error) {
            await attempt?.progressed()
            throw Object.assign(
              error instanceof Error ? error : new Error(String(error)),
              { retry: { after: 60000 } },
            )
          }
        },
      } satisfies Handlers
      : {}),
    reward_referral: async (event) =>
      await rewarding(
        dir(),
        await plans(at.env),
        event.entity.eid,
        new Date(at.env.CLOCK?.now() ?? Date.now()).toISOString(),
      ),
  }
}
