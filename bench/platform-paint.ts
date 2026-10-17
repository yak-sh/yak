/** First app content frame in an owned Chrome, cold then warm. The local
 * proxy supplies the same host and cookie as the kernel's browser probe. */
export let paint = async (url: string, profile: string) => {
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
    let n = 0
    let waiting = new Map<
      number,
      { yes: (value: Record<string, unknown>) => void; no: (e: Error) => void }
    >()
    socket.onmessage = (event) => {
      let msg = JSON.parse(event.data), waiter = waiting.get(msg.id)
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
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `requestAnimationFrame(function look() {
        let heading = document.querySelector('h1')
        if (heading?.textContent === 'Platform wait content' && heading.getBoundingClientRect().height > 0) {
          requestAnimationFrame(() => { globalThis.__platformPaint = performance.now() })
        } else requestAnimationFrame(look)
      })`,
    })
    // Prime the browser network stack outside timing, without warming the app.
    await send('Page.navigate', { url: new URL('/__bench-prime', url).href })
    for (let i = 0; i < 300; i++) {
      if (await evaluate("document.readyState == 'complete' ? 1 : 0")) break
      await new Promise((yes) => setTimeout(yes, 50))
      if (i == 299) throw new Error('Chrome primer timed out')
    }
    let values: Record<string, number> = {}
    for (let mode of ['cold', 'warm']) {
      await evaluate('delete globalThis.__platformPaint')
      await send('Page.navigate', { url })
      for (let i = 0; i < 600; i++) {
        let value = await evaluate('globalThis.__platformPaint')
        if (value) {
          values[`app/paint-${mode}`] = value
          break
        }
        if (i == 599) throw new Error(`app content did not paint (${mode})`)
        await new Promise((yes) => setTimeout(yes, 50))
      }
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
