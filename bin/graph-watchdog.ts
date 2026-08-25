#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env --allow-run=ss
// A graph-INDEPENDENT health watchdog for the tasks server. Run by cron every
// ~2 min. Its whole reason to exist: TaskMaster and the owner must learn the
// instant the graph server is down or crash-looping — and the graph server is
// exactly what's down when that must happen, so an alert that rides the graph
// (a knock, a `task mail`) is dead on arrival. holdco-deadman already pages on
// silence, but IT pages via `task mail`, i.e. through the graph, so it cannot
// report the graph itself being down. This watchdog reaches the owner through
// the Cloudflare Email Sending API DIRECTLY — the same door mail uses, inlined
// here so this script imports nothing from src/ and shares no failure mode with
// what it watches (the deadman's founding principle: a checker inside the thing
// it checks dies with it).
//
// Detection: a real request to /providers (not just "is the port open"), plus
// pid-churn flap detection — a crash-looping server answers intermittently and
// its listening pid changes every few seconds, which reads as `crashloop`, not
// `healthy`. Alerts fire on state TRANSITION (healthy→trouble, →recovery) and
// then only every REMINDER ms while trouble persists, so a long outage doesn't
// page every run. Exit 0 only when healthy, so the run is itself deadman-
// stampable.

let PORT = Deno.env.get('GRAPH_WATCHDOG_PORT') ?? '5173'
let URL = Deno.env.get('GRAPH_WATCHDOG_URL') ??
  `http://127.0.0.1:${PORT}/providers`
let STATE = Deno.env.get('GRAPH_WATCHDOG_STATE') ??
  `${Deno.env.get('HOME')}/.tasks/graph-watchdog.json`
let ENV_FILE = '/home/yaks/code/holdco/.env'
let OWNER = 'jeff@yak.sh'
let FROM = 'graph-watchdog@bot.yak.sh'

let WINDOW = 6 // checks kept for cross-run flap detection
let FLAP_PIDS = 3 // ≥ this many distinct listening pids in the window = churn
let DOWN_N = 2 // this many trailing failed checks = sustained down
let REMINDER = 30 * 60 * 1000 // re-page an ongoing outage at most this often

export type Check = {
  t: number
  pid: number | null
  ok: boolean
  flapped: boolean
}
export type Health = 'healthy' | 'down' | 'crashloop'
export type State = {
  history: Check[]
  health: Health
  lastAlertAt: number
  lastKind: string
}

// PURE. Classify recent checks. `crashloop` wins over `down`/`healthy` because
// a flapping server produces a mix of successes, failures, and changing pids —
// and that instability, not a clean silence, is the thing hardest to notice by
// eye. `flapped` is intra-run pid churn (fast signal); FLAP_PIDS is cross-run
// churn (slow signal); either trips it.
export let classify = (history: Check[]): Health => {
  let recent = history.slice(-WINDOW)
  if (recent.length === 0) return 'healthy'
  let pids = new Set(recent.filter((c) => c.pid != null).map((c) => c.pid))
  if (recent.some((c) => c.flapped) || pids.size >= FLAP_PIDS) {
    return 'crashloop'
  }
  let tail = recent.slice(-DOWN_N)
  if (tail.length >= DOWN_N && tail.every((c) => !c.ok)) return 'down'
  return 'healthy' // a single failed check is an unconfirmed blip, not yet down
}

// PURE. Decide whether to page and with what kind, given the new health, the
// prior health, and when we last paged. Trouble on a healthy→trouble edge
// pages at once; a persistent outage re-pages only past REMINDER; recovery
// pages once. Steady-healthy and steady-trouble-within-REMINDER stay silent.
export let decideAlert = (
  prev: Health,
  next: Health,
  lastAlertAt: number,
  now: number,
): string | null => {
  let bad = (s: Health) => s === 'down' || s === 'crashloop'
  if (bad(next) && !bad(prev)) return next
  if (bad(next) && bad(prev)) {
    return now - lastAlertAt >= REMINDER ? `${next}-reminder` : null
  }
  if (!bad(next) && bad(prev)) return 'recovery'
  return null
}

