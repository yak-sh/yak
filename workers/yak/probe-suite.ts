// The one workerd environment a test run has: the kernel under wrangler's own
// test harness (`createTestHarness`), started once by the runner's workerd
// pass (bin/test.ts), shared by every `*_workerd_test.ts`, and closed after
// the last of them (M-39441). Tests keep apart by their data — a person, a
// space, an address of their own — never by an environment of their own.
//
// The test config is wrangler.toml's, less what cannot run on this box: the
// sandbox's container, and the bindings that only exist on the account (AI,
// vectorize, the dispatch namespace, service bindings). The kernel is written
// to answer without them, as it does under `wrangler dev`.
//
// What the run's tests share, it is handed in the environment:
//
//   YAK_PROBE          the kernel's address; a hostname rides `x-yak-host`,
//                      and `/__script/` is probe-scripts.js's (probe.ts `script`)
//   YAK_PROBE_SECRET   the session secret, so a test can mint a cookie
//   YAK_PROBE_MAIL     the letters MAIL_DEV printed, one `yak-mail` line each
//   YAK_PROBE_OWNER    the first person to sign in, who owns the meta space
//   YAK_PROBE_HOSTNAMES  the stand-in for Cloudflare's custom hostnames
//   STRIPE_PRICE       the Plus price the kernel sells, when the run has a key
import { createRequire } from 'node:module'
import { parse } from '@std/toml'
import { apex } from './host.ts'
import { dir, ready } from './wrangler.ts'
import {
  CHALLENGE,
  driven,
  hostnames,
  plusPrice,
  signIn,
  WEBHOOK_SECRET,
} from './probe.ts'

type Config = Record<string, unknown> & {
  durable_objects?: { bindings: { name: string }[] }
  dev?: Record<string, unknown>
  vars?: Record<string, string>
}

// Absent from the harness, as each is absent under `wrangler dev` here: the
// container needs docker, the rest are the account's own.
let ACCOUNT_ONLY = [
  'env',
  'routes',
  'containers',
  'ai',
  'vectorize',
  'dispatch_namespaces',
  'services',
  'tail_consumers',
  'queues',
  'observability',
]

/** wrangler.toml as the run's kernel wears it, `vars` laid over its own. */
export let config = (toml: string, vars: Record<string, string>): Config => {
  let raw = parse(toml) as Config
  for (let key of ACCOUNT_ONLY) delete raw[key]
  raw.durable_objects = {
    bindings: (raw.durable_objects?.bindings ?? []).filter((b) =>
      b.name != 'SANDBOX'
    ),
  }
  raw.dev = { ...raw.dev, enable_containers: false }
  raw.vars = { ...raw.vars, ...vars }
  return raw
}

type Log = { message: string }
type Harness = {
  listen(): Promise<{ url: URL }>
  getLogs(): Log[]
  clearLogs(): void
  close(): Promise<void>
}

/** The run's kernel, and how its tests reach it. `stripe` is the sandbox key
 * the money paths use, when the run has one. */
export let probeSuite = async (stripe?: string) => {
  await ready()
  let secret = crypto.randomUUID()
  let mail = Deno.makeTempFileSync({ prefix: 'yak-probe-mail-' })
  let cf = hostnames()
  let price: Record<string, string> = stripe
    ? { STRIPE_PRICE: await plusPrice(stripe) }
    : {}
  let vars: Record<string, string> = {
    SESSION_SECRET: secret,
    MAIL_DEV: '1',
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_CONNECT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    OPENAI_APPS_CHALLENGE: CHALLENGE,
    CF_ZONE: 'zone',
    CF_HOSTNAMES_TOKEN: 'a-token',
    HOSTNAMES_API: cf.url,
    ...stripe ? { STRIPE_KEY: stripe, ...price } : {},
  }
  // workers/yak's own wrangler, which Deno loads from there only when the run
  // says --node-modules-dir=manual (deno.json `test:run`): from Deno's npm
  // cache, the bundler finds none of the polyfills npm put beside it.
  let { createTestHarness } = createRequire(`${dir}/`)('wrangler')
  let server: Harness = createTestHarness({
    root: dir,
    workers: [
      { config: config(Deno.readTextFileSync(`${dir}/wrangler.toml`), vars) },
      {
        config: {
          name: 'probe-scripts',
          main: 'probe-scripts.js',
          compatibility_date: '2025-05-08',
          routes: ['*/__script/*'],
          worker_loaders: [{ binding: 'LOADER' }],
        },
      },
    ],
  })
  // Wrangler resolves the config's tsconfig against the working directory
  // and hands it to esbuild relative to the Worker's own, so the bundle is
  // built from there.
  let was = Deno.cwd()
  Deno.chdir(dir)
  let url: URL
  try {
    url = (await server.listen()).url
  } catch (e) {
    await server.close()
    await cf.stop()
    throw e
  } finally {
    Deno.chdir(was)
  }
  // The letters MAIL_DEV prints, drained off the runtime's console as they
  // arrive into the file the tests read their codes from.
  let drain = () => {
    let logs = server.getLogs()
    server.clearLogs()
    let letters = logs.filter((l) => l.message.startsWith('yak-mail '))
    if (letters.length) {
      Deno.writeTextFileSync(
        mail,
        letters.map((l) => l.message + '\n').join(''),
        { append: true },
      )
    }
  }
  let timer = setInterval(drain, 10)
  let stop = async () => {
    clearInterval(timer)
    await server.close()
    await cf.stop()
    Deno.removeSync(mail)
  }
  try {
    let base = url.origin
    let k = driven(base, secret, mail, apex())
    let owner = await signIn(k, `owner@${apex()}`)
    return {
      env: {
        YAK_PROBE: base,
        YAK_PROBE_SECRET: secret,
        YAK_PROBE_MAIL: mail,
        YAK_PROBE_OWNER: JSON.stringify(owner),
        YAK_PROBE_HOSTNAMES: cf.url,
        ...price,
      },
      stop,
    }
  } catch (e) {
    await stop()
    throw e
  }
}
