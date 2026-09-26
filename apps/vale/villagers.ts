// The people of the vale as minds of their own. Each quest-giver (quests.ts
// GIVERS) is a transcript in the app's store (models.md): a hero talks to one
// by speaking near them, a neighbour's news reaches them as a line they
// heard, and every few minutes, while a hero is in their land, they decide
// how to spend the next while. These are the pure parts: the row a villager
// is born as, what a turn is told, what came back, and where a villager
// stands because of it. village.ts is the page's side.
//
// A villager talks on GLM Flash and decides on Jev. Every turn reads only the
// newest lines of their transcript (`WINDOW`), so a villager who has talked
// for a month costs a turn no more than one met today, and a decision Jev
// could not make leaves them on their routine: at home. Their wake sleeps
// while nobody is in their land, so a vale nobody plays asks no model at all.
import type { Line } from './chat.ts'
import { BEASTS } from './beasts.ts'
import { LEVELS, type Spot } from './levels.ts'
import { type Giver, GIVERS, type Quest } from './quests.ts'
import { uuidOf } from './rand.ts'

/** The model a villager talks with. */
export let CHAT = '@cf/zai-org/glm-5.3-flash'

/** How many of a villager's newest lines a turn reads. */
export let WINDOW = 16

/** How long a hero counts as in a land after the page last said so, and how
 * often a villager there comes back to decide, as the wake's words say it. */
export let AWAKE = '5-minutes-ago'
export let EVERY = '5m'

/** How fast a villager walks, in metres a second. */
let SPEED = 1.2

/** How long a villager stays where they went before they walk home, in ms. */
let STAY = 15 * 60_000

/** A villager's row, by their giver id: the same on every page. */
export let eidOf = (id: string): string => uuidOf(`villager/${id}`)

/** Where a villager stands when they are at home. */
export let homeOf = (g: Giver): Spot => {
  let [x, z] = LEVELS[g.level]?.places[g.place]?.at ?? [64, 64]
  return [x + g.offset[0], z + g.offset[1]]
}

/** The others who live in a villager's land. */
export let neighbours = (g: Giver): Giver[] =>
  GIVERS.filter((n) => n.level == g.level && n.id != g.id)

/**
 * A villager as the store first holds them: a transcript, and a standing call
 * to `think` (the command whose row is `think`) that wakes every `EVERY`
 * while a hero has been seen in their land lately, and sleeps when none has.
 * Every page adds the same row, so two that add it at once add one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { GIVERS } from './quests.ts'
 * let pip = GIVERS.find((g) => g.id == 'pip')!
 * assertEquals(born(pip, 't1').entity, born(pip, 't2').entity)
 * ```
 */
export let born = (g: Giver, think: string) => ({
  entity: { eid: eidOf(g.id) },
  doc: { title: g.name },
  villager: { id: g.id, level: g.level },
  session: {},
  call: { to: think, args: { villager: eidOf(g.id) } },
  wake: {
    while: [{
      match: `.seen.level=${g.level}&.seen.at>=${AWAKE}`,
      every: EVERY,
    }],
  },
})

/** A hero's line as a villager hears it: who said it, then what. */
export let said = (hero: string, words: string) => `${hero}: ${words}`

/** A quest as the hero talking stands with it (rules.ts `questsOf`). */
export type Standing = { quest: Quest; state: string; have: number }

/** What a villager knows, beyond who they are, when a hero speaks to them. */
export type Facts = {
  hero: { name: string; lvl: number }
  /** their quests, as this hero stands with each */
  quests: Standing[]
  /** what heroes did in this land lately (`deeds`) */
  deeds: string[]
  /** the other heroes here now, by name */
  here: string[]
}

let roadsOf = (level: string) =>
  Object.entries(LEVELS[level]?.roads ?? {})
    .map(([side, to]) => `${side} to ${LEVELS[to]?.name ?? to}`)
    .join(', ')

let asked = (quests: Standing[]) =>
  quests.flatMap(({ quest: q, state, have }) =>
    state == 'done'
      ? [`- done: "${q.title}"`]
      : state == 'taken'
      ? [`- asked, ${have} of ${q.count} so far: "${q.title}". ${q.body}`]
      : state == 'open'
      ? [`- yours to offer them next: "${q.title}". ${q.body}`]
      : []
  )

