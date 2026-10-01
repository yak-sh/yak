/** Page-only navigation and controlled List behavior, exercised without a
 * browser, a game graph, network access or a persistence adapter.
 */
import { equal, ok, test, throws, tick } from '@yaks/testing'
import { type Bundle } from '@yaks/graph'
import { h, options, render } from 'preact'
import { parseHTML } from 'linkedom'
import { pageDocs, pageState } from './page-state.ts'
import { focused, kit, List, selected, selection } from './ux-kit.ts'
import { loadVocab } from '@yaks/vocab'

let isolated = async (run: () => Promise<void>) => {
  let words = ['fetch', 'WebSocket', 'indexedDB']
  let prior = words.map((word) =>
    Object.getOwnPropertyDescriptor(globalThis, word)
  )
  let attempts: string[] = []
  for (let word of words) {
    Object.defineProperty(globalThis, word, {
      configurable: true,
      get: () => {
        attempts.push(word)
        throw new Error(`page graph touched ${word}`)
      },
    })
  }
  try {
    await run()
    equal(attempts, [])
  } finally {
    words.forEach((word, i) => {
      let saved = prior[i]
      if (saved) Object.defineProperty(globalThis, word, saved)
      else Reflect.deleteProperty(globalThis, word)
    })
  }
}

test('page graph opens, switches tabs and closes without network or disk', () =>
  isolated(async () => {
    let state = pageState('page')
    let watch = state.watch()
    let seen: Bundle[][] = []
    let off = watch.subscribe((rows) => seen.push(rows))
    try {
      await state.ready
      equal(state.front.wire, undefined)
      equal(state.opened, undefined)
      await state.open('book', 'quests')
      equal(state.opened, 'book')
      equal(state.pane, 'quests')
      await state.toggle('book', 'skills')
      equal(state.opened, 'book')
      equal(state.pane, 'skills')
      await state.close('map')
      equal(state.opened, 'book')
      await state.toggle('book', 'skills')
      equal(state.opened, undefined)
      equal(state.pane, 'skills')
      await state.open('map')
      equal(state.pane, undefined)
      await state.close()
      equal(state.opened, undefined)
      ok(seen.length > 0)
      throws(() =>
        state.mutate([{
          entity: { eid: 'hero' },
          position: { x: 10 },
        }])
      )
      equal(state.front.ent('hero'), undefined)
    } finally {
      off()
      watch.close()
      state.dispose()
    }
  }))

test('panel headings, marks and row selections are independent named rows', () =>
  isolated(async () => {
    let state = pageState('page')
    let other = pageState('other')
    let watched = state.watchPanel('book/quests')
    let rows: Bundle[] = []
    let off = watched.subscribe((next) => rows = next)
    let list = state.watchList('book')
    try {
      await state.head('book', 'Journal')
      await state.mark('book/quests', true)
      equal(state.heading('book'), 'Journal')
      equal(state.marked('book/quests'), true)
      equal(rows[0]?.entity.eid, 'book/quests')
      await state.select('book', 'quest-a')
      await state.select('map', 'place-b')
      equal(state.cursor('book'), 'quest-a')
      equal(state.cursor('map'), 'place-b')
      equal(selection(list.value[0]).cursor, 'quest-a')
      equal(other.cursor('book'), undefined)
      ok(state.listAt('book') != other.listAt('book'))
      await state.mutate([focused(state.list('book'), 'detail')])
      await state.open('book', 'quests')
      await state.close()
      equal(selection(state.list('book')), {
        cursor: 'quest-a',
        pane: 'detail',
      })
      await state.select('book', null)
      equal(selection(state.list('book')), {
        cursor: undefined,
        pane: 'detail',
      })
      await state.mark('book/quests', false)
      equal(state.marked('book/quests'), false)
      equal(state.front.ent('quest-a'), undefined)
      equal(state.front.ent('place-b'), undefined)
    } finally {
      off()
      watched.close()
      list.close()
      state.dispose()
      other.dispose()
    }
  }))

let mounted = async (run: (root: HTMLElement) => void | Promise<void>) => {
  let { document } = parseHTML('<html><body><main></main></body></html>')
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let raf = options.requestAnimationFrame
  options.requestAnimationFrame = (fn) => setTimeout(fn)
  let root = document.querySelector('main')!
  try {
    await run(root)
  } finally {
    render(null, root)
    await tick()
    options.requestAnimationFrame = raf
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
}

test('List emits controlled bundles and selection leaves both panes mounted', () =>
  mounted((root) => {
    let e: Bundle = { entity: { eid: 'list' }, List: { pane: 'list' } }
    let rows = ['a', 'b'].map((eid) => ({ entity: { eid } }))
    let emitted: Bundle[] = []
    let paint = () =>
      render(
        h(List, {
          e,
          rows,
          onChange: (b) => emitted.push(b),
          Row: ({ row }) => h('span', {}, row.entity.eid),
          Detail: ({ row }) => h('p', {}, row?.entity.eid ?? 'Choose'),
        }),
        root,
      )
    paint()
    let panes = [...root.querySelectorAll('.Panes_Pane')]
    let frame = root.querySelector('.Panes')!
    equal(panes.length, 2)
    root.querySelectorAll('button')[1].click()
    equal(emitted, [selected(e, 'b')])
    equal(selection(e).cursor, undefined)
    equal(panes[1].textContent, 'Choose')
    e = emitted[0]
    paint()
    equal(panes[1].textContent, 'b')
    equal(root.querySelector('.Panes'), frame)
    equal([...root.querySelectorAll('.Panes_Pane')], panes)
    ok(panes[0].classList.contains('Panes_Pane-nav'))
    ok(panes[1].classList.contains('Panes_Pane-main'))
    equal(
      root.querySelectorAll('button')[1].getAttribute('aria-pressed'),
      'true',
    )
    panes[1].querySelector('.Panes_Body')!.dispatchEvent(
      new root.ownerDocument.defaultView!.Event('focusin', { bubbles: true }),
    )
    equal(emitted[1], focused(e, 'detail'))
    equal(selection(e).pane, 'list')
    e = emitted[1]
    paint()
    equal([...root.querySelectorAll('.Panes_Pane')], panes)
    ok(panes[1].classList.contains('Panes_Pane-on'))
    panes[0].querySelector('.Panes_Body')!.dispatchEvent(
      new root.ownerDocument.defaultView!.Event('focusin', { bubbles: true }),
    )
    equal(emitted[2], focused(e, 'list'))
    equal(selection(e).pane, 'detail')
    rows = []
    paint()
    equal([...root.querySelectorAll('.Panes_Pane')], panes)
    equal(panes[1].textContent, 'Choose')
  }))

test('base and Vale kitDocs compose and the interactive List specimen draws', () =>
  isolated(() =>
    mounted(async (root) => {
      let vocab = loadVocab(pageDocs())
      equal(vocab.comp('List')?.durable, 'connection')
      equal(vocab.comp('Edit')?.sync, 'none')
      equal(vocab.comp('Panel')?.sync, 'none')
      for (let [label, specimen] of kit.components.List.specimens()) {
        ok(label)
        render(specimen, root)
        await tick()
        let panes = [...root.querySelectorAll('.Panes_Pane')]
        root.querySelectorAll('button')[1].click()
        await tick()
        equal(panes[1].textContent, 'sample-b')
        equal([...root.querySelectorAll('.Panes_Pane')], panes)
        render(null, root)
        await tick()
      }
    })
  ))
