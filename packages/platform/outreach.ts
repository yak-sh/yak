/**
 * What every space's Operator would write its people between visits, tried
 * without sending (T-1704). A trial is the platform admin's: given what
 * yaks.app can do now (the changelog), each space's Operator writes one email
 * from that space's own apps and their use. All of them go to the model as one
 * batch, each request the same shared prefix (the Operator's base persona, how
 * these emails are written, the changelog) followed by that space's own part,
 * so the prefix is written to the cache once and read by every other request,
 * at the batch's half price. The prefix is context only: how each email reads
 * is the Operator's to judge for that person.
 *
 * This is the pure part: a space's stage, the prefix, a space's part, the
 * batch request for it, and the letters its answers make. Sending the batch
 * and keeping the rows are ./outreach-trial.ts's; reading the directory is the
 * host's.
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { type Price, weigh } from '@yaks/model'
import { type Answered, type Asked, BATCH } from '@yaks/model/batch'

let DAY = 86_400_000

/** How long since its last deploy a space still counts as being built. */
export let BUILDING = 14 * DAY

/** How many visits in a month make an app one people use. */
export let USED = 20

/** One app of a space, as the directory keeps its use. */
export type App = {
  slug: string
  title: string
  /** visits in the last 30 days, where they were read */
  visits: number | null
  /** requests this month */
  requests: number
  deployed: string | null
  /** its store's last write */
  changed: string | null
  errored: string | null
  used: string | null
}

/** One person seated in a space. */
export type Person = {
  name: string
  role: string
  signedIn: string | null
}

/** What the directory knows of a space, which is all its Operator is given. */
export type Facts = {
  space: string
  slug: string
  operator: string
  plan: string
  made: string | null
  people: Person[]
  apps: App[]
}

/** Where a space stands. */
export type Stage = 'nothing built' | 'quiet' | 'building' | 'in use'

/**
 * Where a space stands at `now`: no app yet, apps people visit, apps deployed
 * lately, or apps left alone.
 *
 * ```ts
 * import { stageOf } from '@yaks/platform/outreach'
 * import { assertEquals } from '@std/assert'
 *
 * let app = { slug: 'a', title: 'A', visits: 3, requests: 0, deployed: '2026-11-01T00:00:00Z', changed: null, errored: null, used: null }
 * let space = { space: 's', slug: 's', operator: 'Lena', plan: 'free', made: null, people: [], apps: [app] }
 * let now = Date.parse('2026-11-20T00:00:00Z')
 * assertEquals(stageOf({ ...space, apps: [] }, now), 'nothing built')
 * assertEquals(stageOf(space, now), 'quiet')
 * assertEquals(stageOf({ ...space, apps: [{ ...app, deployed: '2026-11-10T00:00:00Z' }] }, now), 'building')
 * assertEquals(stageOf({ ...space, apps: [{ ...app, visits: 40 }] }, now), 'in use')
 * ```
 */
export let stageOf = (f: Facts, now: number): Stage => {
  if (!f.apps.length) return 'nothing built'
  if (f.apps.reduce((n, a) => n + (a.visits ?? 0), 0) >= USED) return 'in use'
  let last = Math.max(
    0,
    ...f.apps.map((a) => Date.parse(a.deployed ?? '') || 0),
  )
  return now - last <= BUILDING ? 'building' : 'quiet'
}

/** How these emails are written, the same for every space. */
let HOW = `# Writing to your people between visits

You work for the people of one yaks.app space even when none of them is here.
Between their visits you look at their space, do the next useful thing, and
email them what you noticed and what you did or would do. Email is one more
way to talk with you: whatever they reply comes to you, in their one
conversation.

This is a trial run. Nothing you write here is sent, and you have no tools:
write the one email you would send this space's people today, from what you
are told about their space below and what yaks.app can now do.

- Write in the first person, as their Operator, signed with your name.
- Keep it short: a few sentences someone reads on a phone.
- Make it about their own apps and how they are used. When something new
  below would help one of their apps, say specifically what it would do for
  that app, and what they would reply to have it set up.
- Never invent their situation. If they have built nothing, or you know too
  little, ask one question about their own work instead.
- End with something they can reply with to have it done.
- There is no fixed format. Write it the way you judge best for these people.
- If nothing is worth an email today, say so instead of writing one.

Answer with the subject on the first line as \`Subject: ...\`, a blank line,
and the email as plain text. With nothing worth sending, answer
\`Subject: (none)\` and one line saying why.`

