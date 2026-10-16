/** How long tasks.yak.sh takes to paint, as a person gets it: browse's home
 * `/` and a task's page, each opened cold (a new browser profile: no cache and
 * no stored rows) and then warm (the same profile, reopened once the first
 * load has settled), in headless Chrome against the box's live server.
 *
 * A figure is the milliseconds from navigation to the first frame where the
 * page shows what it is for: home's first rows (or the owner's inbox with its
 * threads loaded), or the task's title. A page that has not painted in 30 s
 * fails the run, saying which mark never appeared, so a page that never loads
 * is a failure and not a very slow figure.
 *
 * A person's browser is already running, so each new one first opens a blank
 * page on another origin before anything is timed. A browser's first
 * navigation starts its network stack, which on a busy box took anywhere from
 * 0.3 to 5 s for a one-line page, and that is the box, not the page. The page
 * itself stays cold: its origin has no cache, no stored rows and no connection.
 *
 * The measurement only reads. Every request the page makes passes through
 * the DevTools Fetch domain, and anything but GET, HEAD or OPTIONS (the
 * `opened` mark a task page writes, a draft) is refused there before it
 * leaves the browser; the profile and the writes it queued are deleted after.
 *
 *   deno task bench pages [-- --url=http://127.0.0.1:5173 --task=T-121470] */
import type { CollectedSuite } from '@yaks/benchmark'
import { configPath, read } from '../packages/cli/config.ts'

/** A page and the mark that says it has painted, as a page expression. */
type Page = { name: string; path: string; painted: string }

/** The pages measured. The task is a finished one nobody holds, with the
 * owner's words and a few comments, so its page holds still. Home is the
 * owner in the home page a plugin offers (the inbox, its threads loaded) or,
 * with none, the rows drawn for them. */
export let pages = (task = 'T-121470'): Page[] => [{
  name: 'home',
  path: '/',
  painted: `!!document.querySelector('.Shell_Body .Rows_Item') ||
    !!document.querySelector('.Shell_Body .Inbox') &&
    !document.querySelector('.Shell_Body .Inbox [role=status]')`,
}, {
  name: 'task',
  path: `/${task}`,
  painted: `!!document.querySelector('.Shell_Body .Show_Title')
    ?.textContent.trim()`,
}]

/** How long a page may take before the run fails, and how long a cold load
 * settles (its rows stored, its socket quiet) before the warm one. */
let PATIENCE = 30_000, SETTLE = 2_000

/** The box's own server, at the port of the config `yak` opens. */
export let live = (): string => {
  let path = configPath()
  return `http://127.0.0.1:${(path && read(path).port) || 5173}`
}

let sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms))

