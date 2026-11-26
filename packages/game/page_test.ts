import { equal, test } from '@yaks/testing'
import { page } from './page.ts'
import { type VocabDoc } from '@yaks/vocab'

let changes: unknown[] = []
let tile = {
  component: true,
  type: 'object',
  properties: { x: { type: 'number' } },
}
let stored: VocabDoc[] = [{ $defs: { trail: tile } }]
let front = await page({
  api: 'https://game.example/play/api',
  words: [{
    $defs: { Tile: { ...tile, sync: 'none', durable: 'connection' } },
  }],
  fetch: async (request) => {
    if (request.url === 'https://game.example/play/api/vocab.json') {
      return Response.json(stored)
    }
    equal(request.url, 'https://game.example/play/api/apply')
    let batch = await request.json()
    changes.push(batch)
    return Response.json(batch)
  },
})
let tiles = front.watch('.Tile', { remote: false })
let heard: unknown[] = []
tiles.subscribe((rows) => heard.push(rows.map((r) => r.Tile)))

test('a page draws a local batch and sends only the saved components', async () => {
  let entity = { eid: crypto.randomUUID() }
  let Tile = { x: 4 }, trail = { x: 9 }
  try {
    await front.mutate([{ entity, Tile, Controls: { strafe: true } }])
    equal(tiles.value.map((r) => r.Tile), [Tile])
    equal(heard, [[Tile]])
    equal(front.ent(entity.eid)?.Controls, { strafe: true })
    equal(changes, [])
    await front.mutate([{ entity, trail }], { optimistic: false })
    equal(changes, [[{ entity, trail }]])
  } finally {
    front.close()
  }
})
