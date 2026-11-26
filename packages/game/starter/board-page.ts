import { page } from '@yaks/game/page'
import { board } from './board.ts'
import { screen } from './screen.ts'

let canvas = document.querySelector('canvas')!
let hint = document.querySelector<HTMLElement>('.Hint')!
let stop = screen()
let view = board(canvas)
let front = await page({
  words: [{
    $defs: {
      BoardPawn: {
        component: true,
        type: 'object',
        sync: 'none',
        durable: 'connection',
        properties: { x: { type: 'number' }, z: { type: 'number' } },
      },
    },
  }],
}).catch((error) => {
  hint.textContent = 'Could not load the board. Reload to try again.'
  reportError(error)
})

if (front) {
  let entity = { eid: crypto.randomUUID() }
  let pawns = front.watch('.BoardPawn', { remote: false })
  let bound = (n: number) => Math.max(-11, Math.min(11, n))
  let move = (x: number, z: number) => {
    void Promise.resolve(front.mutate([{
      entity,
      BoardPawn: { x: bound(x), z: bound(z) },
    }])).catch(reportError)
  }
  let draw = () =>
    view.draw(pawns.value.map((row) => ({
      ...(row.BoardPawn as { x: number; z: number }),
      own: true,
    })))
  pawns.subscribe(draw)
  move(0, 0)
  let keys: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }
  canvas.addEventListener('pointerup', (event) => {
    let tile = view.pick(event.clientX, event.clientY)
    if (tile) move(tile.x, tile.z)
  })
  canvas.addEventListener('keydown', (event) => {
    let direction = keys[event.key]
    if (!direction) return
    event.preventDefault()
    let here = front.ent(entity.eid)?.BoardPawn as { x: number; z: number }
    move(here.x + direction[0], here.z + direction[1])
  })
  addEventListener('resize', draw)
  addEventListener('pagehide', (event) => {
    if (event.persisted) return
    removeEventListener('resize', draw)
    stop()
    front.close()
  })
}
