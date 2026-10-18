/** First app content frame in an owned Chrome, cold then warm. The local
 * proxy supplies the same host and cookie as the kernel's browser probe. */
export type PaintPage = { name: string; url: string; ready: string }
export let paint = (url: string, profile: string) =>
  paints([{
    name: 'app',
    url,
    ready:
      "document.querySelector('h1')?.textContent === 'Platform wait content'",
  }], profile)

/** A content predicate, not load or the dashboard shell, ends each wait. */
export let paints = async (pages: PaintPage[], profile: string) => {
  let url = pages[0].url
  let chrome = new Deno.Command('google-chrome', {
    args: [
      '--headless=new',
      '--disable-quic',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let socket: WebSocket | undefined
  try {
    let lines = chrome.stderr.pipeThrough(new TextDecoderStream()).getReader()
    let said = '', root: string | undefined
    while (!(root = said.match(/DevTools listening on (ws:\S+)/)?.[1])) {
      let { value, done } = await lines.read()
      if (done) throw new Error('Chrome did not start: ' + said)
      said += value
    }
    void (async () => {
      while (!(await lines.read()).done);
    })().catch(() => {})
    let target =
      await (await fetch(`http://${new URL(root).host}/json/new?about:blank`, {
        method: 'PUT',
      })).json()
    socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((yes, no) => {
      socket!.onopen = yes
      socket!.onerror = no
    })
    const blocked: string[] = []
    let n = 0
    let waiting = new Map<
      number,
      { yes: (value: Record<string, unknown>) => void; no: (e: Error) => void }
    >()
    socket.onmessage = (event) => {
      let msg = JSON.parse(event.data)
      if (msg.method == 'Fetch.requestPaused') {
        const request = msg.params.request
        const requested = new URL(request.url)
        const platform = requested.origin == 'https://yaks.app' ||
          requested.origin == 'https://bench-management.yaks.app'
        const local = requested.origin == new URL(url).origin || platform
        if (!local) blocked.push(request.url)
        socket!.send(
          JSON.stringify({
            id: ++n,
            method: local ? 'Fetch.continueRequest' : 'Fetch.failRequest',
            params: {
              requestId: msg.params.requestId,
              ...!local ? { errorReason: 'BlockedByClient' } : platform
                ? {
                  url: new URL(
                    (requested.hostname == 'bench-management.yaks.app'
                      ? '/__bench-space'
                      : '') + requested.pathname + requested.search,
                    url,
                  ).href,
                }
                : {},
            },
          }),
        )
        return
      }
      let waiter = waiting.get(msg.id)
      if (!waiter) return
      waiting.delete(msg.id)
      if (msg.error) waiter.no(new Error(JSON.stringify(msg.error)))
      else waiter.yes(msg.result)
    }
    let send = (method: string, params: unknown = {}) =>
      new Promise<Record<string, unknown>>((yes, no) => {
        let id = ++n
        waiting.set(id, { yes, no })
        socket!.send(JSON.stringify({ id, method, params }))
      })
    let evaluate = async (expression: string) => {
      let out = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      })
      return (out.result as { value?: number })?.value
    }
    await send('Page.enable')
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    // Prime the browser network stack outside timing, without warming the app.
    await send('Page.navigate', { url: new URL('/__bench-prime', url).href })
    for (let i = 0; i < 300; i++) {
      if (await evaluate("document.readyState == 'complete' ? 1 : 0")) break
      await new Promise((yes) => setTimeout(yes, 50))
      if (i == 299) throw new Error('Chrome primer timed out')
    }
    let values: Record<string, number> = {}
    for (let page of pages) {
      let script = await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `requestAnimationFrame(function look() {
          if (document.readyState !== 'loading' && (${page.ready})) {
            requestAnimationFrame(() => { globalThis.__platformPaint = performance.now() })
          } else requestAnimationFrame(look)
        })`,
      })
      for (let mode of ['cold', 'warm']) {
        // Do not read a timestamp left by the document being navigated away from.
        await evaluate('delete globalThis.__platformPaint')
        await send('Page.navigate', { url: page.url })
        for (let i = 0; i < 600; i++) {
          let value = await evaluate('globalThis.__platformPaint')
          if (value) {
            values[`${page.name}/paint-${mode}`] = value
            break
          }
          if (i == 599) {
            throw new Error(`content did not paint (${page.name}/${mode})`)
          }
          await new Promise((yes) => setTimeout(yes, 50))
        }
      }
      await send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: script.identifier,
      })
    }
    if (blocked.length) {
      throw new Error(
        'Chrome attempted external requests: ' + blocked.join(', '),
      )
    }
    return values
  } finally {
    if (socket?.readyState == WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: 999999, method: 'Browser.close' }))
      socket.close()
    }
    let gone = await Promise.race([
      chrome.status,
      new Promise((yes) => setTimeout(() => yes(undefined), 5000)),
    ])
    if (!gone) {
      chrome.kill('SIGKILL')
      await chrome.status
    }
  }
}
