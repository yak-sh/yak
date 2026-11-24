import type { Clock } from '@yaks/fp'
import type { BrowseFrame, Result } from './browser-visit.ts'
import { BROWSE_BEAT, header, PROGRESS, WIRE } from './browser-wire.ts'

export type Screens = {
  progress: (stage: string) => void
  reset: () => Promise<void>
  shot: (name: string, image: string) => Promise<void>
}

export let streamBrowse = (
  progress: boolean,
  time: Clock,
  run: (screens: Screens) => Promise<Result>,
) => {
  let { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  let write = writable.getWriter()
  let start = time.now()
  let stage = 'receiving the visit'
  let writing: Promise<void> | undefined
  let frame = (head: BrowseFrame, size?: number) =>
    write.write(header(head, size))
  // A shot's raw bytes stay together even when rendering hits its deadline
  // during a write. A progress or result header follows the whole shot.
  let send = async (run: () => Promise<void>) => {
    while (writing) await writing
    let current = writing = run()
    try {
      await current
    } finally {
      if (writing === current) writing = undefined
    }
  }
  let screens: Screens = {
    progress: (next) => {
      stage = next
    },
    reset: () => send(() => frame({ kind: 'reset' })),
    shot: (name, image) =>
      send(async () => {
        // CDP gives one base64 screenshot at a time. Decode it in bounded
        // pieces as the receiver takes the PNG.
        let padding = image.endsWith('==') ? 2 : image.endsWith('=') ? 1 : 0
        let size = Math.floor((image.length - padding) * 3 / 4)
        await frame({ kind: 'shot', name }, size)
        for (let at = 0; at < image.length; at += 64 * 1024) {
          await write.write(
            Uint8Array.fromBase64(image.slice(at, at + 64 * 1024)),
          )
        }
      }),
  }
  let cancel = () => {}
  let beat = () => {
    cancel = time.after(BROWSE_BEAT, () => {
      beat()
      if (!writing) {
        void send(() =>
          frame({
            kind: 'progress',
            stage,
            ms: time.now() - start,
          })
        ).catch(() => cancel())
      }
    })
  }
  if (progress) beat()
  let reply = async () => {
    let result = await run(screens)
    cancel()
    await send(async () => {
      await frame({ kind: 'result', result })
      await write.close()
    })
  }
  reply().catch((e) => {
    cancel()
    return write.abort(e).catch(() => {})
  })
  return new Response(readable, {
    headers: { 'content-type': WIRE, ...progress ? { [PROGRESS]: '1' } : {} },
  })
}
