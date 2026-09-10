import { define, resolve } from '@yaks/render'
import { assert, assertEquals } from '@std/assert'
import { render } from '@yaks/preact'
import { vocab } from './store.ts'
import type { Bundle } from '@yaks/graph'
import { mount } from '../tui/harness.ts'
import { transcriptViews } from './transcript.ts'

Deno.test('transcript dims sequence and tool prose and colors each entry kind', async () => {
  let kinds = [
    'input',
    'output',
    'ask',
    'call',
    'result',
    'error',
    'exception',
    'stop',
    'entry',
  ]
  for (let kind of kinds) {
    let entry: Bundle = {
      entity: { eid: 'e' },
      entry: { session: 's', seq: 7 },
    }
    if (kind == 'input' || kind == 'output') {
      entry.content = {
        body: 'first line\nsecond line',
        ...(kind == 'output' ? { source: 'ask' } : {}),
      }
    } else {
      entry.content = { body: 'first line\nsecond line' }
      if (kind != 'entry') entry[kind] = {}
      else delete entry.content
    }
    let ui = await mount(
      () => render(transcriptViews, entry, 'Transcript', vocab),
      80,
      8,
    )
    try {
      assert(
        ui.text().includes(
          kind == 'entry'
            ? '7 entry'
            : kind == 'input' || kind == 'output'
            ? '7 ' + kind
            : '7 ' + kind.padEnd(9) + ' first line',
        ),
        ui.text(),
      )
      if (kind != 'entry') assert(ui.text().includes('second line'))
      let ansi = ui.out.join('')
      assert(ansi.includes('\x1b[38;2;122;132;120;2m  7\x1b[0m'), ansi)
      assert(ansi.includes(kind.padEnd(9) + '\x1b[0m'), ansi)
      assertEquals(
        ansi.includes('\x1b[38;2;122;132;120;2mfirst line'),
        kind == 'result',
      )
    } finally {
      ui.free()
    }
  }
})

Deno.test('queries outrank generic rows; overlapping facets use declared tie order', () => {
  let entry: Bundle = {
    entity: { eid: 'e' },
    entry: { seq: 1 },
    content: { body: 'text', source: 'ask' },
  }
  // Put the generic row first: only specificity can beat it.
  let registry = define([
    transcriptViews.renderers.at(-1)!,
    ...transcriptViews.renderers,
  ])
  assertEquals(
    resolve(registry, entry, 'Transcript', vocab),
    transcriptViews.renderers.find((r) =>
      r.match !== true &&
      r.match.clauses.length == 2 &&
      r.match.clauses.some((c) => JSON.stringify(c).includes('source'))
    ),
  )
  // Production order resolves equally specific facets deliberately, not kindOf.
  for (
    let [facets, label, color] of [
      [{}, 'output', 'Accent'],
      [{ result: {} }, 'result', 'Muted'],
      [{ result: {}, error: {} }, 'error', 'Bad'],
      [{ call: {}, content: { body: 'args' } }, 'call', 'Key'],
    ] as const
  ) {
    let node = render(
      transcriptViews,
      { ...entry, ...facets },
      'Transcript',
      vocab,
    )!
    let children = node.props.children as {
      props?: { children?: unknown; class?: string }
    }[]
    assertEquals(children[2].props?.children, [label.padEnd(9)])
    assertEquals(children[2].props?.class, color)
  }
})

Deno.test('message markdown is semantic ANSI while tool results remain literal', async () => {
  let source =
    '# Heading\n\n**bold** and *italic* and `code`\n\n- item\n\n[x](javascript:alert)\n\n<script>bad</script>'
  for (let result of [false, true]) {
    let entry: Bundle = {
      entity: { eid: 'md' },
      entry: { session: 's', seq: 1 },
      content: { body: source, source: 'ask' },
      ...(result ? { result: { call: 'call' } } : {}),
    }
    let ui = await mount(
      () => render(transcriptViews, entry, 'Transcript', vocab),
      80,
      20,
    )
    try {
      let text = ui.text()
      let ansi = ui.out.join('')
      assertEquals(text.includes('**bold**'), result, text)
      assert(text.includes('<script>bad</script>'), text)
      if (!result) {
        assert(ansi.includes('\x1b[1mbold'), ansi)
        assert(ansi.includes('\x1b[3mitalic'), ansi)
        assert(text.includes('• item'), text)
      }
      assert(!ansi.includes('\x1b]8;;javascript:'))
    } finally {
      ui.free()
    }
  }
})

Deno.test('user inputs share composer borders, machine entries do not', async () => {
  for (
    let [extra, boxed] of [
      [{}, true],
      [{ content: { body: 'hello', source: 'ask' } }, false],
      [{ notice: {} }, false],
      [{ result: { call: 'c' } }, false],
      [{ using: { model: 'm' } }, false],
      [{ entity: { eid: 'delivery:child:last' } }, false],
    ] as [Partial<Bundle>, boolean][]
  ) {
    let entry: Bundle = {
      entity: { eid: 'user' },
      entry: { seq: 1, session: 's' },
      content: {
        body: '**hello**\n\nlong message wrapping across the narrow viewport',
      },
      ...extra,
    }
    let ui = await mount(
      () => render(transcriptViews, entry, 'Transcript', vocab),
      28,
      12,
    )
    try {
      assertEquals(ui.text().includes('╭'), boxed, ui.text())
      assert(ui.text().includes('hello'), ui.text())
      if (boxed) {
        assert(ui.out.join('').includes('\x1b[38;2;122;132;120;2m╭'))
        assert(!ui.text().includes('**hello**'))
      }
    } finally {
      ui.free()
    }
  }
})

Deno.test('attachment renderer reserves lazy image cells only with explicit graphics configuration', async () => {
  let loads = 0
  let entry = {
    entity: { eid: 'image-entry' },
    entry: { session: 's', seq: 1 },
    attachment: { artifact: 'artifact:test' },
    content: { body: 'Image artifact:test' },
  }
  for (let inlineImages of [false, true]) {
    let ui = await mount(
      () =>
        render(transcriptViews, entry, 'Transcript', vocab, {
          inlineImages,
          image: () => {
            loads++
            return Promise.resolve(new Uint8Array())
          },
        }),
      40,
      10,
    )
    try {
      assert(ui.text().includes('Image artifact:test'))
      assertEquals(loads, 0)
    } finally {
      ui.free()
    }
  }
})
