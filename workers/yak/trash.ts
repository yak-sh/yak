// The trash's date, stamped where the word is written rather than computed by
// whoever asked for it (T-34619). Deleting an app or a space writes one word on
// its row — `trashed` (erase.ts, T-34430/T-34431) — and the thirty days are
// counted off the `at` in it, so the ask and the clock were both the caller's:
// every door that trashes anything had to remember to date its own mark.
//
// It is a rule instead: `*trashed, !trashed.at` says what it needs (a row
// wearing the word — the write set says so — with no date on it) and what it
// does about it (write one), while `#Actor, #Now` name the two singletons the
// tick hands it. The store that holds the row runs it in the `stamp` phase
// beside
// `created` and `updated` — which is what those two are as well (@yaks/graph
// rules.ts). So a caller asks for the trash by writing `trashed: {}`, the date
// and the byline are the store's exactly as a birth's are, and a mark that is
// already dated is left alone however often it is written again.
//
// The daily wake belongs here too: its `fired` write runs collection after
// the graph commits. erase.ts reaches the host modules, so the effect loads
// it when it runs, after the plugin list has been composed.
//
// `trashed` is the directory's word (vocab.ts `platformDoc`), so this rule is
// inert in an app's store, which speaks no such component.
import type { Bundle, ReadTx } from '@yaks/graph'
import { storeOf } from './door.ts'
import { KERNEL } from './meta.ts'
import { appOf, spaceOf, storeName } from './directory.ts'
import type { Namespace } from './door.ts'
import type { Plugin } from './plugin.ts'
import type { Env } from './env.ts'
import { reporting } from './wake.ts'

/** The trash's calendar cadence; Cron Triggers only supply its heartbeat. */
export let DAILY = '20 4 * * *'

// Read the present on every attempt, including a restore that overtook a
// failed trash delivery. Space trash never changes an app's own trash mark.
let stateOf = async (tx: ReadTx, eid: string) => {
  let [row] = await tx.get([eid])
  if (!row?.app || row.tombstone) return null
  let app = appOf(row as Parameters<typeof appOf>[0])
  let [parent] = await tx.get([app.space])
  if (!parent?.space || parent.tombstone) return null
  let space = spaceOf(parent as Parameters<typeof spaceOf>[0])
  return {
    name: storeName(space, app),
    asleep: !!(row.trashed || parent.trashed),
  }
}

let delivered = async (ns: Namespace, tx: ReadTx, eid: string) => {
  // A concurrent restore/trash can commit while the external call is in
  // flight. Before settling, deliver any newer state too. If this process
  // dies between delivery and settlement, the durable run reads it afresh.
  for (;;) {
    let state = await stateOf(tx, eid)
    if (!state) return
    let door = storeOf(ns, state.name)
    let response = await door(
      state.asleep ? '/dormant' : '/revive',
      { method: 'POST' },
      KERNEL,
    )
    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`)
    }
    await response.body?.cancel()
    let now = await stateOf(tx, eid)
    if (!now || now.name == state.name && now.asleep == state.asleep) return
  }
}

/**
 * The trash mark, dated and signed by the store: `at` is the batch's own
 * instant and `by` is whoever the platform vouched for — the two words the
 * `created` stamp writes, for the same reason. Each is the resource written
 * straight into the property it stands for, so a mark nobody signed is dated
 * and unsigned rather than dated and blank. A batch carrying its own `at` — a
 * row stood up in the past by a test, a mark a migration carries across — does
 * not match at all.
 */
export let trashPlugin: Plugin = {
  name: 'yak/trash',
  vocab: [{
    $defs: {
      notify_trash: {
        effect: true,
        created: ['trashed'],
        changed: ['trashed'],
        removed: ['trashed'],
        active: '(.app|.space)',
        // Cover marks written before durable notification was installed. Only
        // the directory reconciles these once on restart; apps never poll.
        sweep: '(.app|.space) .trashed',
        description: 'deliver current app or space dormancy until acknowledged',
      },
    },
  }],
  effects: [(on, at) => {
    if (!at.meta || !at.env.STORE) return
    on.handle({
      notify_trash: async (event, tx, _write, attempt) => {
        try {
          let [row] = await tx.get([event.entity.eid])
          if (!row || row.tombstone) return
          let apps: Bundle[] = row.app
            ? [row]
            : row.space
            ? await tx.read(`.app.space=${row.entity.eid} .app`) as Bundle[]
            : []
          for (let app of apps) {
            await delivered(at.env.STORE!, tx, app.entity.eid)
          }
        } catch (error) {
          // This acknowledgement is mandatory, not a best-effort action with
          // three attempts. Keep its durable run pending with bounded backoff
          // until the store answers, even after repeated outages.
          await attempt?.progressed()
          throw Object.assign(
            error instanceof Error ? error : new Error(String(error)),
            { retry: { after: 60000 } },
          )
        }
      },
    })
  }],
  wakes: [{
    entity: { eid: 'yak-trash' },
    wake: { every: DAILY, note: 'Collect expired yaks.app trash' },
    sweep: { kind: 'trash' },
  }],
  rules: [{
    name: 'trashed',
    phase: 'stamp',
    match: '*trashed, !trashed.at, #Actor, #Now',
    run: ({ Actor, Now }) => ({ trashed: { at: Now, by: Actor } }),
  }, {
    name: 'trash',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=trash, #Env, #Now',
    run: async (row) => {
      let { Env: env, Now } = row
      if (!env) return
      return await reporting(env as unknown as Env, row, async () => {
        let { collected } = await import('./erase.ts')
        await collected(env as unknown as Env, new Date(Now.at))
      })
    },
  }],
}
