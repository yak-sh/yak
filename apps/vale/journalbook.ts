// The journal's quest list and detail, with page-graph selection and disclosure.
import { h } from 'preact'
import { Button, Rows, Tile } from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import { type Glyph, glyph } from './glyphs.ts'
import { landsOf, nameOf, next, type Step, type Task, told } from './journal.ts'
import { type PageState, pageState } from './page-state.ts'
import type { Page } from './panel.ts'
import { picture as plate } from './tile.ts'
import { split } from './ui/split.ts'

export type Acts = { pin: (task: string, on: boolean) => void }

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
  let picture = (icon: Glyph, className = '') =>
    h('span', {
      class: className,
      'aria-hidden': 'true',
      dangerouslySetInnerHTML: { __html: glyph(icon) },
    })
  // A quest's state, as its icon and the icon's tone; its group's heading
  // and its next step say it in words.
  let status = (t: Task): [Glyph, string] =>
    t.state == 'done'
      ? ['done', 'positive']
      : t.state == 'open'
      ? ['notices', 'caution']
      : !next(t)?.need
      ? ['handHeart', 'accent']
      : ['journal', 'info']
  let line = (s: Step) =>
    h(
      'li',
      { class: `Journal_Step${s.done ? ' Journal_Step-done' : ''}` },
      picture(
        s.done ? 'done' : s.fell ? 'blow' : s.giver ? 'handHeart' : 'backpack',
      ),
      h('span', {}, told(s, here)),
      s.need ? h('em', {}, `${s.have ?? 0} / ${s.need}`) : null,
    )
  let task = (t: Task) => {
    let tracked = t.state == 'taken' || t.pinned
    return h(
      'article',
      { class: 'Journal_Task' },
      h(
        'header',
        { class: 'Journal_Top' },
        h('b', { class: 'Journal_Title' }, t.title),
        tracked && t.state != 'done'
          ? h(Button, {
            class: 'Orb Orb-small Journal_Pin',
            'data-pin': t.id,
            'aria-label': t.pinned ? 'Stop tracking' : 'Track it',
            'aria-pressed': t.pinned,
            'data-tip': t.pinned ? 'Tracked' : 'Track it',
            onClick: () => acts.pin(t.id, !t.pinned),
          }, picture(t.pinned ? 'pin' : 'pinOff'))
          : null,
      ),
      h(
        'p',
        { class: 'Journal_From' },
        `${t.from} · ${nameOf(t.level)} · ${t.gives}`,
      ),
      h('ol', { class: 'Journal_Steps' }, t.steps.map(line)),
      t.says ? h('p', { class: 'Journal_Says' }, t.says) : null,
    )
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
      plate(glyph(icon), { mod: tone }),
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
  let group = (title: string, rows: Task[], picked?: string) => [
    h('h3', { class: 'Journal_Head' }, title),
    h(Rows, {}, rows.map((t) => summary(t, picked))),
  ]
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
      { class: 'Journal' },
      lands.map(({ level, taken, open, done }) =>
        h(
          'section',
          { key: level, class: 'Journal_Land' },
          h(
            'h2',
            { class: 'Journal_Head' },
            picture('mountain'),
            ` ${nameOf(level)}${level == here ? ' · Here' : ''}`,
          ),
          taken.length ? group('Under way', taken, picked) : null,
          open.length ? group('On offer', open, picked) : null,
          done.length
            ? h(Disclosure, {
              e: state.row(section(level)),
              class: 'Journal_Completed',
              summary: [picture('done'), `Completed · ${done.length}`],
              summaryProps: {
                class: 'Journal_Head Journal_Toggle',
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
      lands.length ? null : h('p', { class: 'Journal_None' }, 'No quests yet.'),
    )
    panes.render(
      rows,
      selected ? h('div', { class: 'Journal' }, task(selected)) : h(
        'p',
        { class: 'Journal_None' },
        'Select a task to see its steps and rewards.',
      ),
      picked ?? null,
    )
  }
  return {
    show: (latest: Task[], level: string) => {
      tasks = latest
      here = level
      draw()
    },
  }
}