/** A DevTools socket: each command answered by its id, events to `on`. */
let devtools = async (
  url: string,
  on: (method: string, params: Record<string, unknown>) => void = () => {},
) => {
  let socket = new WebSocket(url), n = 0
  let waiting = new Map<number, (m: Record<string, unknown>) => void>()
  socket.onmessage = (m) => {
    let msg = JSON.parse(m.data)
    if (msg.id) waiting.get(msg.id)?.(msg), waiting.delete(msg.id)
    else on(msg.method, msg.params)
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

/** A blank page on an origin of its own, for a new browser's first navigation. */
let primer = () => {
  let server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    () => new Response('<p>', { headers: { 'content-type': 'text/html' } }),
  )
  return {
    url: `http://127.0.0.1:${server.addr.port}/`,
    close: server.shutdown,
  }
}

/** Open `page` in a new browser twice, and say how long each took to paint. */
let open = async (base: string, page: Page, prime: string) => {
  let dir = await Deno.makeTempDir({ dir: '/tmp', prefix: 'cdp-pages-' })
  let chrome = new Deno.Command('google-chrome', {
    args: [
      '--headless=new',
      '--disable-quic',
      '--remote-debugging-port=0',
      `--user-data-dir=${dir}`,
      '--window-size=1280,800',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    stdout: 'null',
    stderr: 'piped',
  }).spawn()
  let browser: Awaited<ReturnType<typeof devtools>> | undefined
  try {
    let lines = chrome.stderr.pipeThrough(new TextDecoderStream()).getReader()
    let said = '', root: string | undefined
    while (!(root = said.match(/DevTools listening on (ws:\S+)/)?.[1])) {
      let { value, done } = await lines.read()
      if (done) throw new Error(`Chrome did not start:\n${said}`)
      said += value
    }
    ;(async () => {
      while (!(await lines.read()).done);
    })().catch(() => {})
    browser = await devtools(root)
    let target = await (await fetch(
      `http://${new URL(root).host}/json/new?about:blank`,
      { method: 'PUT' },
    )).json()
    let tab: Awaited<ReturnType<typeof devtools>> = await devtools(
      target.webSocketDebuggerUrl,
      (method, params) => {
        if (method != 'Fetch.requestPaused') return
        let { requestId, request } = params as {
          requestId: string
          request: { method: string }
        }
        let reads = ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        tab.send(
          reads ? 'Fetch.continueRequest' : 'Fetch.failRequest',
          reads ? { requestId } : { requestId, errorReason: 'BlockedByClient' },
        ).catch(() => {})
      },
    )
    await tab.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    await tab.send('Page.enable')
    // Watched every frame from the document's first moment, so the figure is
    // the frame the mark appeared in, not when a poll happened to look.
    await tab.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        let look = () => {
          try {
            if (${page.painted}) return globalThis.__painted = performance.now()
          } catch {}
          requestAnimationFrame(look)
        }
        requestAnimationFrame(look)
      })()`,
    })
    // Navigate, then the value of `expression` once it holds, or a failure
    // saying what never did.
    let visit = async (url: string, expression: string, what: string) => {
      await tab.send('Page.navigate', { url })
      let until = Date.now() + PATIENCE
      while (Date.now() < until) {
        let { result } = await tab.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
        }) as { result: { value?: unknown } }
        if (result.value) return result.value
        await sleep(50)
      }
      throw new Error(`${what} within ${PATIENCE / 1000} s`)
    }
    let paint = async () => {
      // The last document's mark must not answer for the next one.
      await tab.send('Runtime.evaluate', {
        expression: 'delete globalThis.__painted',
      })
      return Math.round(
        await visit(
          base + page.path,
          'globalThis.__painted',
          `${page.name} (${page.path}) did not paint: ${
            page.painted.replace(/\s+/g, ' ')
          } never held`,
        ) as number,
      )
    }
    await visit(
      prime,
      `location.href == ${
        JSON.stringify(prime)
      } && document.readyState == 'complete'`,
      `the blank page ${prime} did not load`,
    )
    let cold = await paint()
    await sleep(SETTLE)
    let warm = await paint()
    tab.close()
    return { [`${page.name}/cold`]: cold, [`${page.name}/warm`]: warm }
  } finally {
    await browser?.send('Browser.close').catch(() => {})
    browser?.close()
    let gone = await Promise.race([chrome.status, sleep(5_000)])
    if (!gone) chrome.kill('SIGKILL'), await chrome.status
    await Deno.remove(dir, { recursive: true }).catch(() => {})
  }
}

/** The suite: `--url=` names another server, `--task=` another task. */
export let suite = (args: string[] = []): CollectedSuite => {
  let flag = (name: string) =>
    args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  let base = flag('url') ?? live(), task = flag('task')
  let measured = pages(task)
  return {
    name: 'pages',
    metric: 'median-of-round-medians',
    workload: args.length ? JSON.stringify([1, base, task]) : 1,
    benches: measured.flatMap((p) =>
      ['cold', 'warm'].map((w) => ({
        name: `${p.name}/${w}`,
        unit: 'ms',
        resolution: 1,
      }))
    ),
    collect: async () => {
      let out: Record<string, number> = {}
      let blank = primer()
      try {
        for (let page of measured) {
          Object.assign(out, await open(base, page, blank.url))
        }
      } finally {
        await blank.close()
      }
      return out
    },
  }
}
