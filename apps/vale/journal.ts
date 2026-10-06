// Quest tasks for the journal, tracker, map and compass: who asked, where
// each step goes and how far it has come. A quest is the vale's own (quests.ts) or a
// villager's deal (deals.ts); both are a task here, a list of steps, so the
// journal, the tracker on the glass (hud.ts), the map (map.ts) and the
// compass show them the same way. A task under way is pinned until the hero
// unpins it, and a quest on offer is pinned once taken from a notice board
// (notices.ts); the glass adds three local tasks to pins, the map rings where each
// goes next, and the compass points to the first. L or the tray's scroll
// opens it, and so does a tap on the tracker.
import { beastId, beastOf, BEASTS } from './beasts.ts'
import type { View } from './deals.ts'
import { dens } from './homes.ts'
import { ITEMS } from './items.ts'
import { levelOf, type Spot } from './levels.ts'
import type { Sheet } from './play.ts'
import { GIVERS, questXp } from './quests.ts'
import { originOf } from './regions.ts'
import type { Standing } from './rules.ts'
import { said } from './stock.ts'
import { homeOf } from './villagers.ts'

/** One step of a task: what it asks, how far it has come when it counts,
 * whether it is done, and where it is done: a level, and there whoever to go
 * to or what to fell (a creature's eid) or find (an item kind). */
export type Step = {
  text: string
  have?: number
  need?: number
  done: boolean
  level: string
  giver?: string
  kind?: string
  fell?: boolean
}

/** A quest as the journal shows it, whoever asked it. */
export type Task = {
  id: string
  title: string
  /** who asked it, by id and by name */
  giver: string
  from: string
  /** the land this task belongs to */
  level: string
  /** what doing it gives */
  gives: string
  says: string
  /** on offer, under way, done, or not yet on offer */
  state: Standing['state']
  pinned: boolean
  steps: Step[]
}

let giverOf = (id: string) => GIVERS.find((g) => g.id == id)
export let nameOf = (level: string) => levelOf(level)?.name ?? level

// Going back to whoever asked, done once it is handed in.
let back = (giver: string, done: boolean): Step => {
  let g = giverOf(giver)
  return {
    text: `Back to ${g?.name ?? 'whoever asked'}`,
    done,
    level: g?.level ?? '',
    giver,
  }
}

/** A quest of the vale's, as a task: finding whoever offers it, or what it
 * asks and then back to them.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { QUESTS } from './quests.ts'
 * import type { Standing } from './rules.ts'
 * let q = QUESTS[0]
 * let at = (state: Standing['state'], have: number) =>
 *   quest({ quest: q, state, have, pinned: false }).steps
 *     .map((s) => [s.done, s.have ?? null])
 * assertEquals(at('open', 0), [[false, null]])
 * assertEquals(at('taken', 1), [[false, 1], [false, null]])
 * assertEquals(at('taken', q.count), [[true, q.count], [false, null]])
 * assertEquals(at('done', q.count), [[true, q.count], [true, null]])
 * ```
 */
export let quest = (s: Standing): Task => {
  let q = s.quest, g = giverOf(q.giver)
  let who = g?.name ?? 'Someone'
  let state = s.state
  let fell = q.goal == 'slay'
  let name = fell
    ? beastOf(q.target)?.name ?? q.target
    : ITEMS[q.target]?.name ?? q.target
  let steps: Step[] = state == 'open' || state == 'locked'
    ? [{
      text: `Find ${who}`,
      done: false,
      level: g?.level ?? '',
      giver: q.giver,
    }]
    : [
      {
        text: fell ? `${name}s felled` : `${name} gathered`,
        have: s.have,
        need: q.count,
        done: state == 'done' || s.have >= q.count,
        level: q.level ?? g?.level ?? '',
        kind: fell ? beastId(q.target) ?? q.target : q.target,
        fell,
      },
      back(q.giver, state == 'done'),
    ]
  return {
    id: q.id,
    title: q.title,
    giver: q.giver,
    from: who,
    level: q.level ?? g?.level ?? '',
    gives: `${s.award ?? questXp(q)} xp${
      q.gift ? `, ${ITEMS[q.gift]?.name ?? q.gift}` : ''
    }`,
    says: q.body,
    state,
    pinned: s.pinned,
    steps,
  }
}

