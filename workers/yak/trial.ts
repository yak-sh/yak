// The trial sweep (D-476): each hour, every space owed a trial of the
// Plus plan is given one, and every trial is kept: its clock stopped
// while its owners are away and started again when they are back, and the
// note it is owed sent by the space's Operator to its owners' own addresses.
// What a trial is and when a note is due is @yaks/platform/trial's; this
// reads the directory, writes the marks and sends the letters.
//
// Nothing happens until `TRIALS` names the moment yaks.app began giving
// trials: until then, every space is on the terms it had. Spaces made before
// that moment start their trial at it, and are sent its notice; a person's
// first space made after starts its trial when it was made; any later space
// of theirs starts with its trial over, since a person tries once. A space
// that pays for a plan, or is given one (a comp, a comped month, the
// platform's own), is never given a trial, never paused and never written to.
import { line } from '@yaks/query'
import type { Bundle } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import {
  begun,
  days,
  due,
  letter,
  type Trial,
  trialOf,
  upkept,
} from '@yaks/platform/trial'
import { paid, planName, PRICE, STARTER } from '@yaks/platform/plans'
import { starterOf, topUp } from '@yaks/platform/meter'
import { planSettings } from '@yaks/platform/routes'
import { isFleetAddress, isTestAddress } from '@yaks/platform/bots'
import * as dirPart from './directory.ts'
import { directory, type Space, stamp } from './directory.ts'
import { bound, type Env } from './env.ts'
import { meta } from './meta.ts'
import { owe } from './mail.ts'
import { step } from './funnel.ts'
import { caught } from './defects.ts'

/** When yaks.app began giving trials (`TRIALS`, an ISO time), or none while
 * it gives none. */
export let since = (env: Pick<Env, 'TRIALS'>): number | null => {
  let at = Date.parse(env.TRIALS ?? '')
  return Number.isFinite(at) ? at : null
}

/** What a space is given when it has no trial: none when it has a plan or
 * is in the trash; from `from` with its notice owed, for a space made
 * before trials began; from when it was made, for a person's first space
 * made after; and over at birth for any other, since a person tries once. */
export let owed = (
  space: Pick<Space, 'tier' | 'trashed'>,
  made: number,
  first: boolean,
  from: number,
): Trial | null =>
  paid(space.tier) || space.trashed
    ? null
    : made < from
    ? begun(from, false)
    : first
    ? begun(made)
    : {
      at: new Date(made).toISOString(),
      through: new Date(made).toISOString(),
      told: 'started ended',
    }

// When an owner was last on yaks.app: signed in, used a page or a tool
// (`used`), or was on any channel their Operator hears them on
// (`whereabouts`, its Operator's page open, a letter or a text to it).
let seen = async (env: Env, people: string[]): Promise<number | null> => {
  if (!people.length) return null
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let [rows, places] = await Promise.all([
    Promise.all(
      people.map((p) =>
        meta(env).query(line`.entity.eid=${p}&?used&?signed_in`)
      ),
    ),
    dir.whereabouts(people),
  ])
  let times = [
    ...rows.flat().flatMap((r) => [
      (r.used as { at?: string } | undefined)?.at,
      (r.signed_in as { at?: string } | undefined)?.at,
    ]),
    ...places.flatMap((r) =>
      r.whereabouts?.state == 'away' || r.whereabouts?.state == 'offline'
        ? []
        : [r.whereabouts?.at]
    ),
  ].map((t) => Date.parse(t ?? '')).filter(Number.isFinite)
  return times.length ? Math.max(...times) : null
}

// A space with no trial yet, as the sweep gives it one: when it was made and
// whether it is its owner's first (`started`).
let made = async (env: Env, space: Space) => {
  let [[row], [first]] = await Promise.all([
    meta(env).query(line`.entity.eid=${space.eid}&.fields=created.at`),
    meta(env).query(line`.started.space=${space.eid}&.fields=entity.eid`),
  ])
  let at = Date.parse(
    (row?.created as { at?: string } | undefined)?.at ?? '',
  )
  return { at: Number.isFinite(at) ? at : 0, first: !!first }
}

/** Give each space owed a trial its trial, and keep every trial: how many
 * spaces were written. */
export let trials = async (env: Env, now = new Date()): Promise<number> => {
  let from = since(env)
  if (from == null || now.getTime() < from) return 0
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let n = 0
  for (let space of await dir.all()) {
    try {
      if (await kept(env, space, from, now)) n++
    } catch (e) {
      caught(e, { request: 'trial sweep', space: space.slug })
    }
  }
  return n
}

let kept = async (env: Env, space: Space, from: number, now: Date) => {
  let at = now.getTime()
  let trial = space.trial
  let starting: Trial | null = null
  if (!trial) {
    if (paid(space.tier) || space.trashed) return false
    let { at: born, first } = await made(env, space)
    starting = owed(space, born, first, from)
    if (!starting) return false
    trial = starting
  }
  // A plan took over: its trial waits on nothing and owes nobody a note.
  if (paid(space.tier) && !space.trialing && !starting) return false
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let owners = await dir.owners(space)
  let up = upkept(trial, at, await seen(env, owners))
  let next = { ...trial, ...up?.patch }
  let note = due(next, at)
  if (!starting && !up && !note) return false
  // A trial begun for a space made before trials began carries the trial's
  // AI use, whatever its starter had left (@yaks/platform/plans `STARTER`).
  let short = starting && Date.parse(starting.at) == from
    ? Math.max(0, STARTER - starterOf(space, now))
    : 0
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      plan_trial: starting
        ? { ...next, ...note ? { told: note.told } : {} }
        : { ...up?.patch, ...note ? { told: note.told } : {} },
      ...short ? { starter: { dollars: topUp(space, short, now) } } : {},
      $was: {
        plan_trial: {
          told: starting || trial.told == null ? null : token(trial.told),
        },
        ...short
          ? {
            starter: {
              dollars: space.starter == null ? null : token(space.starter),
            },
          }
          : {},
      },
    } as Bundle],
  })
  let who = await Promise.all(owners.map((p) => dir.emailAt(p)))
  for (let moved of up?.moved ?? []) {
    step(env, moved == 'paused' ? 'trial_paused' : 'trial_resumed', undefined, {
      who,
    })
  }
  if (note?.note == 'ended') step(env, 'trial_ended', undefined, { who })
  if (note) await sent(env, space, owners, who, note.note, next, at)
  return true
}

// The note, from the space's Operator to each owner at their own address:
// never to an address the fleet or a test holds.
let sent = async (
  env: Env,
  space: Space,
  owners: string[],
  addresses: (string | null)[],
  note: Parameters<typeof letter>[0],
  trial: Trial,
  now: number,
) => {
  let words = letter(note, {
    slug: space.slug,
    operator: space.operator,
    left: days(trialOf(trial, now).left),
    plans: planSettings(space.slug, env),
    plan: planName('plus'),
    price: PRICE.plus,
  })
  for (let [i, to] of addresses.entries()) {
    if (!to || isFleetAddress(to) || isTestAddress(to)) continue
    await owe(env, space, { to, person: owners[i], ...words }).catch((e) =>
      caught(e, { request: 'trial letter', space: space.slug, note })
    )
  }
}