/**
 * What a villager is told before a hero's line: who they are, their land,
 * their neighbours, what they have asked of this hero, and what happened here
 * lately. A few hundred tokens, however long they have lived.
 *
 * ```ts
 * import { assertStringIncludes } from '@std/assert'
 * import { GIVERS } from './quests.ts'
 * let wren = GIVERS.find((g) => g.id == 'wren')!
 * let told = persona(wren, {
 *   hero: { name: 'Bramble', lvl: 2 },
 *   quests: [],
 *   deeds: ['Tansy felled 3 Moss slimes'],
 *   here: [],
 * })
 * assertStringIncludes(told, 'You are Elder Wren, of Mossvale')
 * assertStringIncludes(told, `Pip (${eidOf('pip')})`)
 * assertStringIncludes(told, 'Tansy felled 3 Moss slimes')
 * ```
 */
export let persona = (g: Giver, f: Facts): string => {
  let land = LEVELS[g.level]?.name ?? g.level
  let others = neighbours(g).map((n) => `${n.name} (${eidOf(n.id)})`)
  let quests = asked(f.quests)
  return [
    `You are ${g.name}, of ${land}, a land of Mossvale: a world of small ` +
    'lands where heroes take up quests. Stay in character. Speak plainly and ' +
    'warmly, as yourself: one to three short sentences, no lists, no stage ' +
    'directions. You know your land and what you have heard, nothing more. ' +
    'Never say you are a model, or in a game.',
    `What you tell a stranger: "${g.greets}"`,
    `Roads out of ${land}: ${roadsOf(g.level) || 'none'}.`,
    `Your neighbours here: ${others.join(', ') || 'none'}.`,
    'A line you hear begins with the name of whoever said it. A line ' +
    'beginning "News:" is something a neighbour told you. A line like ' +
    '"go: visit, 0.8" is a choice you made.',
    `${f.hero.name}, a hero of level ${f.hero.lvl}, is talking to you.`,
    ...quests.length ? ['What you have asked of them:', ...quests] : [],
    ...f.deeds.length ? [`Lately in ${land}: ${f.deeds.join('; ')}.`] : [],
    ...f.here.length ? [`Also here: ${f.here.join(', ')}.`] : [],
    'When you hear something a neighbour would want to know, tell them with ' +
    'tell, naming them by the id beside their name, and say it as you would.',
  ].join('\n')
}

/** A fall as a villager hears of it: who, what kind, and when, in ms. */
export type Fall = { by: string; kind: string; at: number }

/**
 * What heroes did lately, a line each: who felled how many of what, most
 * first, since `since`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let falls = [
 *   { by: 'Tansy', kind: 'slime', at: 5 },
 *   { by: 'Tansy', kind: 'slime', at: 6 },
 *   { by: 'Rook', kind: 'boar', at: 7 },
 *   { by: 'Rook', kind: 'boar', at: 1 },
 * ]
 * assertEquals(deeds(falls, 4), ['Tansy felled 2 Moss slimes', 'Rook felled a Bristleboar'])
 * ```
 */
export let deeds = (falls: Fall[], since: number, most = 4): string[] => {
  let n = new Map<string, number>()
  for (let f of falls) {
    if (f.at >= since) {
      n.set(`${f.by}\0${f.kind}`, (n.get(`${f.by}\0${f.kind}`) ?? 0) + 1)
    }
  }
  return [...n].sort(([, a], [, b]) => b - a).slice(0, most).map(([k, c]) => {
    let [by, kind] = k.split('\0')
    let name = BEASTS[kind]?.name ?? kind
    return c == 1
      ? `${by} felled ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`
      : `${by} felled ${c} ${name}s`
  })
}

/** Where a villager goes for a while, as Jev chose it. */
export type Go = 'home' | 'about' | 'visit'

/** A choice of where to go, and when it was made, in ms. */
export type Plan = { go: Go; at: number }

type Row = Record<string, unknown> & { entity: { eid: string } }

let part = (v: unknown): Record<string, unknown> =>
  v && typeof v == 'object' ? v as Record<string, unknown> : {}

let whenOf = (b: Row) => Date.parse(String(part(b.created).at ?? '')) || 0

