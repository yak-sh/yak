// A board tile summarizes the same task statuses as its board columns — and it
// gets them from an AGGREGATE subscription, never from the board's members
// (T-22509). So these drive the tile the way the wire does: mount it, land the
// tally frame the server sends, and read the numbers off the meta row. The
// board's task rows are deliberately ABSENT from the cache here: a tile that
// could still count them locally would hide the very regression this fixes.
import { render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { boardTallyName, cache, ent, landSub, useRoute } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import { tick } from '../../testing.ts'
import { BoardTile } from './BoardTile.tsx'

// A mounted view holds subscriptions. In a test there is no server to hold
// them against, so control frames go nowhere through live.ts's transport
// seam — the cache here is only ever what the test seeds.
useRoute(() => {})

let data = (query: string) => ({
  board: {
    entity: { eid: 'board', num: 1 },
    doc: { eid: 'board', title: 'Work', body: '' },
    board: { eid: 'board', query },
  },
})

// One tile mounted into a fresh document, with the DOM globals restored after.
let onTile = async (query: string, run: (root: Element) => Promise<void>) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = data(query)
  let root = document.querySelector('main')!
  try {
    render(<BoardTile e={ent('board')} />, root)
    await run(root)
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
}

let stats = (root: Element) =>
  [...root.querySelectorAll('.BoardStat')].map((e) => e.textContent)

// The server's tally frames for the board's own aggregate sub, landed and then
// awaited — a signal wakes its component on preact's own queue, not inline.
let tally = async (agg: Record<string, number>, replace = false) => {
  landSub({ sub: boardTallyName(ent('board')), changes: [], agg, replace })
  await tick()
}

Deno.test('board tile counts come from the tally sub, not the members', async () => {
  await onTile('.task!', async (root) => {
    assertEquals(resolve(ent('board'), 'List.Tile').Render, BoardTile)
    assertEquals(root.querySelector('.Tile_Title')?.textContent, 'Work')
    // Before the server answers there is nothing to claim, so no stats paint —
    // four zeros would be a wrong number, which is worse than none.
    assertEquals(stats(root), [])

    await tally({ open: 1, done: 1 }, true)
    assertEquals(stats(root), ['1', '0', '1', '0'])

    // A delta moves one key and the tile follows without a member in sight.
    await tally({ open: 0, wip: 1 })
    assertEquals(stats(root), ['0', '1', '1', '0'])

    let meta = [...root.querySelector('.Show_Meta')!.children]
    assertEquals(meta[0].classList.contains('BoardStat'), true)
    assertEquals(meta.at(-1)?.classList.contains('Id'), true)
  })
})

Deno.test('a bad board query does not break its tile', async () => {
  await onTile('.hovercraf=x', (root) => {
    assertEquals(stats(root), [])
    assertEquals(root.querySelector('.Id')?.textContent, 'B-1')
    return Promise.resolve()
  })
})
