// A board tile summarizes the same task statuses as its board columns.
import { render } from 'preact'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { cache, ent } from '../../live.ts'
import { resolve } from '../Entity.tsx'
import { BoardTile } from './BoardTile.tsx'

let data = (query: string) => ({
  board: {
    entity: { eid: 'board', num: 1 },
    doc: { eid: 'board', title: 'Work', body: '' },
    board: { eid: 'board', query },
  },
  open: {
    entity: { eid: 'open', num: 2 },
    doc: { eid: 'open', title: 'One', body: '' },
    task: { eid: 'open', status: 'open', priority: 0 },
  },
  done: {
    entity: { eid: 'done', num: 3 },
    doc: { eid: 'done', title: 'Two', body: '' },
    task: { eid: 'done', status: 'done', priority: 0 },
  },
})

Deno.test('board tile carries status counts in its meta row', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = data('')
  let root = document.querySelector('main')!
  try {
    let board = ent('board')
    let tile = resolve(board, 'List.Tile')
    assertEquals(tile.view, 'Tile')
    assertEquals(tile.Render, BoardTile)
    render(<BoardTile e={board} />, root)
    assertEquals(root.querySelector('.Tile-board') != null, true)
    assertEquals(root.querySelector('.Tile_Title')?.textContent, 'Work')
    assertEquals(
      [...root.querySelectorAll('.BoardStat')].map((e) => e.textContent),
      ['1', '0', '1', '0'],
    )
    let meta = [...root.querySelector('.Show_Meta')!.children]
    assertEquals(meta[0].classList.contains('BoardStat'), true)
    assertEquals(meta.at(-1)?.classList.contains('Id'), true)
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

Deno.test('a bad board query does not break its tile', () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  cache.value = data('.hovercraf=x')
  let root = document.querySelector('main')!
  try {
    render(<BoardTile e={ent('board')} />, root)
    assertEquals(root.querySelectorAll('.BoardStat').length, 0)
    assertEquals(root.querySelector('.Id')?.textContent, 'B-1')
  } finally {
    render(null, root)
    cache.value = {}
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})
