/** The portable Edit family: property declarations select controls, and the
 * rendering backend applies the actions. */

import { parse } from '@yaks/query'
import type { Vocab } from '@yaks/vocab'
import { declared, writable } from './prop.ts'
import { edit, type EditOptions } from './edit.ts'
import type { Renderer } from './types.ts'

let controls = [
  { types: 'string,url,query', tag: 'input', type: 'text' },
  { types: 'number,priority', tag: 'input', type: 'number' },
  { types: 'enum', tag: 'select' },
  { types: 'ref', tag: 'input', type: 'text' },
  { types: 'time', tag: 'input', type: 'text' },
  { types: 'boolean', tag: 'input', type: 'checkbox' },
  { types: 'json,jsonb', tag: 'textarea' },
]

/** Register these alongside entity views; property overlays use ordinary
 * queries. */
export let editors = (vocab: Vocab, options: EditOptions = {}): Renderer[] =>
  controls.map(({ types, tag, type }) => ({
    view: 'Edit',
    match: parse(`.prop.type=${types}`),
    render: (bundle, h, ctx) => {
      let c = declared(vocab, ctx)
      let row = bundle[c.comp] as Record<string, unknown> | undefined
      let value = row?.[c.prop]
      // A JSON value shows as its JSON text, the text its editor parses back.
      let text = value == null
        ? ''
        : c.scalar == 'jsonb'
        ? JSON.stringify(value)
        : String(value)
      if (ctx.readOnly || !writable(vocab, c)) {
        let shown = value == null
          ? '—'
          : c.scalar == 'bool'
          ? value ? 'true' : 'false'
          : text
        return h(
          'span',
          { class: 'Edit', 'data-prop': `${c.comp}.${c.prop}` },
          shown.split(/\r?\n/).map((line, i) =>
            i ? [h('br', null), line] : line
          ),
        )
      }
      let action = edit(vocab, { comp: c.comp, prop: c.prop }, options)
      let props: Record<string, unknown> = {
        class: 'Edit',
        'aria-label': `${c.comp}.${c.prop}`,
        title: c.description,
        onChange: action,
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

/** A component's declared properties, including absent and read-only values. */
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
      vocab.props(comp).map((prop) =>
        h(
          'div',
          { class: 'Props_Row', key: prop },
          h('dt', null, prop),
          h('dd', null, render('Edit', { comp, prop })),
        )
      ),
    )
  },
})
