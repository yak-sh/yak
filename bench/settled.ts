/** A host composed with the web role bundles its page's script as it starts
 * (@yaks/web `/web/app.js`, made early), in a child process. A sample's CPU
 * reading (@yaks/benchmark `stopwatch`) counts a child once it is reaped, so
 * whichever sample the bundler finished during would carry its seconds. A
 * bench that times CPU over such a host waits for it before its first sample. */
import type { Host } from '@yaks/host'

export let settled = async (host: Pick<Host, 'handler'>): Promise<void> => {
  if (!host.handler) return
  let made = await host.handler(new Request('http://127.0.0.1/web/app.js'))
  await made.arrayBuffer()
}
