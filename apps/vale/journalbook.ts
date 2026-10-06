// The journal's quest list and detail, with page-graph selection and
// disclosure. Each land is a Section, its quests under way and on offer a
// list each, its completed ones folded away until asked for; a quest picked
// heads its page with its state's icon, quotes what its giver said, then
// the steps it asks and what it gives.
import { h } from 'preact'
import { Body, Button, Quote, Rows, Section, Tile } from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import { type Glyph, glyph } from './glyphs.ts'
import { landsOf, nameOf, next, type Task, told } from './journal.ts'
import { type PageState, pageState } from './page-state.ts'
import type { Page } from './panel.ts'
import { head, hint, mark, part, picture, steps } from './tile.ts'
import { split } from './ui/split.ts'

export type Acts = { pin: (task: string, on: boolean) => void }

// A quest's state, as its icon and the icon's tone; its group's heading and
// its next step say it in words.
let status = (t: Task): [Glyph, string] =>
  t.state == 'done'
    ? ['done', 'positive']
    : t.state == 'open'
    ? ['notices', 'caution']
    : !next(t)?.need
    ? ['handHeart', 'accent']
    : ['journal', 'info']

/** A quest's page under its head: what its giver said, the steps it asks,
 * and what it gives. A notice on the board reads the same. */
export let questPage = (t: Task, here: string) => [
  t.says && h(Quote, {}, h(Quote.Text, {}, t.says)),
  steps(t.steps.map((s) => ({
    icon: s.fell ? 'blow' : s.giver ? 'handHeart' : 'backpack',
    words: told(s, here),
    have: s.have,
    need: s.need,
    done: s.done,
  }))),
  part('Reward', h(Body, {}, h('p', {}, t.gives))),
]

/** The journal, drawn into its tab (panel.ts). */
export let journal = (
  panel: Page,
  acts: Acts,
  state: PageState = pageState(),
  owner = 'journal',
) => {
  let panes = split(panel.body)
  let tasks: Task[] = [], here = ''
  let section = (level: string) =>
    disclosureAt(`${state.owner}|${owner}|${level}`)
  let task = (t: Task) => {
    let [icon, tone] = status(t)
    let tracked = t.state == 'taken' || t.pinned
    return [
      head(
        picture(glyph(icon), { mod: tone }),
        t.title,
        [`${t.from} · ${nameOf(t.level)}`],
        tracked && t.state != 'done' &&
          h(Button, {
            mod: 'quiet',
            'data-pin': t.id,
            'aria-label': t.pinned ? 'Stop tracking' : 'Track it',
            'aria-pressed': t.pinned,
            'data-tip': t.pinned ? 'Tracked' : 'Track it',
            onClick: () => acts.pin(t.id, !t.pinned),
          }, mark(t.pinned ? 'pin' : 'pinOff')),
      ),
      ...questPage(t, here),
    ]
  }
  let summary = (t: Task, picked?: string) => {
    let step = next(t), [icon, tone] = status(t)
    let detail = t.state == 'done' ? t.gives : step
      ? told(step, here) +
        (step.need ? ` · ${step.have ?? 0} / ${step.need}` : '')
      : t.from
    return h(
      Tile,
      {
        key: t.id,
        mod: t.id == picked && 'on',
        'data-select': t.id,
        onClick: () => {
          state.select(owner, t.id)
          draw()
        },
      },
      picture(glyph(icon), { mod: tone }),
      h(Tile.Title, {}, t.title),
      h(Tile.Sub, {}, detail),
      t.pinned && t.state != 'done'
        ? h(Tile.End, {
          'aria-label': 'Tracked',
          dangerouslySetInnerHTML: { __html: glyph('pin') },
        })
        : null,
    )
  }
  let group = (title: string, rows: Task[], picked?: string) =>
    part(title, h(Rows, {}, rows.map((t) => summary(t, picked))))
  let draw = () => {
    if (!panel.open) return
    let lands = landsOf(tasks, here)
    let picked = state.cursor(owner)
    let selected = tasks.find((t) =>
      t.id == picked && t.state != 'locked' &&
      (t.state != 'done' || isOpen(state.row(section(t.level))))
    )
    if (!selected && picked) {
      state.select(owner, null)
      picked = undefined
    }
    let rows = h(
      'div',
      { class: 'Pack' },
      lands.map(({ level, taken, open, done }) =>
        h(
          Section,
          { key: level, class: 'Journal_Land' },
          h(
            Section.Title,
            {},
            mark('mountain'),
            nameOf(level),
            level == here && h(Section.Note, {}, 'Here'),
          ),
          taken.length ? group('Under way', taken, picked) : null,
          open.length ? group('On offer', open, picked) : null,
          done.length
            ? h(Disclosure, {
              e: state.row(section(level)),
              summary: [mark('done'), `Completed · ${done.length}`],
              summaryProps: {
                mod: 'quiet',
                class: 'Journal_Completed',
                'data-completed': level,
              },
              onChange: (bundle) => {
                state.mutate([bundle])
                draw()
              },
            }, h(Rows, {}, done.map((t) => summary(t, picked))))
            : null,
        )
      ),
      lands.length ? null : hint('No quests yet.'),
    )
    panes.render(
      rows,
      selected
        ? task(selected)
        : hint('Select a task to see its steps and rewards.'),
      picked ?? null,
    )
  }
  let drawn = ''
  return {
    /** Show this frame's tasks, the hero in `level`. It runs every frame,
     * so drawing the journal again when nothing it shows has changed is a
     * bug: it draws as it opens and as the tasks or the land change, and a
     * pick draws it itself. A frame makes its tasks afresh, so they are
     * compared by what they say. */
    show: (latest: Task[], level: string) => {
      tasks = latest
      here = level
      if (!panel.open) return void (drawn = '')
      let key = JSON.stringify([latest, level])
      if (key == drawn) return
      drawn = key
      draw()
    },
  }
}
