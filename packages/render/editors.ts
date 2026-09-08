/** The portable Edit family: declarations select controls, hosts apply actions. */

import { parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { declared, writable } from './column.ts'
import { edit, type EditOptions } from './edit.ts'
import type { Renderer } from './types.ts'

let controls = [
  { types: 'string,url,query', tag: 'input', type: 'text' },
  { types: 'number,priority', tag: 'input', type: 'number' },
  { types: 'enum', tag: 'select' },
  { types: 'ref', tag: 'input', type: 'text' },
  { types: 'time', tag: 'input', type: 'text' },
  { types: 'boolean', tag: 'input', type: 'checkbox' },
  { types: 'json', tag: 'textarea' },
]

/** Register these alongside entity views; column overlays use ordinary queries. */
export let editors = (vocab: Vocab, options: EditOptions = {}): Renderer[] =>
  controls.map(({ types, tag, type }) => ({
    view: 'Edit',
    match: parse(`.column.type=${types}`),
    render: (bundle, h, ctx) => {
      let c = declared(vocab, ctx)
      let row = bundle[c.comp] as Record<string, unknown> | undefined
      let value = row?.[c.prop]
      let text = value == null ? '' : String(value)
      if (ctx.readOnly || !writable(vocab, c)) {
        let shown = value == null
          ? '—'
          : c.scalar == 'bool'
          ? value ? 'true' : 'false'
          : text
        return h(
          'span',
          { class: 'Edit', 'data-column': `${c.comp}.${c.prop}` },
          shown.split(/\r?\n/).map((line, i) =>
            i ? [h('br', null), line] : line
          ),
        )
      }
      let props: Record<string, unknown> = {
        class: 'Edit',
        'aria-label': `${c.comp}.${c.prop}`,
        title: c.description,
        onChange: edit(vocab, { comp: c.comp, col: c.prop }, options),
      }
      if (type) props.type = type
      if (type == 'number') props.step = 'any'
      if (type == 'checkbox') props.checked = !!value
      else props.value = text
      if (c.scalar == 'time') props.placeholder = 'YYYY-MM-DDTHH:mm:ssZ'
      if (tag == 'select') {
        // An enum can declare the empty string. Give absence a distinct control
        // value, translating it to null only at the action boundary.
        let empty = ''
        while (c.values!.includes(empty)) empty += '_'
        let action = edit(vocab, { comp: c.comp, col: c.prop }, options)
        props.value = value == null ? empty : text
        props.onChange = {
          ...action,
          run: (bundle, input) =>
            action.run(bundle, input === empty ? null : input),
        } satisfies typeof action
        return h(
          tag,
          props,
          h('option', { value: empty }, '—'),
          c.values!.map((value) => h('option', { value }, value)),
        )
      }
      return h(tag, props)
    },
  }))

/** A component's declared columns, including absent and read-only values. */
export let properties = (vocab: Vocab): Renderer => ({
  view: 'Props',
  match: true,
  render: (_bundle, h, ctx) => {
    let { comp } = ctx
    if (!comp || !vocab.comp(comp)) {
      throw new Error(`unknown component: ${comp ?? ''}`)
    }
    let render = ctx.render
    if (!render) throw new Error('Props needs a host with nested rendering')
    return h(
      'dl',
      { class: 'Props' },
      vocab.columns(comp).map((col) =>
        h(
          'div',
          { class: 'Props_Row', key: col },
          h('dt', null, col),
          h('dd', null, render('Edit', { comp, col })),
        )
      ),
    )
  },
})
