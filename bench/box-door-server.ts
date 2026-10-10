/** Probe-only observer around the composed box HTTP handler. No duties run. */
import { opened } from '../packages/cli/local.ts'
import { channel } from '@yaks/trace'
import { collector } from './box-lib.ts'

let [config, ready, records] = Deno.args
let host = await opened(config, ['graph', 'web'], false)
if (!host.handler) {
  throw new Error('box door: config needs @yaks/api and @yaks/mcp')
}
let server = Deno.serve({
  hostname: '127.0.0.1',
  port: host.config.port,
  onListen: () => Deno.writeTextFileSync(ready, String(Deno.pid)),
}, async (request) => {
  let body = await request.clone().json().catch(() => ({}))
  let events = collector()
  let stop = channel(host.graph).subscribe(events.add, { history: false })
  let start = performance.now()
  try {
    let response = await host.handler!(request)
    let ms = performance.now() - start
    let spans = events.take()
    Deno.writeTextFileSync(
      records,
      JSON.stringify({
        method: body.method,
        tool: body.params?.name,
        ms,
        spans,
      }) + '\n',
      { append: true },
    )
    return response
  } finally {
    stop()
  }
})
let closing: Promise<void> | undefined
let close = () =>
  closing ??= (async () => {
    await server.shutdown()
    await host.close(0)
  })()
Deno.addSignalListener('SIGTERM', () => void close())
await server.finished
await close()
