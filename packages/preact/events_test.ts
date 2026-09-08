import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { type Action, type Bundle, define, type Renderer } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { type ComponentRenderer, render } from './mod.ts'
import { mount } from './harness.ts'

let vocab = loadVocab([{
  $defs: { doc: { type: 'object', properties: { title: { type: 'string' } } } },
}])
let bundle: Bundle = { entity: { eid: 'a' }, doc: { title: 'Before' } }
let change = (control: Element) => {
  let Event = control.ownerDocument.defaultView!.Event
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

Deno.test('action-valued changes deliver control values and preserve the bundle', () => {
  let inputs: unknown[] = []
  let act: Action = {
    name: 'Update',
    run: (source, value) => {
      assertEquals(source === bundle, true)
      inputs.push(value)
      return { doc: { title: value } }
    },
  }
  let registry = define([{
    view: 'Edit',
    match: true,
    render: (_b, h, ctx) =>
      h(String(ctx.tag), { type: ctx.type, onChange: act }),
  }])
  for (
    let [tag, type, value] of [
      ['input', 'text', 'After'],
      ['input', 'number', '42'],
      ['input', 'checkbox', true],
      ['textarea', undefined, '{"a":1}'],
    ] as const
  ) {
    let patches: unknown[] = []
    let mounted = mount(render(registry, bundle, 'Edit', vocab, {
      tag,
      type,
      onPatch: (patch, source) => {
        assertEquals(source === bundle, true)
        patches.push(patch)
      },
    }))
    try {
      let control = mounted.root.firstElementChild! as HTMLInputElement
      if (type == 'checkbox') control.checked = value as boolean
      else control.value = value as string
      change(control)
      assertEquals(inputs.at(-1), value)
      assertEquals(patches, [{ doc: { title: value } }])
      assertEquals(bundle.doc, { title: 'Before' })
    } finally {
      mounted.free()
    }
  }
})

Deno.test('failed actions report validity and a successful edit clears it', () => {
  let errors: unknown[] = []
  let patches: unknown[] = []
  let validity: string[] = []
  let reported = 0
  let failure = new Error('Enter a title')
  let registry = define([{
    view: 'Edit',
    match: true,
    render: (_b, h) =>
      h('input', {
        onChange: {
          name: 'Update',
          run: (_bundle: Bundle, value: unknown) => {
            if (!value) throw failure
            return { doc: { title: value } }
          },
        },
      }),
  }])
  let mounted = mount(render(registry, bundle, 'Edit', vocab, {
    onPatch: (patch) => patches.push(patch),
    onError: (error, source) => {
      assertEquals(source === bundle, true)
      errors.push(error)
    },
  }))
  try {
    let control = mounted.root.querySelector('input')!
    control.setCustomValidity = (message) => validity.push(message)
    control.reportValidity = () => (++reported, false)
    change(control)
    assertEquals(errors, [failure])
    assertEquals(patches, [])
    assertEquals(validity, ['Enter a title'])
    assertEquals(reported, 1)
    control.value = 'After'
    change(control)
    assertEquals(validity, ['Enter a title', ''])
    assertEquals(patches, [{ doc: { title: 'After' } }])
  } finally {
    mounted.free()
  }
})

Deno.test('ordinary handlers keep the host event', () => {
  let seen: Event[] = []
  let registry = define([{
    view: 'Edit',
    match: true,
    render: (_b, h) => h('input', { onChange: (e: Event) => seen.push(e) }),
  }])
  let mounted = mount(render(registry, bundle, 'Edit', vocab))
  try {
    change(mounted.root.querySelector('input')!)
    assertEquals(seen.length, 1)
    assertEquals(seen[0].type, 'change')
  } finally {
    mounted.free()
  }
})

Deno.test('nested views use the same registry, context and native source props', () => {
  type Ent = { eid: string; title: string }
  let source: Ent = { eid: 'a', title: 'Native' }
  let props: Renderer = {
    view: 'Props',
    match: true,
    render: (_b, h, ctx) =>
      h(
        'div',
        null,
        ctx.render?.('Form.Editor', { col: 'title', suffix: '!' }),
      ),
  }
  let editor: ComponentRenderer<Ent> = {
    view: 'Edit',
    match: parse('.column.type=string'),
    Render: ({ e, comp, col, suffix, extra }) => {
      assertEquals(e === source, true)
      assertEquals([comp, col, extra], ['doc', 'title', 'kept'])
      return h('strong', null, e.title + suffix)
    },
  }
  let registry = define([props, editor], { aliases: { Editor: 'Edit' } })
  let mounted = mount(render(
    registry,
    bundle,
    'Props',
    vocab,
    { comp: 'doc', suffix: '?' },
    { e: source, extra: 'kept' },
  ))
  try {
    assertEquals(mounted.root.innerHTML, '<div><strong>Native!</strong></div>')
  } finally {
    mounted.free()
  }
})