// PURE. The two secrets, read out of an .env file's KEY=value lines (comments
// and blanks ignored); a real process env var wins when present. Parsing the
// file directly — rather than sourcing it — keeps the watchdog self-sufficient
// however cron invokes it.
export let readEnv = (text: string, key: string): string | undefined => {
  for (let line of text.split('\n')) {
    let m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}

let creds = () => {
  let text = ''
  try {
    text = Deno.readTextFileSync(ENV_FILE)
  } catch { /* env vars may still carry them */ }
  let token = Deno.env.get('CLOUDFLARE_EMAIL_TOKEN') ??
    readEnv(text, 'CLOUDFLARE_EMAIL_TOKEN')
  let account = Deno.env.get('HOLDCO_CF_ACCOUNT_ID') ??
    readEnv(text, 'HOLDCO_CF_ACCOUNT_ID')
  return token && account ? { token, account } : null
}

// The listening pid on :5173, or null if nothing is bound. `ss` is the same
// tool the incident triage used; a changing pid across runs is the crash-loop.
let listeningPid = async (): Promise<number | null> => {
  try {
    let out = await new Deno.Command('ss', {
      args: ['-lptnH', `sport = :${PORT}`],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    let m = new TextDecoder().decode(out.stdout).match(/pid=(\d+)/)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

let reachable = async (): Promise<boolean> => {
  try {
    let res = await fetch(URL, { signal: AbortSignal.timeout(5000) })
    await res.body?.cancel()
    return res.ok
  } catch {
    return false
  }
}

// One check, with intra-run flap sampling: read the pid, wait briefly, read it
// again — a change inside a single run is immediate crash-loop evidence that a
// coarse 2-min cron would otherwise miss.
let probe = async (): Promise<Check> => {
  let pid1 = await listeningPid()
  let ok = await reachable()
  await new Promise((r) => setTimeout(r, 4000))
  let pid2 = await listeningPid()
  return {
    t: Date.now(),
    pid: pid2,
    ok,
    flapped: pid1 != null && pid2 != null && pid1 !== pid2,
  }
}

let alertText = (kind: string, c: Check): { subject: string; body: string } => {
  let base = kind.replace('-reminder', '')
  let head = base === 'recovery'
    ? '✅ tasks graph server RECOVERED'
    : base === 'crashloop'
    ? '🔁 tasks graph server CRASH-LOOPING'
    : '🔴 tasks graph server DOWN'
  let note = kind.endsWith('-reminder') ? ' (still)' : ''
  return {
    subject: `${head}${note}`,
    body: [
      `${head}${note} at ${new Date(c.t).toISOString()}`,
      ``,
      `endpoint: ${URL} — ${c.ok ? 'answering' : 'no 200'}`,
      `listening pid on :${PORT}: ${c.pid ?? '(none)'}`,
      c.flapped
        ? `pid changed within one check — the process is restarting`
        : ``,
      ``,
      `This is the out-of-band graph watchdog (bin/graph-watchdog.ts); it reaches`,
      `you via Cloudflare email, not the graph, because the graph is what's down.`,
      base === 'recovery'
        ? ``
        : `Check the dev supervisor / server.log for the crash trace.`,
    ].filter((l) => l !== null).join('\n'),
  }
}

// Inlined Cloudflare Email Sending — deliberately NOT imported from src/mailer.ts
// so a broken src/ can't disarm the alarm. Text + a minimal html part, matching
// the payload shape mailer.ts uses.
let page = async (kind: string, c: Check): Promise<void> => {
  let cfg = creds()
  if (!cfg) {
    throw new Error(
      'no CLOUDFLARE_EMAIL_TOKEN / HOLDCO_CF_ACCOUNT_ID — cannot page',
    )
  }
  let { subject, body } = alertText(kind, c)
  let esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // CLOUDFLARE_API_BASE re-aims the send at a capture server for a probe (the
  // same override mailer.ts honors); the default is the real API.
  let api = Deno.env.get('CLOUDFLARE_API_BASE') ??
    'https://api.cloudflare.com/client/v4'
  let res = await fetch(
    `${api}/accounts/${cfg.account}/email/sending/send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: FROM, name: 'graph-watchdog' },
        to: [OWNER],
        reply_to: FROM,
        subject,
        text: body,
        html: `<pre>${esc(body)}</pre>`,
      }),
    },
  )
  if (!res.ok) {
    throw new Error(
      `page failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`,
    )
  }
}

let load = (): State => {
  try {
    return JSON.parse(Deno.readTextFileSync(STATE))
  } catch {
    return { history: [], health: 'healthy', lastAlertAt: 0, lastKind: '' }
  }
}

let save = (s: State) => {
  try {
    Deno.writeTextFileSync(STATE, JSON.stringify(s))
  } catch (e) {
    console.error(`graph-watchdog: cannot write ${STATE}: ${e}`)
  }
}

let main = async () => {
  let state = load()
  let check = await probe()
  let history = [...state.history, check].slice(-WINDOW * 2)
  let next = classify(history)
  let kind = decideAlert(state.health, next, state.lastAlertAt, check.t)

  if (kind) {
    try {
      await page(kind, check)
      state.lastAlertAt = check.t
      state.lastKind = kind
      console.error(
        `graph-watchdog: paged ${kind} (health ${state.health}→${next})`,
      )
    } catch (e) {
      // A watchdog that detects correctly and reaches nobody is the one failure
      // it must not have: shout to the log and exit nonzero so the run is NOT
      // deadman-stampable and the next sweep retries.
      console.error(`graph-watchdog: DETECTED ${next} BUT PAGE FAILED: ${e}`)
      state.history = history
      save(state)
      Deno.exit(2)
    }
  }

  state.history = history
  state.health = next
  save(state)
  console.error(`graph-watchdog: ${next}${kind ? ` (paged ${kind})` : ''}`)
  Deno.exit(next === 'healthy' ? 0 : 1)
}

if (import.meta.main) await main()
