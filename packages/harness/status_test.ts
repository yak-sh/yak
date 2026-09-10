import { assertEquals } from '@std/assert'
import { resolve } from '@yaks/render'
import type { Bundle } from '@yaks/graph'
import { statusBundle, statusViews, statusVocab } from './status.ts'

Deno.test('sidebar indicator queries cover states and owner joins', () => {
  let cases: [Bundle, string, string][] = []
  for (
    let [status, glyph, color] of [
      ['settled', '●', 'Good'],
      ['running', '●', 'Key'],
      ['pending', '●', 'Key'],
      ['failed', '●', 'Bad'],
      ['stopped', '○', 'Muted'],
      ['unknown', '○', 'Accent'],
    ]
  ) cases.push([{ entity: { eid: 's' }, session: { status } }, glyph, color])
  for (
    let [status, owner, glyph, color] of [
      ['done', 'running', '●', 'Good'],
      ['done', 'failed', '●', 'Good'],
      ['open', '', '○', 'Accent'],
      ['wip', 'running', '●', 'Key'],
      ['wip', 'pending', '●', 'Key'],
      ['wip', 'settled', '◐', 'Key'],
      ['wip', 'failed', '●', 'Bad'],
      ['wip', 'stopped', '◐', 'Muted'],
      ['wip', '', '◐', 'Muted'],
      ['cancelled', 'running', '○', 'Muted'],
    ]
  ) {
    let task: Bundle = {
      entity: { eid: 't' },
      task: { status },
      claim: { session: 's' },
    }
    let joined = statusBundle(
      task,
      owner ? [{ entity: { eid: 's' }, session: { status: owner } }] : [],
    )
    assertEquals(task.session, undefined)
    cases.push([joined, glyph, color])
  }
  for (let [bundle, glyph, color] of cases) {
    let renderer = resolve(statusViews, bundle, 'Indicator', statusVocab)!
    type Node = { props: Record<string, unknown> | null; children: unknown[] }
    let node = renderer.render<Node>(
      bundle,
      (_tag, props, ...children) => ({ props, children }),
      {},
    )
    assertEquals(node.children, [glyph], JSON.stringify(bundle))
    assertEquals(node.props?.class, color, JSON.stringify(bundle))
  }
})

Deno.test('status indicators paint colored single-column glyphs in the sidebar', async () => {
  let { h } = await import('preact')
  let { mount } = await import('../tui/harness.ts')
  let { panels } = await import('./panels.ts')
  let sessions: Bundle[] = [{
    entity: { eid: 's' },
    session: { id: 'worker', status: 'settled' },
  }]
  let rows: Bundle[] = [{
    entity: { eid: 't', num: 1 },
    task: { status: 'wip' },
    claim: { session: 's' },
    doc: { title: 'unfinished' },
  }]
  let panel = panels.find((p) => p.title == 'Tasks')!
  let ui = await mount(
    () => h(panel.Render, { rows, sessions, agent: {} as never }),
    60,
    4,
  )
  try {
    assertEquals(ui.text().includes('◐ 1 unfinished'), true)
    assertEquals(ui.out.join('').includes('◐'), true)
    assertEquals(panel.titleClass, 'Task')
  } finally {
    ui.free()
  }
})
