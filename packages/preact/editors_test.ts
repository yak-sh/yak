import { assertEquals, assertStringIncludes } from '@std/assert'
import { hydrate } from 'preact'
import { type Bundle, define, editors, properties } from '@yaks/render'
import { render as html } from '@yaks/html'
import { render as text } from '@yaks/text'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { render } from './mod.ts'
import { mount } from './harness.ts'

let vocab = loadVocab({
  $defs: {
    doc: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
        state: { enum: ['open', 'done'] },
        owner: { type: 'string', ref: 'entity', death: 'detach' },
        at: { type: 'string', format: 'date-time' },
        enabled: { type: 'boolean' },
        data: { type: 'string', format: 'json' },
        absent: { type: 'string' },
      },
    },
  },
})
let bundle: Bundle = {
  entity: { eid: 'a' },
  doc: {
    title: 'A <page>',
    count: 0,
    state: 'done',
    owner: 'b',
    at: '2026-09-08T12:30:00.000Z',
    enabled: false,
    data: '{"count":2}',
  },
}
let registry = define([...editors(vocab), properties(vocab)])
let context = { comp: 'doc' }
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
let field = (root: Element, col: string): Control =>
  root.querySelector<Control>(`[aria-label="doc.${col}"]`)!
let changed = (control: Control) => {
  let Event = control.ownerDocument.defaultView!.Event
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

Deno.test('Props lays out every column with the matching editor and current value', () => {
  let mounted = mount(render(registry, bundle, 'Props', vocab, context))
  try {
    assertEquals(
      [...mounted.root.querySelectorAll('dt')].map((el) => el.textContent),
      vocab.columns('doc'),
    )
    for (
      let [col, tag, value] of [
        ['title', 'input', 'A <page>'],
        ['count', 'input', '0'],
        ['owner', 'input', 'b'],
        ['at', 'input', '2026-09-08T12:30:00.000Z'],
        ['data', 'textarea', '{"count":2}'],
        ['absent', 'input', ''],
      ]
    ) {
      let control = field(mounted.root, col)
      assertEquals([control.localName, control.value], [tag, value], col)
    }
    assertEquals(
      !!(field(mounted.root, 'enabled') as HTMLInputElement).checked,
      false,
    )
    assertEquals(
      [...mounted.root.querySelectorAll('option')].map((el) => el.value),
      ['', 'open', 'done'],
    )
  } finally {
    mounted.free()
  }
})

Deno.test('mounted editors emit typed patches and reject invalid JSON', () => {
  let patches: unknown[] = []
  let errors: unknown[] = []
  let mounted = mount(render(registry, bundle, 'Props', vocab, {
    ...context,
    onPatch: (patch) => patches.push(patch),
    onError: (error) => errors.push(error),
  }))
  try {
    let count = field(mounted.root, 'count')
    count.value = '12.5'
    changed(count)
    let state = field(mounted.root, 'state') as HTMLSelectElement
    state.querySelector<HTMLOptionElement>('[value="open"]')!.selected = true
    changed(state)
    let enabled = field(mounted.root, 'enabled') as HTMLInputElement
    enabled.checked = true
    changed(enabled)
    enabled.checked = false
    changed(enabled)
    let data = field(mounted.root, 'data')
    data.value = '{'
    changed(data)
    assertEquals(errors.length, 1)
    assertStringIncludes(String(errors[0]), 'doc.data')
    data.value = '[false,0]'
    changed(data)
    assertEquals(patches, [
      { doc: { count: 12.5 } },
      { doc: { state: 'open' } },
      { doc: { enabled: true } },
      { doc: { enabled: false } },
      { doc: { data: '[false,0]' } },
    ])
    assertEquals((bundle.doc as Record<string, unknown>).count, 0)
  } finally {
    mounted.free()
  }
})

Deno.test('HTML keeps editor values through hydration without exposing actions', () => {
  assertStringIncludes(
    html(registry, bundle, 'Props', vocab, context),
    '{&quot;count&quot;:2}</textarea>',
  )
  // LinkeDOM leaves textarea character references encoded; this fixture also
  // exercises hydration's value retention without relying on its RCDATA parser.
  let source = {
    ...bundle,
    doc: { ...bundle.doc as object, data: '[false,0]' },
  }
  let markup = html(registry, source, 'Props', vocab, context)
  assertEquals(/onChange|\[object Object\]|set doc/.test(markup), false)
  let mounted = mount(null)
  try {
    mounted.root.innerHTML = markup
    let check = () => {
      assertEquals(field(mounted.root, 'state').value, 'done')
      assertEquals(field(mounted.root, 'data').value, '[false,0]')
      assertEquals(field(mounted.root, 'title').value, 'A <page>')
      assertEquals(
        field(mounted.root, 'enabled').hasAttribute('checked'),
        false,
      )
    }
    check()
    hydrate(render(registry, source, 'Props', vocab, context), mounted.root)
    check()
  } finally {
    mounted.free()
  }
})

Deno.test('text Props uses read-only values and registry editor overrides', () => {
  let custom = define([{
    view: 'Edit',
    match: parse('.column.comp=doc, .column.col=title'),
    render: (_b, h) => h('strong', null, 'Custom title'),
  }, ...registry.renderers])
  assertEquals(
    text(custom, bundle, 'Props', vocab, {
      ...context,
      readOnly: false,
      onPatch: () => {
        throw new Error('text must not apply edits')
      },
    }, 'plain'),
    [
      'title: Custom title',
      'count: 0',
      'state: done',
      'owner: b',
      'at: 2026-09-08T12:30:00.000Z',
      'enabled: false',
      'data: {"count":2}',
      'absent: —',
    ].join('\n'),
  )
  let missing = { entity: { eid: 'a' }, doc: { enabled: null } }
  assertEquals(
    text(registry, missing, 'Edit', vocab, { comp: 'doc', col: 'enabled' }),
    '—',
  )
  let mounted = mount(render(custom, bundle, 'Props', vocab, context))
  try {
    assertEquals(
      mounted.root.querySelector('dd')?.innerHTML,
      '<strong>Custom title</strong>',
    )
  } finally {
    mounted.free()
  }
})