/**
 * The prefix every request of a trial shares: the Operator's base persona,
 * how these emails are written and what changed. Nothing in it names a space,
 * so the cache written by the first request serves every other.
 */
export let prefix = (persona: string, changelog: string) =>
  [persona.trim(), HOW, `# What yaks.app can do now\n\n${changelog.trim()}`]
    .filter(Boolean)
    .join('\n\n---\n\n')

let day = (at: string | null) => at ? at.slice(0, 10) : 'never'

/** A space's own part of its request: who is in it and what its apps are
 * doing, as the directory knows them. */
export let brief = (f: Facts, now: number): string => {
  let people = f.people.map((p) =>
    `- ${p.name || 'someone unnamed'} (${p.role}), last signed in ${
      day(p.signedIn)
    }`
  )
  let apps = f.apps.map((a) =>
    `- ${a.title || a.slug} (${f.slug}.yaks.app/${a.slug}): ${
      a.visits ?? 'unknown'
    } visits in 30 days, ${a.requests} requests this month, deployed ${
      day(a.deployed)
    }, data last changed ${day(a.changed)}, last error ${day(a.errored)}`
  )
  return [
    `Your name is ${f.operator}. The space is ${f.slug} (${f.slug}.yaks.app), on the ${f.plan} plan, made ${
      day(f.made)
    }. Today is ${new Date(now).toISOString().slice(0, 10)}.`,
    `Where it stands: ${stageOf(f, now)}.`,
    `People:\n${people.join('\n') || '- nobody seated'}`,
    `Apps:\n${apps.join('\n') || '- none yet'}`,
  ].join('\n\n')
}

/** One space's request in a trial's batch, named by the space: the shared
 * prefix, then what its Operator is told of it. */
export let asked = (
  model: string,
  shared: string,
  f: Facts,
  now: number,
  cache?: string,
): Asked => ({
  id: f.space,
  model,
  system: shared,
  text: brief(f, now),
  max: 16_000,
  ...cache ? { cache } : {},
})

/**
 * An answer read as an email: its subject line and its words.
 *
 * ```ts
 * import { read } from '@yaks/platform/outreach'
 * import { assertEquals } from '@std/assert'
 *
 * assertEquals(read('Subject: Roster can be searched\n\nHi,\nI drafted it.'), {
 *   title: 'Roster can be searched',
 *   body: 'Hi,\nI drafted it.',
 * })
 * assertEquals(read('No subject here'), { title: '', body: 'No subject here' })
 * ```
 */
export let read = (text: string): { title: string; body: string } => {
  let m = text.trim().match(/^subject:\s*(.*)\n*([\s\S]*)$/i)
  return m
    ? { title: m[1].trim(), body: m[2].trim() }
    : { title: '', body: text.trim() }
}

/** A letter's eid: one per trial and space, so reading a batch twice writes
 * the same rows. */
export let letterOf = (trial: string, space: string) =>
  derivedEid(`outreach_letter ${trial} ${space}`)

/** The letters a trial asks for as it is sent, before any is written: each
 * space's stage and what its Operator was told of it. */
export let asking = (
  trial: string,
  sent: Asked[],
  stages: Map<string, Stage>,
) =>
  sent.map((a): Bundle => ({
    entity: { eid: letterOf(trial, a.id) },
    outreach_letter: {
      trial,
      space: a.id,
      stage: stages.get(a.id) ?? '',
      brief: a.text,
    },
  }))

/** What one answer cost at batch prices; 0 without a price, or without an
 * answer. */
export let costOf = (price: Price | undefined, a: Answered): number =>
  price && 'usage' in a ? BATCH * weigh(price, a.usage) : 0

/** A trial's letters from its batch's answers, and what the whole batch
 * cost. A request that failed is kept as a letter saying so. */
export let letters = (
  trial: string,
  price: Price | undefined,
  answers: Answered[],
): { rows: Bundle[]; dollars: number } => {
  let rows = answers.map((a): Bundle => ({
    entity: { eid: letterOf(trial, a.id) },
    outreach_letter: { trial, space: a.id, dollars: costOf(price, a) },
    doc: 'text' in a ? read(a.text) : { title: '(not written)', body: a.error },
  }))
  return {
    rows,
    dollars: answers.reduce((n, a) => n + costOf(price, a), 0),
  }
}
