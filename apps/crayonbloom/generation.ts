import { decode, encode } from 'fast-png'
import { type Bundle, sha256 } from '@yaks/graph'
import { type Binding, json, type Store, type Who } from './db.ts'
import type { Generator } from './atelier.ts'
import type { Art } from './model.ts'
import { puzzlePdf } from './puzzle-pdf.ts'

export type Runtime = {
  preview: boolean
  font: string
  printer: string
  model: string
  story_model?: string
}
export let settings = async (db: Store): Promise<Runtime> => {
  let [row] = await db.query('.coloring_runtime&?coloring_runtime')
  return {
    preview: true,
    font: '',
    printer: '',
    model: 'gpt-image-2.5-flare',
    ...(row?.coloring_runtime as Partial<Runtime> ?? {}),
  }
}
export let put = async (
  app: Binding,
  caller: Who,
  bytes: Uint8Array,
  mime: string,
): Promise<Omit<Art, 'input'>> => {
  let query = new URLSearchParams()
  if (caller.person) query.set('buyer', caller.person)
  if (caller.via) query.set('via', caller.via)
  let result = await json<{ eid: string }>(
    await app.fetch('/pay/artifacts?' + query, {
      method: 'POST',
      headers: { 'content-type': mime, 'x-yak-name': 'CrayonBloom artwork' },
      body: new Uint8Array(bytes),
    }),
  )
  return { blob: result.eid, hash: result.eid, mime }
}
export let checkedImage = (bytes: Uint8Array, size: string) => {
  let image = decode(bytes), [width, height] = size.split('x').map(Number)
  if (image.width !== width || image.height !== height) {
    throw new Error(
      'The image provider returned a different size than requested. Your saved pages are kept.',
    )
  }
  return image
}
let sample = (seed: number) => {
  let width = 2400,
    height = 3040,
    data = new Uint8Array(width * height).fill(255)
  let stroke = (left: number, right: number, y: number) => {
    data.fill(
      0,
      y * width + Math.max(0, Math.floor(left)),
      y * width + Math.min(width, Math.ceil(right)),
    )
  }
  let ellipse = (cx: number, cy: number, rx: number, ry: number) => {
    for (let y = Math.ceil(cy - ry); y <= Math.floor(cy + ry); y++) {
      let dy = y - cy,
        outer = rx * Math.sqrt(Math.max(0, 1 - dy * dy / (ry * ry)))
      let inner = Math.abs(dy) >= ry - 12
        ? 0
        : (rx - 12) * Math.sqrt(1 - dy * dy / ((ry - 12) * (ry - 12)))
      stroke(cx - outer, cx - inner, y)
      stroke(cx + inner, cx + outer, y)
    }
  }
  ellipse(1200, 1380, 640, 650)
  ellipse(760 + seed % 700, 1140, 132, 135)
  for (let y = 2328; y < 2340; y++) stroke(240, 2160, y)
  return encode({ width, height, data, channels: 1, depth: 8 })
}
export let generation = (
  db: Store,
  app: Binding,
  caller: Who,
  runtime: Runtime,
): Generator => ({
  request(job, prompt, refs) {
    let entries: Bundle[] = refs.map((ref, index) => ({
      entity: { eid: crypto.randomUUID() },
      entry: { session: job, seq: index + 1 },
      content: { body: ref.label },
      attachment: { artifact: ref.blob, audience: 'model' },
    }))
    return [...entries, {
      entity: { eid: crypto.randomUUID() },
      entry: { session: job, seq: refs.length + 1 },
      content: { body: prompt },
      ...(!runtime.preview
        ? {
          using: { provider: 'openai', model: runtime.model },
          sending: {
            input: {
              size: '2400x3040',
              quality: 'medium',
              output_format: 'png',
            },
          },
        }
        : {}),
    }]
  },
  async result(job) {
    if (runtime.preview) {
      let [row] = await db.query(`.entity.eid=${job}&?page_job`)
      let input = String((row?.page_job as { input: string }).input)
      return {
        artwork: await put(
          app,
          caller,
          sample(parseInt(sha256(input).slice(0, 6), 16)),
          'image/png',
        ),
      }
    }
    let [session] = await db.query(`.entity.eid=${job}&?session&?failed`)
    if (session?.failed) {
      return {
        error: String(
          (session.failed as { reason?: string }).reason ??
            'This artwork attempt failed. Your completed pages are kept.',
        ),
      }
    }
    let rows = await db.query(
      `.entry.session=${job}&?attachment&?refusal&?output`,
    )
    let declined = rows.find((row) => row.refusal)
    if (declined) {
      return {
        error: String(
          (declined.refusal as { message?: string }).message ??
            'The artwork could not be drawn. Your completed pages are kept.',
        ),
      }
    }
    let output = rows.find((row) => row.output && row.attachment)
    if (!output) return {}
    let artifact = String((output.attachment as { artifact: string }).artifact)
    let bytes = await app.fetch('/blob/' + artifact)
    if (!bytes.ok) {
      throw new Error('Completed artwork could not be read: ' + bytes.status)
    }
    let completed = new Uint8Array(await bytes.arrayBuffer())
    checkedImage(completed, '2400x3040')
    return {
      artwork: await put(
        app,
        caller,
        completed,
        bytes.headers.get('content-type') ?? 'image/png',
      ),
    }
  },
})
export let puzzle =
  (app: Binding, caller: Who, runtime: Runtime) =>
  async (activity: string, age: string, text: string, seed: number) => {
    if (!runtime.font) {
      throw new Error(
        'The CrayonBloom typography font has not been provisioned.',
      )
    }
    let font = await app.fetch('/pay/artifacts/' + runtime.font)
    if (!font.ok) {
      throw new Error(
        'The saved typography font could not be read: ' + font.status,
      )
    }
    let bytes = await puzzlePdf(
      activity,
      age,
      text,
      seed,
      new Uint8Array(await font.arrayBuffer()),
    )
    return await put(app, caller, bytes, 'application/pdf')
  }
