// The notice board in every village (props/village.ts `board`): what it
// holds for a hero, and its sheet (panel.ts). Its notices are the jobs of the
// land it stands in that the hero has not taken: each quest on offer there
// (quests.ts), and each job a villager pinned there that no hero has taken
// (deals.ts), with who gives it and where they stand now from the board. A
// hero who walks up to a board and works it (E, G, or the button) opens its
// sheet, as a station's opens (work.ts); it folds away when they walk off.
// Taking a quest from it pins it while it is on offer (rules.ts `questsOf`),
// so the journal, the glass, the map and the compass point the way to
// whoever gives it, who asks it of the hero in person. Taking a job agrees
// to it, and it is the hero's alone, to do and hand in as any deal. The
// papers pinned on a board are as many as its notices (papers.ts).
import { BEASTS } from './beasts.ts'
import type { View } from './deals.ts'
import { deal, quest, type Task, toward } from './journal.ts'
import type { Spot } from './levels.ts'
import type { Panel } from './panel.ts'
import type { Vec3 } from './play.ts'
import { GIVERS } from './quests.ts'
import type { Standing } from './rules.ts'
import { said } from './stock.ts'
import { builtNear, standAt, type Vale, villagesNear } from './terrain.ts'

let esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** How near a board a hero reads it, in metres from its foot. */
export let READ = 2.4

/** A notice board: where its foot stands, how many quarter turns it is
 * turned (terrain.ts `Prop`), and the land of the village that built it. */
export type Board = { at: Vec3; turn: number; level: string }

/** The notice boards within `r` metres of (x, z). */
export let boardsNear = (v: Vale, x: number, z: number, r: number): Board[] =>
  builtNear(x, z, r).filter((p) => p.kind == 'board').map((p) => ({
    at: [p.x, standAt(v, p), p.z],
    turn: p.turn ?? 0,
    level: villagesNear(p.x, p.z, Infinity)[0]?.level ?? '',
  }))

let WAYS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
]

/** Where spot `to` lies from spot `from`, as a notice says it: how far, and
 * which way, or close by.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(whence([0, 0], [0, -30]), '30 m north')
 * assertEquals(whence([0, 0], [20, 20]), '28 m south-east')
 * assertEquals(whence([0, 0], [2, 3]), 'close by')
 * ```
 */
export let whence = (from: Spot, to: Spot): string => {
  let d = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]))
  return d < 6
    ? 'close by'
    : `${d} m ${WAYS[Math.round(toward(from, to) / 45) % 8]}`
}

/** A notice: a job on offer, as a task (journal.ts), and where whoever
 * offers it stands from the board; and, for a job a villager pinned, the
 * deal it is. */
export type Notice = Task & { where: string; job?: View }

// What a job asks, as a notice says it.
let wanted = (v: View) =>
  v.take.map((x) => `${BEASTS[x.kind] ? 'Fell' : 'Bring'} ${said([x])}`)
    .join(' · ')

let levelOf = new Map(GIVERS.map((g) => [g.id, g.level]))

/** The notices on a board of level `level` for a hero standing with each
 * quest as `quests` says: each quest on offer there that they have not taken
 * or pinned, then each of the land's in `jobs`, the jobs nobody has taken.
 * `at` is where each giver on the level stands now, by id, and `from` where
 * the board stands.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { GIVERS, QUESTS } from './quests.ts'
 * import { questsOf } from './rules.ts'
 * import { said } from './stock.ts'
 * let q = QUESTS[0]
 * let on = (journal: { quest: string; step: string; at: number }[]) =>
 *   notices(questsOf(QUESTS, journal, [], []), 'mossvale', { [q.giver]: [0, -20] }, [0, 0])
 * let first = on([]).find((n) => n.id == q.id)!
 * assertEquals([first.title, first.where], [q.title, '20 m north'])
 * // taken, or pinned from the board, it is no longer on it
 * assertEquals(on([{ quest: q.id, step: 'pinned', at: 1 }]).some((n) => n.id == q.id), false)
 * assertEquals(on([{ quest: q.id, step: 'taken', at: 1 }]).some((n) => n.id == q.id), false)
 * // another land's quests are on that land's board
 * assertEquals(on([]).every((n) => n.level == 'mossvale'), true)
 * // and so is a job a villager of the land pinned there
 * let job = {
 *   eid: 'j', giver: GIVERS.find((g) => g.level == 'mossvale')!,
 *   give: [{ kind: 'coin', n: 5 }],
 *   take: [{ kind: 'slime', n: 2 }, { kind: 'tusk', n: 1 }],
 *   state: 'open' as const, ends: 0, steps: [], ready: false,
 * }
 * let board = notices([], 'mossvale', {}, [0, 0], [job])
 * let [slimes, tusk] = job.take.map((x) => said([x]))
 * assertEquals(board.map((n) => [n.job?.eid, n.says]), [
 *   ['j', `Fell ${slimes} · Bring ${tusk}`],
 * ])
 * // and not on another land's
 * let far = GIVERS.find((g) => g.level != 'mossvale')!.level
 * assertEquals(notices([], far, {}, [0, 0], [job]), [])
 * ```
 */
export let notices = (
  quests: Standing[],
  level: string,
  at: Record<string, Spot>,
  from: Spot,
  jobs: View[] = [],
): Notice[] => {
  let where = (t: Task) => at[t.giver] ? whence(from, at[t.giver]) : ''
  return [
    ...quests.filter((s) =>
      s.state == 'open' && !s.pinned && levelOf.get(s.quest.giver) == level
    ).map(quest),
    ...jobs.filter((v) => v.giver.level == level)
      .map((v) => ({ ...deal(v, false), says: wanted(v), job: v })),
  ].map((t) => ({ ...t, where: where(t) }))
}

export type Acts = { take: (n: Notice) => void }

/** The board's sheet, in its `panel`: a notice a card, each with what it
 * gives and a button to take it. */
export let noticeboard = (panel: Panel, acts: Acts) => {
  let shown: Notice[] = []
  let was = ''
  panel.body.addEventListener('click', (e) => {
    let b = e.target instanceof Element
      ? e.target.closest<HTMLElement>('[data-take]')
      : null
    let n = shown.find((n) => n.id == b?.dataset.take)
    if (n) acts.take(n)
  })

  let card = (n: Notice) =>
    `<article class=Notice><b class=Notice_Title>${
      esc(n.title)
    }</b><p class=Notice_From>${esc(n.from)}${
      n.where ? ` · ${esc(n.where)}` : ''
    }</p>${
      n.says ? `<p class=Notice_Says>${esc(n.says)}</p>` : ''
    }<footer class=Notice_Foot><span class=Notice_Gives>${
      esc(n.gives)
    }</span><button class="Btn Btn-go" data-take="${
      esc(n.id)
    }">Take it</button></footer></article>`

  return {
    get open() {
      return panel.open
    },
    /** open the sheet, or fold it away */
    toggle: () => {
      was = ''
      panel.toggle()
    },
    close: panel.close,
    /** show the board's notices, when the sheet is open and they changed */
    show: (list: Notice[]) => {
      if (!panel.open) return
      shown = list
      panel.head(
        `Notice board <small class=Panel_Note>${list.length} ${
          list.length == 1 ? 'notice' : 'notices'
        }</small>`,
      )
      let html = `<div class=Notices>${
        list.map(card).join('') ||
        '<p class=Notices_None>Nothing is pinned here just now.</p>'
      }</div>`
      if (html == was) return
      was = html
      panel.body.innerHTML = html
    },
  }
}