/** A villager's deal, as a task: each thing it asks, then back to them. */
export let deal = (v: View, pinned: boolean): Task => ({
  id: v.eid,
  title: `An errand for ${v.giver.name}`,
  giver: v.giver.id,
  from: v.giver.name,
  level: v.giver.level,
  gives: said(v.give),
  says: '',
  state: v.state == 'taken' ? 'taken' : 'open',
  pinned: v.state == 'taken' && pinned,
  steps: [
    ...v.steps.map((s): Step => {
      let name = BEASTS[s.kind]?.name ?? ITEMS[s.kind]?.name ?? s.kind
      return {
        text: s.deed ? `${name}s felled` : `${name} brought`,
        have: Math.min(s.have, s.n),
        need: s.n,
        done: s.have >= s.n,
        level: v.giver.level,
        kind: s.kind,
        fell: s.deed,
      }
    }),
    back(v.giver.id, false),
  ],
})

// The vale's quests as tasks, made once for each list of them the sheet
// holds, since it holds a list until one moves.
let made = new WeakMap<Standing[], Task[]>()

/** The hero's tasks: the vale's quests, save those not yet on offer, then
 * the deals standing with the villagers of the level they are in. */
export let tasksOf = (s: Sheet, views: View[]): Task[] => {
  let vale = made.get(s.quests)
  if (!vale) {
    vale = s.quests.filter((q) => q.state != 'locked').map(quest)
    made.set(s.quests, vale)
  }
  return [...vale, ...views.map((v) => deal(v, !s.unpinned.has(v.eid)))]
}

/** How many tasks the glass follows at once. */
export let FOLLOWED = 3

/** The tasks the glass follows (the quest card, the compass and the map),
 * `FOLLOWED` at most: those the hero pinned first, this land's before
 * another's, then the work in this land closest to done, under way before
 * offers. The journal lists the rest. */
export let tracked = (tasks: Task[], here: string): Task[] => {
  let active = tasks.filter((t) => t.state == 'taken' || t.state == 'open')
  let progress = (t: Task) => {
    let steps = t.steps.filter((s) => s.need)
    let need = steps.reduce((n, s) => n + s.need!, 0)
    return need
      ? steps.reduce((n, s) => n + Math.min(s.have ?? 0, s.need!), 0) /
        need
      : 0
  }
  let pins = active.filter((t) => t.pinned).sort((a, b) =>
    Number(b.level == here) - Number(a.level == here) ||
    progress(b) - progress(a)
  )
  let local = active.filter((t) => !t.pinned && t.level == here)
    .sort((a, b) =>
      Number(b.state == 'taken') - Number(a.state == 'taken') ||
      progress(b) - progress(a)
    )
  return [...pins, ...local].slice(0, FOLLOWED)
}

/** The journal's lands, current first; within each, pins and work in progress,
 * then offers, then completions. */
export let landsOf = (tasks: Task[], here: string) => {
  let lands = [...new Set(tasks.map((t) => t.level))]
    .sort((a, b) =>
      Number(b == here) - Number(a == here) ||
      nameOf(a).localeCompare(nameOf(b))
    )
  return lands.map((level) => {
    let rows = tasks.filter((t) => t.level == level && t.state != 'locked')
    return {
      level,
      taken: rows.filter((t) =>
        t.state != 'done' && (t.state == 'taken' || t.pinned)
      )
        .sort((a, b) => Number(b.pinned) - Number(a.pinned)),
      open: rows.filter((t) => t.state == 'open' && !t.pinned),
      done: rows.filter((t) => t.state == 'done'),
    }
  }).filter((land) => land.taken.length || land.open.length || land.done.length)
}

/** A step as it reads from level `here`: where it is, when not here. */
export let told = (t: Step, here: string): string =>
  t.level && t.level != here ? `${t.text} in ${nameOf(t.level)}` : t.text

/** The first step of a task not yet done, if one. */
export let next = (t: Task): Step | undefined => t.steps.find((s) => !s.done)

