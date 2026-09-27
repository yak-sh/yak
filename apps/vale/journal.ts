// The hero's journal, drawn into its panel (panel.ts): every quest under way,
// with who asked it and where, its steps and how far each has come, the ones
// on offer, and the ones done. A quest is the vale's own (quests.ts) or a
// villager's deal (deals.ts); both are a task here, a list of steps, so the
// journal, the tracker on the glass (hud.ts), the map (map.ts) and the
// compass show them the same way. A task under way is pinned until the hero
// unpins it; the glass tracks the pinned ones, the map rings where each goes
// next, and the compass points to the first. L or the tray's scroll opens it,
// and so does a tap on the tracker.
import { BEASTS } from './beasts.ts'
import type { View } from './deals.ts'
import { type Glyph, glyph } from './glyphs.ts'
import { dens } from './homes.ts'
import { ITEMS } from './items.ts'
import { ACROSS, LEVELS, type Side, type Spot } from './levels.ts'
import type { Panel } from './panel.ts'
import type { Sheet } from './play.ts'
import { GIVERS } from './quests.ts'
import type { Standing } from './rules.ts'
import { said } from './stock.ts'
import { tipped } from './tip.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** One step of a task: what it asks, how far it has come when it counts,
 * whether it is done, and where it is done: a level, and there whoever to go
 * to or what to fell or find. */
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
  /** who asked it, by id and by name, and the level they are in */
  giver: string
  from: string
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
let nameOf = (level: string) => LEVELS[level]?.name ?? level

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
    ? BEASTS[q.target]?.name ?? q.target
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
        kind: q.target,
        fell,
      },
      back(q.giver, state == 'done'),
    ]
  return {
    id: q.id,
    title: q.title,
    giver: q.giver,
    from: who,
    level: g?.level ?? '',
    gives: `${q.xp} xp${q.gift ? `, ${ITEMS[q.gift]?.name ?? q.gift}` : ''}`,
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

/** A step as it reads from level `here`: where it is, when not here. */
export let told = (t: Step, here: string): string =>
  t.level && t.level != here ? `${t.text} in ${nameOf(t.level)}` : t.text

/** The first step of a task not yet done, if one. */
export let next = (t: Task): Step | undefined => t.steps.find((s) => !s.done)

/** The side of level `from` whose road is the first on the way to level
 * `to`; none when it is `from` itself or no road leads there.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(road('mossvale', 'mossvale'), null)
 * assertEquals(road('mossvale', 'birchmere'), 'west')
 * assertEquals(road('birchmere', 'mossvale'), 'east')
 * ```
 */
export let road = (from: string, to: string): Side | null => {
  if (from == to || !LEVELS[to]) return null
  let first = new Map<string, Side>()
  let queue = [from]
  for (let id of queue) {
    for (let side of Object.values(ACROSS)) {
      let lv = LEVELS[id]?.roads[side]
      if (!lv || lv == from || first.has(lv)) continue
      first.set(lv, id == from ? side : first.get(id)!)
      if (lv == to) return first.get(lv)!
      queue.push(lv)
    }
  }
  return null
}

// The places in a level where a kind is found: the dens of a creature to
// fell, or of the creatures that drop a thing to find. They never move, so
// each is looked for once.
let found = new Map<string, Spot[]>()
let haunts = (level: string, kind: string, fell: boolean): Spot[] => {
  let key = `${level}/${kind}/${fell}`
  let spots = found.get(key)
  if (spots) return spots
  let holds = (k: string) =>
    fell ? k == kind : BEASTS[k]?.loot.some(([i]) => i == kind)
  spots = [
    ...new Map(
      dens(LEVELS[level]).filter((d) => holds(d.kind)).map((
        d,
      ) => [d.name, d.place.at]),
    ).values(),
  ]
  found.set(key, spots)
  return spots
}

/** Where a task goes next, on the level `here`: whoever to go to, where what
 * it asks for is found, or, when that is on another level, the end of the
 * road toward it. `at` is where each giver on `here` stands now, by id, and
 * `roads` where each of its roads ends.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { QUESTS } from './quests.ts'
 * let q = QUESTS[0]
 * let t = quest({ quest: q, state: 'taken', have: q.count, pinned: true })
 * // done with what it asks: back to whoever asked, wherever they stand
 * assertEquals(goal(t, 'mossvale', { [q.giver]: [10, 20] }, []), [[10, 20]])
 * // from the next level over, the road home
 * let east = { side: 'east' as const, x: 120, z: 64 }
 * assertEquals(goal(t, 'birchmere', {}, [east]), [[120, 64]])
 * ```
 */
export let goal = (
  t: Task,
  here: string,
  at: Record<string, Spot>,
  roads: { side: Side; x: number; z: number }[],
): Spot[] => {
  let s = next(t)
  if (!s) return []
  if (s.level != here) {
    let side = road(here, s.level)
    return roads.filter((r) => r.side == side).map((r) => [r.x, r.z])
  }
  if (s.giver) return at[s.giver] ? [at[s.giver]] : []
  return s.kind ? haunts(here, s.kind, !!s.fell) : []
}

/** A spot on the map a task tracked goes to next, and the task's title. */
export type Mark = { at: Spot; title: string }

/** Where the tasks tracked go next on level `here` (see `goal`): every spot,
 * for the map, and for the compass the one nearest `me` of the first task's.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { QUESTS } from './quests.ts'
 * let q = QUESTS[0]
 * let t = quest({ quest: q, state: 'taken', have: q.count, pinned: true })
 * let way = guide([t], 'mossvale', { [q.giver]: [10, 20] }, [], [0, 0])
 * assertEquals(way.aim, [10, 20])
 * assertEquals(way.marks, [{ at: [10, 20], title: q.title }])
 * let off = guide([{ ...t, pinned: false }], 'mossvale', {}, [], [0, 0])
 * assertEquals(off, { marks: [], aim: null })
 * ```
 */
export let guide = (
  tasks: Task[],
  here: string,
  at: Record<string, Spot>,
  roads: { side: Side; x: number; z: number }[],
  [x, z]: Spot,
): { marks: Mark[]; aim: Spot | null } => {
  let spots = tasks.filter((t) => t.state == 'taken' && t.pinned)
    .map((t) => ({ t, at: goal(t, here, at, roads) }))
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

export type Acts = { pin: (task: string, on: boolean) => void }

/** The journal, drawn into its panel. */
export let journal = (panel: Panel, acts: Acts) => {
  let was = ''
  panel.body.addEventListener('click', (e) => {
    let b = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-pin]')
      : null
    if (!b) return
    acts.pin(b.dataset.pin!, b.getAttribute('aria-pressed') != 'true')
    was = ''
  })

  // A step as a line: a mark, what it asks, and how far it has come.
  let line = (s: Step, here: string) =>
    `<li class="Journal_Step${s.done ? ' Journal_Step-done' : ''}">${
      glyph(s.done ? 'done' : 'todo')
    }<span>${esc(told(s, here))}</span>${
      s.need ? `<em>${s.have ?? 0} / ${s.need}</em>` : ''
    }</li>`

  let task = (t: Task, here: string) => {
    let pin: Glyph = t.pinned ? 'pin' : 'pinOff'
    return `<article class="Journal_Task${
      t.pinned ? ' Journal_Task-pinned' : ''
    }"><header class=Journal_Top><b class=Journal_Title>${
      esc(t.title)
    }</b><button class="Orb Orb-small Journal_Pin" data-pin="${t.id}" aria-pressed=${t.pinned}${
      tipped(
        t.pinned
          ? {
            name: 'Tracked',
            says: 'On the glass and the compass. Tap to stop.',
          }
          : { name: 'Track it', says: 'Show it on the glass and the compass.' },
      )
    }>${glyph(pin)}</button></header><p class=Journal_From>${esc(t.from)} · ${
      esc(nameOf(t.level))
    } · ${esc(t.gives)}</p><ol class=Journal_Steps>${
      t.steps.map((s) => line(s, here)).join('')
    }</ol>${t.says ? `<p class=Journal_Says>${esc(t.says)}</p>` : ''}</article>`
  }

  return {
    /** show the journal, when it is open and what it shows changed */
    show: (tasks: Task[], here: string) => {
      if (!panel.open) return
      let taken = tasks.filter((t) => t.state == 'taken')
        .sort((a, b) => Number(b.pinned) - Number(a.pinned))
      let open = tasks.filter((t) => t.state == 'open')
      let done = tasks.filter((t) => t.state == 'done')
      let offer = (t: Task) =>
        `<li class=Journal_Offer><b>${esc(t.title)}</b><span>${
          esc(told(t.steps[0], here))
        }</span></li>`
      let html = `<div class=Journal>` +
        `<h3 class=Journal_Head>Under way</h3>${
          taken.map((t) => task(t, here)).join('') ||
          '<p class=Journal_None>Nothing yet. Whoever has a ! over their head has a job for you.</p>'
        }` +
        (open.length
          ? `<h3 class=Journal_Head>On offer</h3><ul class=Journal_Offers>${
            open.map(offer).join('')
          }</ul>`
          : '') +
        (done.length
          ? `<h3 class=Journal_Head>Done</h3><ul class=Journal_Done>${
            done.map((t) =>
              `<li>${glyph('done')}<span>${esc(t.title)}</span></li>`
            ).join('')
          }</ul>`
          : '') +
        `</div>`
      panel.head(
        `Journal <small class=Panel_Note>${done.length} done</small>`,
      )
      if (html == was) return
      was = html
      panel.body.innerHTML = html
    },
  }
}
