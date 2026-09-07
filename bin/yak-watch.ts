// yaks.app's box-side alarm: the public verifier and a few named live apps.
// Exit 0 means the check completed and any owed page was accepted. A detected
// outage still stamps the deadman; a broken monitor or mail door does not.
import { FROM, REPLY_TO } from '../workers/yak/mail-config.ts'
import { PLATFORM, SLUG } from '../workers/yak/route.ts'

export type Probe = { app: string; url: string; login: boolean }

export let probes = (text: string): Probe[] => {
  let rows: unknown = JSON.parse(text)
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('watch.json must contain a nonempty list of apps')
  }
  let seen = new Set<string>()
  return rows.map((row) => {
    if (
      !row || typeof row != 'object' || typeof row.app != 'string' ||
      Object.keys(row).some((key) => !['app', 'login'].includes(key)) ||
      (row.login !== undefined && typeof row.login != 'boolean')
    ) throw new Error('watch.json entries need app and optional login boolean')
    let [space, app, extra] = row.app.split('/')
    if (
      !space || !app || extra != undefined || !SLUG.test(space) ||
      !SLUG.test(app)
    ) {
      throw new Error(`invalid watched app: ${row.app}`)
    }
    if (seen.has(row.app)) throw new Error(`duplicate watched app: ${row.app}`)
    seen.add(row.app)
    return {
      app: row.app,
      url: `https://${space}.${PLATFORM}/${app}/`,
      login: row.login ?? false,
    }
  })
}

