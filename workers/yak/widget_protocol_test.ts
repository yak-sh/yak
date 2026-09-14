/** Execute shipped widget scripts against a strict MCP Apps host. */
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'

type Message = {
  id?: number
  method?: string
  params?: Record<string, unknown>
  [key: string]: unknown
}

for (const page of ['apps', 'errors']) {
  Deno.test(`${page} widget identifies app and sizes only after initialization`, async () => {
    const html = await Deno.readTextFile(
      new URL(`./public/${page}.html`, import.meta.url),
    )
    const { document } = parseHTML(html)
    const listeners = new Set<(event: { data: Message }) => void>()
    const sent: Message[] = []
    const window = {
      addEventListener: (_: string, fn: (event: { data: Message }) => void) =>
        listeners.add(fn),
      removeEventListener: (
        _: string,
        fn: (event: { data: Message }) => void,
      ) => listeners.delete(fn),
      parent: { postMessage: (message: Message) => sent.push(message) },
    }
    class ResizeObserver {
      constructor(private callback: () => void) {}
      observe() {
        this.callback()
      }
    }
    new Function(
      'window',
      'document',
      'ResizeObserver',
      'setTimeout',
      document.querySelector('script')!.textContent!,
    )(window, document, ResizeObserver, () => 0)
    assertEquals(sent.length, 1)
    const init = sent[0]
    assertEquals(init.method, 'ui/initialize')
    assertEquals(init.params?.appInfo, {
      name: `yaks.app ${page} view`,
      version: '1',
    })
    assertEquals(init.params?.clientInfo, undefined)
    for (const callback of [...listeners]) {
      callback({
        data: {
          jsonrpc: '2.0',
          id: init.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'test', version: '1' },
            hostCapabilities: {},
            hostContext: {},
          },
        },
      })
    }
    await Promise.resolve()
    assertEquals(sent[1].method, 'ui/notifications/initialized')
    assertEquals(sent[2].method, 'ui/notifications/size-changed')
    const result = page == 'apps'
      ? { spaces: [] }
      : { errors: [], space: 'test', app: 'test' }
    for (const callback of [...listeners]) {
      callback({
        data: {
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: { structuredContent: result },
        },
      })
    }
    assert(!document.body.textContent!.includes('Looking…'))
  })
}

for (const page of ['apps', 'errors']) {
  Deno.test(`${page} widget does not acknowledge rejected initialization`, async () => {
    const { document } = parseHTML(
      await Deno.readTextFile(
        new URL(`./public/${page}.html`, import.meta.url),
      ),
    )
    const listeners = new Set<(event: { data: Message }) => void>()
    const sent: Message[] = []
    const window = {
      addEventListener: (_: string, fn: (event: { data: Message }) => void) =>
        listeners.add(fn),
      removeEventListener: (
        _: string,
        fn: (event: { data: Message }) => void,
      ) => listeners.delete(fn),
      parent: { postMessage: (message: Message) => sent.push(message) },
    }
    class ResizeObserver {
      constructor(private callback: () => void) {}
      observe() {
        this.callback()
      }
    }
    new Function(
      'window',
      'document',
      'ResizeObserver',
      'setTimeout',
      document.querySelector('script')!.textContent!,
    )(window, document, ResizeObserver, () => 0)
    for (const callback of [...listeners]) {
      callback({
        data: {
          jsonrpc: '2.0',
          id: sent[0].id,
          error: { code: -32602, message: 'Invalid appInfo' },
        },
      })
    }
    await Promise.resolve()
    await Promise.resolve()
    assertEquals(sent.length, 1)
    assert(
      document.body.textContent!.includes('Could not initialize this view.'),
    )
  })
}