// The places in a level where a kind is found: the dens of a creature to
// fell, or of the creatures that drop a thing to find. They move only when
// the store's creatures do, so each is looked for once until then.
let found = new Map<string, Spot[]>()
let from = BEASTS
let haunts = (level: string, kind: string, fell: boolean): Spot[] => {
  if (from != BEASTS) found.clear()
  from = BEASTS
  let key = `${level}/${kind}/${fell}`
  let spots = found.get(key)
  if (spots) return spots
  let holds = (k: string) =>
    fell ? k == kind : BEASTS[k]?.drops.some(([i]) => i == kind)
  let [ox, oz] = originOf(level)
  spots = [
    ...new Map(
      dens(levelOf(level)!).filter((d) => holds(d.beast)).map((
        d,
      ): [string, Spot] => [d.name, [ox + d.place.at[0], oz + d.place.at[1]]]),
    ).values(),
  ]
  found.set(key, spots)
  return spots
}

/** Where a task goes next, in world metres: whoever to go to, where they
 * stand now (`at`, by id, for the ones in sight) or else at home, or where
 * what it asks for is found.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { GIVERS, QUESTS } from './quests.ts'
 * import { homeOf } from './villagers.ts'
 * let q = QUESTS[0]
 * let t = quest({ quest: q, state: 'taken', have: q.count, pinned: true })
 * // done with what it asks: back to whoever asked, wherever they stand
 * assertEquals(goal(t, { [q.giver]: [10, 20] }), [[10, 20]])
 * // out of sight, at home
 * let g = GIVERS.find((g) => g.id == q.giver)!
 * assertEquals(goal(t, {}), [homeOf(g)])
 * ```
 */
export let goal = (t: Task, at: Record<string, Spot>): Spot[] => {
  let s = next(t)
  if (!s) return []
  if (s.giver) {
    let g = giverOf(s.giver)
    let there = at[s.giver] ?? (g && homeOf(g))
    return there ? [there] : []
  }
  return s.kind ? haunts(s.level, s.kind, !!s.fell) : []
}

/** A spot on the map a task tracked goes to next, and the task's title. */
export type Mark = { at: Spot; title: string }

/** Where the tasks the glass follows (`tracked`) go next (see `goal`): every
 * spot, for the map, and for the compass the one nearest `me` of the first
 * task's. A quest on offer, pinned from a notice board (notices.ts), goes to
 * whoever offers it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { QUESTS } from './quests.ts'
 * let q = QUESTS[0]
 * let t = quest({ quest: q, state: 'taken', have: q.count, pinned: true })
 * let way = guide([t], { [q.giver]: [10, 20] }, [0, 0])
 * assertEquals(way.aim, [10, 20])
 * assertEquals(way.marks, [{ at: [10, 20], title: q.title }])
 * assertEquals(guide([], {}, [0, 0]), { marks: [], aim: null })
 * // a quest on offer, pinned from a board: to whoever offers it
 * let offer = quest({ quest: q, state: 'open', have: 0, pinned: true })
 * assertEquals(guide([offer], { [q.giver]: [3, 4] }, [0, 0]).aim, [3, 4])
 * ```
 */
export let guide = (
  tasks: Task[],
  at: Record<string, Spot>,
  [x, z]: Spot,
): { marks: Mark[]; aim: Spot | null } => {
  let spots = tasks.map((t) => ({ t, at: goal(t, at) }))
  let far = ([sx, sz]: Spot) => Math.hypot(sx - x, sz - z)
  return {
    marks: spots.flatMap(({ t, at }) =>
      at.map((s) => ({ at: s, title: t.title }))
    ),
    aim: spots[0]?.at.reduce<Spot | null>(
      (a, s) => !a || far(s) < far(a) ? s : a,
      null,
    ) ?? null,
  }
}

/** The way from spot `from` to spot `to`, in whole degrees clockwise from
 * north (-z), as the compass reads it (cam.ts `bearing`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(toward([0, 0], [0, -5]), 0)
 * assertEquals(toward([0, 0], [5, 0]), 90)
 * assertEquals(toward([0, 0], [0, 5]), 180)
 * assertEquals(toward([0, 0], [-5, 0]), 270)
 * ```
 */
export let toward = ([x, z]: Spot, [tx, tz]: Spot) =>
  (Math.round(Math.atan2(tx - x, z - tz) * 180 / Math.PI) + 360) % 360
