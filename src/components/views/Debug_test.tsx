// The Debug inspector exposes every component and gives its editing controls
// the same component vocabulary as its stored rows.
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { compTone } from '../comp.ts'
import { cache, ent } from '../../live.ts'
import { applicable } from '../registry.ts'

Deno.test('raw formats are nested under Debug', async () => {
  await import('../Entity.tsx')
  let { DebugTabs } = await import('./Debug.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let e = {
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    num: 1,
    kind: 'doc',
    refs: [],
    kids: [],
    doc: {
      eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Nested',
      body: 'source',
    },
  }
  try {
    assertEquals(applicable(e).includes('Markdown'), false)
    assertEquals(applicable(e).includes('JSON'), false)
    render(h(DebugTabs, { e }, h('i', {}, 'components')), root)
    let tabs = [...root.querySelectorAll<HTMLButtonElement>('.Debug_Tabs .Tab')]
    assertEquals(tabs.map((tab) => tab.getAttribute('aria-label')), [
      'Components',
      'Markdown',
      'JSON',
    ])
    tabs[1].click()
    await Promise.resolve()
    assertEquals(
      root.querySelector('.Md')?.textContent.includes('source'),
      true,
    )
    tabs[2].click()
    await Promise.resolve()
    assertEquals(
      root.querySelector('.Json')?.textContent.includes('Nested'),
      true,
    )
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('addable components keep their component tones', async () => {
  await import('../Entity.tsx')
  let { AddComp } = await import('./Debug.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let root = document.querySelector('main')!
  let e = {
    eid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    num: 1,
    kind: 'entity',
    refs: [],
    kids: [],
  }
  try {
    render(h(AddComp, { e }), root)
    root.querySelector<HTMLButtonElement>('.Debug_AddBtn')!.click()
    await Promise.resolve()
    let labels = [...root.querySelectorAll('.Debug_AddItem .Debug_Comp')]
    assertEquals(labels.length > 1, true)
    for (let label of labels) {
      assertEquals(
        label.classList.contains(`Debug_Comp-${compTone(label.textContent!)}`),
        true,
      )
    }
  } finally {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('project backlinks omit attribution and cap associations', async () => {
  await import('../Entity.tsx')
  let { ProjectDebug } = await import('./Debug.tsx')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  cache.value = {
    [project]: {
      entity: { eid: project, num: 19 },
      doc: { eid: project, title: 'Task Graph', body: '' },
      project: { eid: project },
    },
  }
  for (let n = 1; n <= 5; n++) {
    let eid = `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`
    cache.value = {
      ...cache.value,
      [eid]: {
        entity: { eid, num: n },
        doc: { eid, title: `Task ${n}`, body: '' },
        task: { eid, status: 'open', priority: n, project_eid: project },
      },
    }
  }
  for (let n = 1; n <= 2; n++) {
    let eid = `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`
    cache.value = {
      ...cache.value,
      [eid]: {
        entity: { eid, num: n + 20 },
        doc: { eid, title: `Action ${n}`, body: '' },
        created: { eid, by: project },
      },
    }
  }
  for (let n = 1; n <= 4; n++) {
    let eid = `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`
    cache.value = {
      ...cache.value,
      [eid]: {
        entity: { eid, num: n + 30 },
        session: { eid, id: `session-${n}`, actor_eid: project },
      },
    }
  }
  let root = document.querySelector('main')!
  try {
    render(h(ProjectDebug, { e: ent(project) }), root)
    assertEquals(root.textContent.includes('created.by'), false)
    assertEquals(root.textContent.includes('Action 1'), false)
    assertEquals(root.textContent.includes('Task 5'), true)
    assertEquals(root.textContent.includes('Task 2'), false)
    let more = [...root.querySelectorAll<HTMLAnchorElement>(
      '.Debug_Linked[href]',
    )]
    assertEquals(more[0].textContent.includes('+2 more tasks'), true)
    assertEquals(
      more[0].getAttribute('href'),
      '/admin/task?q=.task.project_eid%3DP-19',
    )
    assertEquals(more[1].textContent.includes('+1 more session'), true)
    assertEquals(
      more[1].getAttribute('href'),
      '/admin/session?q=.session.actor_eid%3DP-19',
    )
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
