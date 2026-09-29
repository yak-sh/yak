// Paint one item design off the page's thread and send back its PNG.
import type { Thing } from './items.ts'
import { paint, spriteSize } from './sprite-paint.ts'

export type Ask = { n: number; item: Thing }
export type Answer = { n: number; blob?: Blob; error?: string }

addEventListener('message', async (e: MessageEvent<Ask>) => {
  let { n, item } = e.data
  try {
    let canvas = new OffscreenCanvas(spriteSize, spriteSize)
    let g = canvas.getContext('2d')
    if (!g) throw new Error('No 2D canvas in the sprite worker')
    paint(item, g)
    let answer: Answer = {
      n,
      blob: await canvas.convertToBlob({ type: 'image/png' }),
    }
    postMessage(answer)
  } catch (error) {
    let answer: Answer = { n, error: String(error) }
    postMessage(answer)
  }
})
