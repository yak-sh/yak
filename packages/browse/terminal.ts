/** The terminal door installs its DOM and history before loading Browse's
 * one App; its registry, domain host and writes are the browser app's. */
import { doc, install, quit, run, Scroll, useKeys } from '@yaks/tui'
import { interaction } from '@yaks/tui/interaction'
import { terminalHistory } from '@yaks/tui/history'
import { installHistory } from '@yaks/ui/history'
import { everforest, installViewport, kits, sheet } from '@yaks/ui'
import { h } from 'preact'
import type { Connection } from './remote.ts'
import { learn } from './types.ts'
import type { Hosting } from './hosting.ts'

export let open = async (url: string, opts: {
  what?: string
  inspect?: boolean
  wire?: Connection
  facets?: () => Promise<import('./components/inspect.tsx').Facet[]>
} = {}): Promise<void> => {
  let screen = install()
  let port = terminalHistory({ path: '/', state: null })
  let state = Deno.env.get('TASKS_TUI_STATE') ??
    `${Deno.env.get('HOME')}/.yak/browse-terminal.json`
  let go = opts.wire?.fetch ?? fetch
  let at = new URL(url)
  let vocab = await go(
    new Request(`${url}/vocab`, { headers: opts.wire?.headers }),
  )
  if (!vocab.ok) throw new Error(`vocabulary refused (${vocab.status})`)
  learn((await vocab.json()).docs)
  let app = !!at.pathname.replace(/\/$/, '')
  ;(globalThis as { YAK_WEB?: Hosting }).YAK_WEB = {
    page: '',
    api: at.pathname.replace(/\/$/, ''),
    apply: app ? `${at.pathname}/apply` : '/web/apply',
    owner: app
      ? `${at.pathname.replace(/\/api\/?$/, '')}/_web/owner`
      : '/web/owner',
  }
  installHistory(port)
  installViewport(({ children, ...props }) =>
    h(Scroll, { ...props, follow: false, keyboard: false, grow: '1' }, children)
  )
  // The DOM is already installed: none of this application's modules load in
  // a browser-like host by accident, or before the server teaches its words.
  let { App } = await import('./components/App.tsx')
  await import('./domain-host.tsx')
  let live = await import('./live.ts')
  let { bindHistory } = await import('./history.ts')
  let { extend, ux } = await import('./components/registry.ts')
  let { contributedViews } = await import('./components/inspect.tsx')
  let { offer } = await import('./components/Navigation.tsx')
  let { navigate } = await import('./components/nav.tsx')
  let { Ux } = await import('@yaks/ux')
  let { lone } = await import('@yaks/draft/ui')
  let { Md } = await import('./tui/md.tsx')
  let { onMarkdown } = await import('./components/Markdown.tsx')
  live.config.host = at.host
  live.config.secure = at.protocol == 'https:'
  let sockets = new Set<WebSocket>()
  live.useSocket((url) => {
    let socket = opts.wire?.connect
      ? opts.wire.connect(url)
      : new WebSocket(url)
    sockets.add(socket as WebSocket)
    return socket as ReturnType<Parameters<typeof live.useSocket>[0]>
  })
  // Authenticated HTTP goes through the same app adapter as the socket.
  let priorFetch = globalThis.fetch
  if (opts.wire?.headers) {
    globalThis.fetch = async (input, init) => {
      let headers = new Headers(init?.headers)
      for (let [key, value] of Object.entries(opts.wire!.headers!)) {
        headers.set(key, value)
      }
      return await go(new Request(input, { ...init, headers }))
    }
  }
  let facets = await opts.facets?.() ?? []
  extend(contributedViews(facets))
  offer(facets.flatMap((f) => f.destinations ?? []))
  onMarkdown((text, repo, inline) =>
    h(Md, { text, repo: repo ?? undefined, inline })
  )
  try {
    port.restore(JSON.parse(Deno.readTextFileSync(state)))
  } catch { /* first run */ }
  if (opts.what || opts.inspect) {
    let { start } = await import('./terminal-route.ts')
    port.write(
      { path: start(opts.what ?? '', !!opts.inspect), state: null },
      true,
    )
  }
  bindHistory(port)
  let unlisten = port.listen(() =>
    Deno.writeTextFileSync(state, JSON.stringify(port.snapshot()))
  )
  await live.boot()
  void lone()
  let keys = interaction(screen.root, (href) => navigate(href))
  let Terminal = () => {
    useKeys((k) => {
      if (
        k.name == 'char' && !k.ctrl && !k.alt && k.text == 'f' &&
        !doc.activeElement?.matches('input,textarea,select,[contenteditable]')
      ) {
        let field = screen.root.querySelector('.Shell_Side')?.querySelector(
          'input',
        )
        if (field) {
          keys.focus(field)
          return true
        }
      }
      if (
        k.name == 'char' && !k.ctrl && !k.alt && k.text == 'i' &&
        !doc.activeElement?.matches('input,textarea,select,[contenteditable]')
      ) {
        let field = screen.root.querySelector('.Shell_Body')?.querySelector(
          'input,textarea',
        )
        if (field) {
          keys.focus(field)
          return true
        }
      }
      if (keys.press(k)) return true
      if (k.name == 'char' && k.text == 'q') {
        quit()
        return true
      }
      if (
        k.alt && k.name == 'left' || k.ctrl && k.text == 'o' ||
        k.name == 'char' && k.text == 'h'
      ) {
        port.back()
        return true
      }
      if (k.alt && k.name == 'right' || k.ctrl && k.text == 'f') {
        port.forward()
        return true
      }
      return false
    })
    return h(
      Ux,
      { host: { ...ux, Float: undefined, markup: undefined } },
      h(App, {}),
    )
  }
  let c = everforest.colors
  try {
    await run(Terminal, {
      screen,
      sheet: {
        ...sheet({ kits, theme: everforest }),
        'Button-quiet': { block: true },
        Status: { block: true, fg: c.muted },
        Icon: { glyph: '◇' },
        'lucide-menu': { glyph: '≡' },
        'lucide-ellipsis-vertical': { glyph: '⋮' },
        Md_B: { bold: true },
        Md_I: { italic: true },
        Md_S: { strike: true },
        Md_Code: { fg: c.text, bg: c.card },
        Md_H: { bold: true, fg: c.heading },
        Md_Q: { fg: c.muted },
        Md_Fence: { fg: c.dim },
        Entry_Speaker: { fg: c.dim, bold: true, block: true },
      },
    })
  } finally {
    unlisten()
    for (let socket of sockets) socket.close()
    globalThis.fetch = priorFetch
  }
}