let GOES: Go[] = ['home', 'about', 'visit']

/**
 * What came back from the villagers, off their transcripts' outputs: what
 * each said, as lines over their heads (`player` is the villager's giver id),
 * and where each chose to go, oldest first. `idOf` names the villager whose
 * transcript a row is in.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let row = (eid: string, more: object, at: number) => ({
 *   entity: { eid },
 *   entry: { session: 's-wren' },
 *   created: { at: new Date(at).toISOString() },
 *   ...more,
 * })
 * let heard = answered([
 *   row('a', { content: { body: 'Well met.' }, output: {} }, 2000),
 *   row('b', { answer: { question: 'go', choice: 'visit' } }, 3000),
 *   row('c', { answer: { question: 'mood', choice: 'glad' } }, 3000),
 * ], (s) => s == 's-wren' ? 'wren' : null)
 * assertEquals(heard.lines, [{ eid: 'a', player: 'wren', by: '', text: 'Well met.', at: 2000 }])
 * assertEquals(heard.plans.get('wren'), [{ go: 'visit', at: 3000 }])
 * ```
 */
export let answered = (
  rows: Row[],
  idOf: (session: string) => string | null,
) => {
  let lines: Line[] = []
  let plans = new Map<string, Plan[]>()
  for (let b of [...rows].sort((a, b) => whenOf(a) - whenOf(b))) {
    let id = idOf(String(part(b.entry).session ?? ''))
    if (!id) continue
    let a = part(b.answer)
    if (b.answer) {
      let go = GOES.find((g) => g == a.choice)
      if (a.question == 'go' && go) {
        plans.set(id, [...plans.get(id) ?? [], { go, at: whenOf(b) }])
      }
      continue
    }
    let text = String(part(b.content).body ?? '').replace(/\s+/g, ' ').trim()
    if (text) {
      lines.push({ eid: b.entity.eid, player: id, by: '', text, at: whenOf(b) })
    }
  }
  return { lines, plans }
}

let lerp = (a: Spot, b: Spot, k: number): Spot => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
]

// Where a plan puts a villager at `t`: at home, strolling a slow ring round
// it, or beside the nearest neighbour's door.
let spot = (g: Giver, go: Go, t: number): Spot => {
  let home = homeOf(g)
  if (go == 'about') {
    let a = t / 9000 + g.id.length
    return [home[0] + 2.5 * Math.cos(a), home[1] + 2.5 * Math.sin(a)]
  }
  if (go == 'visit') {
    let near = neighbours(g).map(homeOf)
      .sort((a, b) =>
        Math.hypot(a[0] - home[0], a[1] - home[1]) -
        Math.hypot(b[0] - home[0], b[1] - home[1])
      )[0]
    if (!near) return spot(g, 'about', t)
    let d = Math.hypot(home[0] - near[0], home[1] - near[1]) || 1
    return lerp(near, home, 1.6 / d)
  }
  return home
}

/**
 * Where a villager stands at `now`: walking from where their last plan left
 * them to where their newest one sends them, and home again once they have
 * stayed a while. With no plan, at home: that is their routine.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { GIVERS } from './quests.ts'
 * let wren = GIVERS.find((g) => g.id == 'wren')!
 * assertEquals(where(wren, [], 0), homeOf(wren))
 * let visit = [{ go: 'visit' as const, at: 0 }]
 * assertEquals(where(wren, visit, 0), homeOf(wren))
 * assertEquals(where(wren, visit, 60 * 60_000), homeOf(wren))
 * ```
 */
export let where = (g: Giver, plans: Plan[], now: number): Spot => {
  let is = plans.at(-1)
  if (!is) return spot(g, 'home', now)
  let steps = is.go != 'home' && now - is.at > STAY
    ? [is, { go: 'home' as Go, at: is.at + STAY }]
    : [plans.at(-2), is]
  let [was, next] = steps
  let from = spot(g, was?.go ?? 'home', next!.at)
  let to = spot(g, next!.go, now)
  let d = Math.hypot(to[0] - from[0], to[1] - from[1])
  return d
    ? lerp(from, to, Math.min(1, (now - next!.at) / 1000 * SPEED / d))
    : to
}
