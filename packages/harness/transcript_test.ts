import { h } from 'preact'
import { define, resolve } from '@yaks/render'
import { assert, assertEquals } from '@std/assert'
import { render } from '@yaks/preact'
import { vocab } from './store.ts'
import type { Bundle, Comp } from '@yaks/graph'
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
            : kind == 'input' || kind == 'output' || kind == 'result'
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
        kind == 'result' || kind == 'input',
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
      assertEquals(text.includes('<script>bad</script>'), !result, text)
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
      [{ using: { model: 'm' } }, true],
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

Deno.test('ask entries carrying served using metadata are not empty inputs', async () => {
  let entry: Bundle = {
    entity: { eid: 'ask-with-using' },
    entry: { session: 's', seq: 3 },
    ask: { to: 'm', through: 'input' },
    using: { model: 'm' },
    usage: { input_tokens: 42 },
  }
  let ui = await mount(
    () => render(transcriptViews, entry, 'Transcript', vocab),
    80,
    8,
  )
  try {
    assert(ui.text().includes('ask'), ui.text())
    assert(!ui.text().includes('input'), ui.text())
    assert(!ui.text().includes('╭'), ui.text())
  } finally {
    ui.free()
  }
})

Deno.test('boxed user Markdown preserves explicit newlines and paragraph separation', async () => {
  let source = 'first\n**second**\n\nthird\n*fourth*'
  let entry: Bundle = {
    entity: { eid: 'multiline-user' },
    entry: { session: 's', seq: 1 },
    content: { body: source },
  }
  let ui = await mount(
    () => render(transcriptViews, entry, 'Transcript', vocab),
    60,
    12,
  )
  try {
    let rows = ui.text().split('\n')
    let first = rows.findIndex((line) => line.includes('first'))
    let second = rows.findIndex((line) => line.includes('second'))
    let third = rows.findIndex((line) => line.includes('third'))
    let fourth = rows.findIndex((line) => line.includes('fourth'))
    assert(first >= 0, ui.text())
    assertEquals(second, first + 1, ui.text())
    assertEquals(third, second + 2, ui.text())
    assertEquals(fourth, third + 1, ui.text())
    assertEquals(entry.content, { body: source })
  } finally {
    ui.free()
  }
})

Deno.test('instruction snapshots display one clipped provenance row without changing source', async () => {
  let source = 'PRIVATE instruction\n\n'.repeat(10000)
  for (let scope of ['shared', 'local']) {
    for (let width of [80, 18, 1]) {
      let entry: Bundle = {
        entity: { eid: 'instruction' },
        entry: { seq: 12 },
        prompt: { scope, source: '/private/repository/AGENTS.md' },
        content: { body: source },
      }
      let ui = await mount(
        () =>
          h(
            'div',
            null,
            render(transcriptViews, entry, 'Transcript', vocab),
            h('div', null, 'next entry'),
          ),
        width,
        4,
      )
      try {
        let lines = ui.text().split('\n')
        assertEquals(lines[1], 'next entry')
        assertEquals(lines.slice(2), ['', ''])
        assert(!ui.out.join('').includes('PRIVATE'))
        assert(!ui.out.join('').includes('/private/'))
        if (width == 80) {
          assert(lines[0].includes('prompt    ' + scope + ' · AGENTS.md'))
        }
        assertEquals(entry.content, { body: source })
      } finally {
        ui.free()
      }
    }
  }
})

Deno.test('prompt source metadata cannot insert extra transcript rows', async () => {
  let entry: Bundle = {
    entity: { eid: 'instruction' },
    entry: { seq: 2 },
    prompt: { scope: 'local\nextra', source: 'graph:source\nname' },
    content: { body: 'not displayed' },
  }
  let ui = await mount(
    () =>
      h(
        'div',
        null,
        render(transcriptViews, entry, 'Transcript', vocab),
        h('div', null, 'next'),
      ),
    40,
    3,
  )
  try {
    assertEquals(ui.text().split('\n')[1], 'next')
    assert(!ui.text().includes('not displayed'))
  } finally {
    ui.free()
  }
})

Deno.test('fenced code fills the boxed message interior without changing source', async () => {
  let source = '```text\nshort\n\nlast\n```'
  let entry: Bundle = {
    entity: { eid: 'code-message' },
    entry: { session: 's', seq: 1 },
    content: { body: source },
  }
  let ui = await mount(
    () => render(transcriptViews, entry, 'Transcript', vocab),
    30,
    10,
  )
  try {
    assert(ui.text().includes('short'))
    assert(ui.text().includes('last'))
    // The border reserves two columns, leaving 28 code-background cells.
    let output = ui.out.join('')
    assert(output.includes('short' + ' '.repeat(23)), output)
    assert(output.includes('last' + ' '.repeat(24)), output)
    assertEquals((entry.content as { body: string }).body, source)
  } finally {
    ui.free()
  }
})

Deno.test('shell call shows command arguments and malformed args remain safe', async () => {
  for (const args of [JSON.stringify({ command: 'printf hello\npwd' }), '{']) {
    const entry: Bundle = {
      entity: { eid: 'shell-call' },
      entry: { session: 's', seq: 2 },
      call: { to: 'tool:shell', args },
    }
    const ui = await mount(
      () => render(transcriptViews, entry, 'Transcript', vocab),
      60,
      8,
    )
    try {
      if (args != '{') {
        assert(ui.text().includes('$ printf hello'), ui.text())
        assert(ui.text().includes('pwd'))
      } else assert(ui.text().includes('tool:shell'))
      assertEquals((entry.call as Comp).args, args)
    } finally {
      ui.free()
    }
  }
})

Deno.test('result previews cap source and wrapped rows without changing stored text', async () => {
  for (
    const source of [
      Array.from({ length: 100 }, (_, i) => 'row ' + i).join('\n'),
      'x'.repeat(1000),
    ]
  ) {
    const entry: Bundle = {
      entity: { eid: 'result' },
      entry: { session: 's', seq: 3 },
      result: { call: 'c' },
      content: { body: source },
    }
    const ui = await mount(
      () => render(transcriptViews, entry, 'Transcript', vocab),
      70,
      15,
    )
    try {
      assert(ui.text().includes('output preview'), ui.text())
      assert(!ui.text().includes('row 6'))
      assert(
        ui.text().split('\n').filter((line) => line.trim()).length <= 7,
        ui.text(),
      )
      assertEquals((entry.content as Comp).body, source)
    } finally {
      ui.free()
    }
  }
})

Deno.test('input Markdown keeps dim text and emphasis', async () => {
  const entry: Bundle = {
    entity: { eid: 'input' },
    entry: { session: 's', seq: 1 },
    content: { body: '**bold** and *italic*\nnext line' },
  }
  const ui = await mount(
    () => render(transcriptViews, entry, 'Transcript', vocab),
    70,
    10,
  )
  try {
    assert(!ui.text().includes('**bold**'))
    assert(ui.text().includes('next line'))
    assert(ui.out.join('').includes(';1;2mbold'), ui.out.join(''))
  } finally {
    ui.free()
  }
})