export let probe = async (p: Probe, get = fetch): Promise<string | null> => {
  try {
    let res = await get(p.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
    await res.text()
    if (!p.login && res.status == 200) return null
    let login = new URL(`https://${PLATFORM}/login`)
    login.searchParams.set('return', p.url)
    if (
      p.login && res.status == 303 && res.headers.get('location') == login.href
    ) {
      return null
    }
    return `${p.url}: HTTP ${res.status}, want ${
      p.login ? 'its login redirect' : '200'
    }`
  } catch (e) {
    return `${p.url}: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Kill a hung verifier before the next five-minute pass, including a response
// whose headers arrived but whose body never finished.
export let command = async (args: string[], ms = 30_000) => {
  let child = new Deno.Command(Deno.execPath(), {
    args,
    cwd: new URL('../', import.meta.url),
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let expired = false
  let timer = setTimeout(() => {
    expired = true
    try {
      child.kill('SIGKILL')
    } catch { /* it finished just as the deadline fired */ }
  }, ms)
  try {
    let out = await child.output()
    let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim()
    return {
      ok: out.success && !expired,
      text: expired
        ? `verify-deploy timed out after ${ms / 1000}s`
        : [decode(out.stdout), decode(out.stderr)].filter(Boolean).join('\n'),
    }
  } finally {
    clearTimeout(timer)
  }
}

export let check = async (list: Probe[]) => {
  let [verified, apps] = await Promise.all([
    command(['run', '--allow-net', 'bin/verify-deploy.ts', '--tail', '0']),
    Promise.all(list.map((p) => probe(p))),
  ])
  return [
    ...(verified.ok ? [] : [verified.text || 'verify-deploy failed']),
    ...apps.filter((fault): fault is string => fault != null),
  ]
}

export type State = {
  first: number | null
  last: number
  count: number
  paged: boolean
  faults: string[]
}

// Recovery re-arms the alarm; changed symptoms during an outage do not.
export let advance = (
  old: State | null,
  faults: string[],
  now: number,
): State => ({
  first: faults.length ? old?.first ?? now : null,
  last: now,
  count: faults.length ? (old?.count ?? 0) + 1 : 0,
  paged: faults.length ? old?.paged ?? false : false,
  faults,
})

export let report = async (
  state: State,
  send: (body: string) => Promise<void>,
) => {
  if (state.first == null || state.paged) return state
  await send([
    `yaks.app failed its external checks at ${
      new Date(state.first).toISOString()
    }.`,
    '',
    ...state.faults,
    '',
    'bin/yak-watch checks every five minutes. This outage is paged once;',
    'a healthy pass re-arms the next page. Check the yak deployment and incidents.',
  ].join('\n'))
  return { ...state, paged: true }
}

// Read the box's existing mail configuration without sourcing executable shell.
export let envValue = (text: string, key: string) => {
  for (let line of text.split('\n')) {
    let match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (match?.[1] == key) return match[2].trim().replace(/^["']|["']$/g, '')
  }
}

let mailConfig = async () => {
  let text = ''
  try {
    text = await Deno.readTextFile(
      Deno.env.get('YAK_WATCH_ENV') ?? '/home/yaks/code/holdco/.env',
    )
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  let value = (key: string) => Deno.env.get(key) ?? envValue(text, key)
  let token = value('CLOUDFLARE_EMAIL_TOKEN')
  let account = value('HOLDCO_CF_ACCOUNT_ID')
  if (!token || !account) {
    throw new Error('configure CLOUDFLARE_EMAIL_TOKEN and HOLDCO_CF_ACCOUNT_ID')
  }
  return {
    token,
    account,
    owner: value('YAK_OWNER_EMAIL') ?? REPLY_TO,
    api: value('CLOUDFLARE_API_BASE') ?? 'https://api.cloudflare.com/client/v4',
  }
}

export let page = async (
  cfg: Awaited<ReturnType<typeof mailConfig>>,
  body: string,
  send = fetch,
) => {
  let res = await send(
    `${cfg.api}/accounts/${cfg.account}/email/sending/send`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${cfg.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: FROM, name: 'yaks.app watchdog' },
        to: [cfg.owner],
        reply_to: REPLY_TO,
        subject: 'yaks.app is failing its live checks',
        text: body,
        html: `<pre>${
          body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll(
            '>',
            '&gt;',
          )
        }</pre>`,
      }),
    },
  )
  let data = await res.json() as {
    success?: boolean
    result?: {
      message_id?: string
      delivered?: string[]
      queued?: string[]
      permanent_bounces?: string[]
      suppressed_recipients?: string[]
    }
  }
  let result = data.result ?? {}
  let recipients = [
    'delivered',
    'queued',
    'permanent_bounces',
    'suppressed_recipients',
  ].some((key) => Object.hasOwn(result, key))
  // REST reports delivery per recipient; older responses carry only an id.
  // A receipt must never override a bounced or missing owner in a status list.
  let accepted = recipients
    ? !result.permanent_bounces?.length &&
      !result.suppressed_recipients?.length &&
      [result.delivered, result.queued].some((list) =>
        Array.isArray(list) && list.includes(cfg.owner)
      )
    : typeof result.message_id == 'string' && !!result.message_id.trim()
  if (!res.ok || !data.success || !accepted) {
    throw new Error(`page not accepted by Cloudflare (HTTP ${res.status})`)
  }
  console.log(`yak-watch paged: ${result.message_id || 'accepted'}`)
}

let save = async (path: string, state: State) => {
  await Deno.writeTextFile(`${path}.tmp`, JSON.stringify(state), {
    mode: 0o600,
  })
  await Deno.rename(`${path}.tmp`, path)
}

export let main = async (args = Deno.args) => {
  if (args.some((arg) => arg != '--probe')) {
    throw new Error('usage: yak-watch [--probe]')
  }
  let list = probes(
    await Deno.readTextFile(
      new URL('../workers/yak/watch.json', import.meta.url),
    ),
  )
  if (args.includes('--probe')) {
    let faults = await check(list)
    console.log(
      faults.length ? faults.join('\n') : 'yaks.app: all live checks passed',
    )
    return faults.length ? 1 : 0
  }
  let cfg = await mailConfig()
  let path = Deno.env.get('YAK_WATCH_STATE') ??
    `${Deno.env.get('HOME')}/.tasks/yak-watch.json`
  let dir = path.includes('/')
    ? path.slice(0, path.lastIndexOf('/')) || '/'
    : '.'
  await Deno.mkdir(dir, { recursive: true })
  using lock = await Deno.open(`${path}.lock`, {
    create: true,
    write: true,
    mode: 0o600,
  })
  await lock.lock()
  let old: State | null = null
  try {
    old = JSON.parse(await Deno.readTextFile(path))
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  let state = advance(old, await check(list), Date.now())
  await save(path, state)
  state = await report(state, (body) => page(cfg, body))
  await save(path, state)
  console.log(
    `${new Date(state.last).toISOString()} yak-watch: ${
      state.faults.length ? `DOWN (paged)\n${state.faults.join('\n')}` : 'ok'
    }`,
  )
  return 0
}

if (import.meta.main) {
  try {
    Deno.exit(await main())
  } catch (e) {
    console.error(
      `yak-watch failed: ${e instanceof Error ? e.message : String(e)}`,
    )
    Deno.exit(2)
  }
}
