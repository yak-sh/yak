// Outreach trials in the directory (@yaks/platform/outreach, T-1704): what
// every space's Operator would email its people between visits, given what
// yaks.app can do now, written in one batch and kept as rows on the admin's
// Letters page. Nothing is sent.
//
// An admin writes `outreach_trial{changelog, model}` (`yak admin letters`).
// Its `outreach_write` reads the census the admin's directory reads (admin.ts
// `uses`), so each Operator is told what that page shows of its space: its
// people, its apps and their use. Test spaces and the platform's own are left
// out, and so are the platform's own accounts' (admin, the demo space);
// everyone else is in, pilots included. It sends the batch and wakes the
// trial a few minutes on. Each firing reads the batch (`outreach_read`): until
// it has ended the trial wakes again, and once it has, its results become
// `outreach_letter` rows and the trial wears `outreach_written`. What it cost
// is the platform's own spend, at batch prices, on the rows.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import type { Batches } from '@yaks/anthropic/batches'
import {
  entry,
  type Facts,
  letters,
  MODEL,
  prefix,
  stageOf,
} from '@yaks/platform/outreach'
import { BASE } from '@yaks/platform/operator-model'
import { BOT } from '@yaks/platform/bots'
import { type Census, uses } from './admin.ts'
import { appAbout, idOf, META, spaceOf } from './directory.ts'
import { calledOf } from './operator-name.ts'

/** How long a trial waits before reading its batch again. */
export let AGAIN = 5 * 60_000

type Store = Pick<Graph, 'get' | 'apply'>

/** The provider's batches, as @yaks/anthropic/batches gives them. */
export type Api = Batches

/** Every space's facts, as the directory holds them now. */
export type Read = (now: Date) => Promise<Facts[]>

let str = (v: unknown) => typeof v == 'string' ? v : ''

/** Every space an Operator would write to, as its facts: the platform's own
 * space and every test space left out. */
export let factsOf = (c: Census, now: Date): Facts[] => {
  let used = uses(c, now)
  let people = new Map(c.people.map((r) => [r.entity.eid, r]))
  return c.spaces.flatMap((r): Facts[] => {
    let space = spaceOf(r)
    let seats = c.seats.filter((s) => idOf(s.member!.space) == space.eid)
    let bots = seats.every((s) =>
      str(
        (people.get(idOf(s.member!.person))?.email as Comp | undefined)
          ?.address,
      ).endsWith(BOT)
    )
    if (space.slug == META.space || used.get(space.eid)?.test || bots) {
      return []
    }
    let apps = c.apps.filter((a) =>
      !a.trashed && appAbout(a).space == space.eid
    )
    return [{
      space: space.eid,
      slug: space.slug,
      operator: calledOf(r),
      plan: space.tier ?? 'free',
      made: r.created?.at ?? null,
      people: seats.map((s) => {
        let p = people.get(idOf(s.member!.person))
        return {
          name: str((p?.doc as Comp | undefined)?.title),
          role: s.member!.role,
          signedIn: str((p?.signed_in as Comp | undefined)?.at) || null,
        }
      }),
      apps: apps.map((a) => {
        let u = used.get(a.entity.eid) ?? {}
        return {
          slug: appAbout(a).slug,
          title: str((a.doc as Comp | undefined)?.title),
          visits: u.visits ?? null,
          requests: u.requests ?? 0,
          deployed: u.deployed?.at ?? null,
          changed: u.changed ?? null,
          errored: u.errored ?? null,
          used: u.active ?? null,
        }
      }),
    }]
  })
}

let wake = (trial: string, now: number): Bundle => ({
  entity: { eid: trial },
  wake: {
    at: new Date(now + AGAIN).toISOString(),
    target: trial,
    note: "Read this trial's letters once its batch has ended",
  },
})

/** Sends a trial's batch: one request per space, after the prefix all of them
 * share. A trial already sent is left alone. */
export let write = async (
  g: Store,
  facts: Read,
  api: Api,
  trial: string,
  now = Date.now(),
) => {
  let [row] = await g.get([trial])
  let asked = row?.outreach_trial as Comp | undefined
  if (!asked || row.outreach_batch) return
  let model = str(asked.model) || MODEL
  let [base] = await g.get([BASE])
  let shared = prefix(
    str((base?.doc as Comp | undefined)?.body),
    str(asked.changelog),
  )
  let all = await facts(new Date(now))
  let batch = await api.submit(all.map((f) => entry(model, shared, f, now)))
  await g.apply([{
    ...wake(trial, now),
    outreach_batch: {
      id: batch.id,
      at: new Date(now).toISOString(),
      spaces: all.length,
    },
  }])
}

/** Reads a trial's batch at its wake: its letters once it has ended, else
 * another wake. */
export let collect = async (
  g: Store,
  facts: Read,
  api: Api,
  trial: string,
  now = Date.now(),
) => {
  let [row] = await g.get([trial])
  let id = str((row?.outreach_batch as Comp | undefined)?.id)
  if (!id || row.outreach_written) return
  if ((await api.read(id)).processing_status != 'ended') {
    await g.apply([wake(trial, now)])
    return
  }
  let model = str((row.outreach_trial as Comp).model) || MODEL
  let stages = new Map(
    (await facts(new Date(now))).map((f) => [f.space, stageOf(f, now)]),
  )
  let made = letters(trial, model, await api.results(id), stages)
  await g.apply([...made.rows, {
    entity: { eid: trial },
    outreach_written: {
      at: new Date(now).toISOString(),
      letters: made.rows.length,
      dollars: made.dollars,
    },
  }])
}
