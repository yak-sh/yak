/** The schema hierarchy paints from the served vocabulary, before any census. */
import { equal, ok, test } from '@yaks/testing'
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { docs as uxDocs } from '@yaks/ux/vocab'
import { h, render } from 'preact'
import { act } from 'npm:preact@^10.29.1/test-utils'
import { parseHTML } from 'linkedom'
import { inspector } from './door.ts'
import { docs } from './front.ts'
import { views } from './registry.ts'
import type { Host } from './host.ts'

let vocab = loadVocab([{
  package: '@test/work',
  $defs: {
    task: {
      component: true,
      description: 'Work to be done.',
      properties: { status: { type: 'string' }, owner: { type: 'string' } },
    },
    done: { component: true },
    task_close: {
      effect: true,
      created: ['done'],
      description: 'Close the task when it is done.',
    },
  },
}])

// Exercise the rendered controls once at load, as the Disclosure tests do.
// Each behavior gets a fresh page graph; the measured cases only check what
// the reader saw, rather than timing graph/document creation or scheduling.
let page = async (steps: ('package' | 'component' | 'remount')[]) => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let front = client(loadVocab([...docs, ...uxDocs]), [], {
    vault: false,
    wireVault: false,
  })
  let asked: string[] = []
  let pending: Promise<unknown> = Promise.resolve()
  let host: Host = {
    vocab,
    front,
    edits: true,
    useAnswers: (asks) =>
      Object.fromEntries(
        Object.entries(asks).map(([key, a]) => {
          asked.push(typeof a == 'string' ? a : a.query)
          return [key, { rows: [], ready: true }]
        }),
      ),
    apply: () => {},
    get: () => undefined,
    link: (eid) => `/${eid}`,
    find: (query) => `/?q=${encodeURIComponent(query)}`,
    go: () => {},
    id: (b) => b.entity.eid,
    kind: () => 'entity',
    name: (eid) => eid,
    when: (at) => at,
  }
  let nativeMutate = front.mutate.bind(front)
  front.mutate = (bs) => pending = Promise.resolve(nativeMutate(bs))
  let { Door } = inspector(views, host)
  let root = document.querySelector('main')!
  let draw = () =>
    render(
      h(Door, { e: { entity: { eid: 'map' } }, view: 'Inspect.Map' }),
      root,
    )
  try {
    act(draw)
    for (let step of steps) {
      if (step == 'remount') {
        act(() => render(null, root))
        act(draw)
      } else {
        let title = step == 'package' ? '@test/work' : 'task'
        let button = [...root.querySelectorAll('button')].find((b) =>
          b.textContent!.includes(title)
        )
        // A missing control is recorded by the observations below, not thrown
        // at fixture load: a regressed flat map still reaches its assertions.
        if (button) {
          await act(async () => {
            button.click()
            await pending
          })
        }
      }
    }
    return {
      text: root.textContent ?? '',
      tables: root.querySelectorAll('.Table').length,
      controls: [...root.querySelectorAll('button')].map((b) => ({
        text: b.textContent ?? '',
        expanded: b.getAttribute('aria-expanded'),
      })),
      links: [...root.querySelectorAll('a')].map((a) => a.textContent),
      asked,
    }
  } finally {
    act(() => render(null, root))
    front.close()
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

let initial = await page([])
let packaged = await page(['package'])
let properties = await page(['package', 'component'])
let collapsed = await page(['package', 'component', 'package'])
let remembered = await page([
  'package',
  'component',
  'package',
  'package',
  'remount',
])

test('the schema paints package controls without querying graph rows', () => {
  ok(initial.text.includes('Schema'))
  ok(
    initial.controls.some((b) =>
      b.text.includes('@test/work') && b.expanded == 'false'
    ),
  )
  equal(initial.tables, 0)
  equal(initial.asked, [])
})

test('opening a schema package reveals components but does not mount property tables', () => {
  ok(
    packaged.controls.some((b) =>
      b.text.includes('task') && b.expanded == 'false'
    ),
  )
  equal(packaged.tables, 0)
  equal(packaged.asked, [])
})

test('opening a schema package lists the effects it declares, each linked', () => {
  ok(packaged.links.some((a) => a?.includes('task_close')))
  ok(packaged.text.includes('Close the task when it is done.'))
})

test('opening a schema component reveals linked properties without a census', () => {
  equal(properties.tables, 1)
  ok(properties.links.includes('status'))
  ok(properties.links.includes('owner'))
  equal(properties.asked, [])
})

test('closing a schema package unmounts its property tables', () => {
  equal(collapsed.tables, 0)
  ok(!collapsed.text.includes('status'))
})

test('schema expansion survives closing its parent and remounting the map', () => {
  equal(remembered.tables, 1)
  ok(remembered.links.includes('status'))
  ok(
    remembered.controls.some((b) =>
      b.text.includes('task') && b.expanded == 'true'
    ),
  )
})
