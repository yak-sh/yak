// The journal's quest list and detail, with page-graph selection and disclosure.
import { type ComponentChildren, h } from 'preact'
import { Button } from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import { type Glyph, glyph } from './glyphs.ts'
import { landsOf, nameOf, next, type Step, type Task, told } from './journal.ts'
import { type PageState, pageState } from './page-state.ts'
import type { Page } from './panel.ts'
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
  let status = (t: Task): [Glyph, string] =>
    t.state == 'done'
      ? ['done', 'Completed']
      : t.state == 'open'
      ? ['notices', 'On offer']
      : !next(t)?.need
      ? ['handHeart', 'Return to giver']
      : ['journal', 'Under way']
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
  let summary = (t: Task) => {
    let step = next(t), [icon, label] = status(t)
    return h(
      Button,
      {
        key: t.id,
        class: `Split_Row Journal_Row Journal_Row-${t.state}`,
        'data-select': t.id,
        onClick: () => {
          state.select(owner, t.id)
          draw()
        },
      },
      h(
        'span',
        { class: 'Journal_Label' },
        picture(icon, 'Journal_Status'),
        h('b', {}, t.title),
        t.pinned && t.state != 'done'
          ? picture('pin', 'Journal_Tracked')
          : null,
      ),
      h('small', { class: 'Journal_State' }, label),
      h(
        'small',
        {},
        t.state == 'done' ? t.gives : step
          ? told(step, here) +
            (step.need ? ` · ${step.have ?? 0} / ${step.need}` : '')
          : t.from,
      ),
    )
  }
  let group = (title: string, rows: Task[]): ComponentChildren => [
    h('h3', { class: 'Journal_Head' }, title),
    ...rows.map(summary),
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
          taken.length ? group('Under way', taken) : null,
          open.length ? group('On offer', open) : null,
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
            }, done.map(summary))
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
