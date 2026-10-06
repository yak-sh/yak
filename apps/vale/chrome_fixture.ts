// Headless Chrome for the tests that need a browser's layout, which a
// stand-in document cannot give: one browser per call, with a throwaway
// profile of its own, driven over the DevTools protocol and closed after.
// `chromeBin` is undefined where no Chrome is installed (`CHROME` names one).
import { until } from '@yaks/testing'

/** A browser tab, as a test drives it. */
export type Tab = {
  /** lay the page out in a window this size, a phone's or a desktop's */
  size: (width: number, height: number) => Promise<void>
  /** open `url`, and wait until it has loaded */
  open: (url: string) => Promise<void>
  /** what `expression` comes to in the page, as JSON */
  run: <T>(expression: string) => Promise<T>
}

let NAMES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
]
let onPath = (name: string) =>
  (Deno.env.get('PATH') ?? '').split(':').map((dir) => `${dir}/${name}`)
    .find((path) => {
      try {
        return Deno.statSync(path).isFile
      } catch {
        return false
      }
    })

export let chromeBin: string | undefined = Deno.env.get('CHROME') ??
  NAMES.map(onPath).find(Boolean)

// A DevTools socket: each command answered by its id.
let connect = async (url: string) => {
  let socket = new WebSocket(url), n = 0
  let waiting = new Map<
    number,
    (m: { result?: unknown; error?: unknown }) => void
  >()
  socket.onmessage = (m) => {
    let msg = JSON.parse(m.data)
    waiting.get(msg.id)?.(msg)
    waiting.delete(msg.id)
  }
  await new Promise((ok, no) => (socket.onopen = ok, socket.onerror = no))
  let send = (method: string, params: unknown = {}) =>
    new Promise<Record<string, unknown>>((ok, no) => {
      let id = ++n
      waiting.set(
        id,
        (msg) =>
          msg.error
            ? no(new Error(`${method}: ${JSON.stringify(msg.error)}`))
            : ok(msg.result as Record<string, unknown>),
      )
      socket.send(JSON.stringify({ id, method, params }))
    })
  return { send, close: () => socket.close() }
}

/** Run `use` with a tab in a headless Chrome, then close the browser. */
export let withChrome = async <T>(
  use: (tab: Tab) => Promise<T>,
): Promise<T> => {
  // Chrome keeps a socket in its profile, whose path must stay short.
  let dir = await Deno.makeTempDir({ dir: '/tmp', prefix: 'cdp-' })
  let child = new Deno.Command(chromeBin!, {
    args: [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--allow-file-access-from-files',
      'about:blank',
    ],
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let lines = child.stderr.pipeThrough(new TextDecoderStream()).getReader()
  let said = '', browser: string | undefined
  while (!(browser = said.match(/DevTools listening on (ws:\S+)/)?.[1])) {
    let { value, done } = await lines.read()
    if (done) throw new Error(`Chrome did not start:\n${said}`)
    said += value
  }
  let drained = (async () => {
    while (!(await lines.read()).done);
  })()
  let host = new URL(browser).host
  let target = await (await fetch(`http://${host}/json/new?about:blank`, {
    method: 'PUT',
  })).json()
  let page = await connect(target.webSocketDebuggerUrl)
  let run = async <T>(expression: string): Promise<T> => {
    let { result, exceptionDetails } = await page.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as {
      result: { value: T }
      exceptionDetails?: { exception?: { description?: string } }
    }
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? expression)
    }
    return result.value
  }
  let tab: Tab = {
    size: async (width, height) => {
      await page.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 640,
      })
    },
    open: async (url) => {
      await page.send('Page.navigate', { url })
      await until(
        () =>
          run<boolean>(
            `location.href == ${
              JSON.stringify(url)
            } && document.readyState == 'complete'`,
          ),
        { timeout: 15_000, label: `Chrome loads ${url}` },
      )
    },
    run,
  }
  try {
    return await use(tab)
  } finally {
    page.close()
    let root = await connect(browser).catch(() => null)
    await root?.send('Browser.close').catch(() => {})
    root?.close()
    await child.status
    await drained.catch(() => {})
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}
