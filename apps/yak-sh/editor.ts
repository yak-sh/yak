// The entity a reader opened, from anywhere on the page: what the prompt's
// `graph show` prints for it, as a panel of its components and their
// properties that the reader can change. Opening it and changing it are typed
// into the prompt, so a click and a command are the same act, and a change
// redraws whatever on the page is drawn from that entity.
import { type FunctionComponent, h } from 'preact'
import { useState } from 'preact/hooks'
import { human } from '@yaks/id'
import type { Bundle } from '@yaks/graph'
import type { Ctx } from './views.ts'
import { useTold } from './told.ts'

/** A word the prompt reads as one argument, whatever it holds. */
export let quote = (s: string) => `'${s.replace(/[\\']/g, '\\$&')}'`

/** A value written as the query grammar writes one in a patch. */
let literal = (v: string | number) =>
  typeof v == 'number' ? String(v) : `"${v.replace(/[\\"]/g, '\\$&')}"`

/** How the prompt names an entity: its short id, or its eid when it has no
 * number to type. */
export let refOf = (b: Bundle, vocab: Ctx['yak']['vocab']) =>
  b.entity.num == null ? b.entity.eid : human(vocab)(b)

/** The line that sets `comp.prop` of the entity the prompt calls `ref`. */
export let patchLine = (
  ref: string,
  comp: string,
  prop: string,
  v: string | number,
) => `graph apply ${ref} ${quote(`.${comp}.${prop}=${literal(v)}`)}`

/** Open an entity: show it in the panel and type `graph show` for it. */
export let opener = ({ yak, term, figure }: Ctx) => (eid: string) => {
  let b = yak.row(eid)
  if (!b) return
  figure.pick(eid)
  term.enter(`graph show ${refOf(b, yak.vocab)}`)
}

/** The entity under a click inside `within`, by the `data-eid` it carries. */
export let clicked = (ev: Event, within: Element) => {
  let el = (ev.target as Element | null)?.closest?.('[data-eid]')
  return el && within.contains(el) && el != within
    ? el.getAttribute('data-eid') ?? undefined
    : undefined
}

// One property, changed in place: a line for a short string or a number, a
// box for long text; the change is typed into the prompt once the reader
// leaves the field or presses Enter (with Ctrl or Cmd in a box).
let Field: FunctionComponent<
  { value: string | number; set: (v: string | number) => void; name: string }
> = ({ value, set, name }) => {
  let [draft, write] = useState<string | null>(null)
  let shown = draft ?? String(value)
  let long = typeof value == 'string' &&
    (value.includes('\n') || value.length > 56)
  // What the field holds when the reader leaves it is what they wrote.
  let done = (ev: Event) => {
    let typed = (ev.currentTarget as HTMLInputElement).value
    write(null)
    let v = typeof value == 'number' ? Number(typed) : typed
    if (v !== value && !(typeof v == 'number' && isNaN(v))) set(v)
  }
  return h(long ? 'textarea' : 'input', {
    class: 'Editor_Field',
    'aria-label': name,
    value: shown,
    rows: long ? Math.min(12, shown.split('\n').length + 1) : undefined,
    spellcheck: false,
    inputMode: typeof value == 'number' ? 'decimal' : undefined,
    onInput: (ev: Event) => write((ev.currentTarget as HTMLInputElement).value),
    onBlur: done,
    onKeyDown: (ev: KeyboardEvent) => {
      if (ev.key == 'Escape') write(null)
      if (ev.key == 'Enter' && (!long || ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault()
        done(ev)
      }
    },
  })
}

export let Editor: FunctionComponent<Ctx> = (ctx) => {
  let { yak, term, figure } = ctx
  useTold(figure.listen)
  useTold((l) => yak.watch('*', l))
  let eid = figure.picked()
  let b = eid ? yak.row(eid) : undefined
  if (!b) return null
  let ref = refOf(b, yak.vocab)
  let comps = Object.keys(b).filter((k) =>
    k != 'entity' && !k.startsWith('$') && b[k] && typeof b[k] == 'object'
  )
  let title = String((b.doc as { title?: string } | undefined)?.title ?? '')
  return h('aside', {
    class: 'Editor',
    'aria-label': `${human(yak.vocab)(b)} in the graph in this tab`,
  }, [
    h('div', { class: 'Editor_Bar' }, [
      h('b', null, human(yak.vocab)(b)),
      h('span', null, title),
      h('button', {
        type: 'button',
        'aria-label': 'Close',
        onClick: () => figure.pick(undefined),
      }, '×'),
    ]),
    h(
      'p',
      { class: 'Editor_Hint' },
      'Change a value and the prompt runs graph apply. It changes the graph in this tab only, and reloading starts over.',
    ),
    ...comps.map((comp) => {
      let value = b[comp] as Record<string, unknown>
      let props = yak.vocab.props(comp)
      let fixed = !!yak.vocab.comp(comp)?.mark
      return h('section', { class: 'Editor_Comp', key: comp }, [
        h('h3', null, `${comp}{${props.join(', ')}}`),
        h(
          'dl',
          null,
          Object.entries(value).map(([prop, v]) => {
            // A property the vocabulary declares, not one computed on read
            // such as a task's status, and not a stamped mark.
            let open = !fixed && props.includes(prop) &&
              (typeof v == 'string' || typeof v == 'number')
            let other = typeof v == 'string' && yak.row(v)
            return h('div', { class: 'Editor_Prop', key: prop }, [
              h('dt', null, prop),
              h(
                'dd',
                null,
                other
                  ? h('button', {
                    type: 'button',
                    class: 'Editor_Ref',
                    onClick: () => opener(ctx)(v as string),
                  }, human(yak.vocab)(other))
                  : open
                  ? h(Field, {
                    value: v as string | number,
                    name: `${comp}.${prop}`,
                    set: (next) => term.enter(patchLine(ref, comp, prop, next)),
                  })
                  : h('code', null, JSON.stringify(v)),
              ),
            ])
          }),
        ),
      ])
    }),
  ])
}
