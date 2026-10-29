/** Session operations through real CLI processes and HTTP MCP calls over a
 * private SQLite graph. A deterministic in-process provider completes real
 * native turns; these figures are local lifecycle waits, not remote model
 * latency. Managed CLI agents and provider authentication are not exercised. */
import type { Model } from '@yaks/model'
import { type Sample, type Samples, stopwatch } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { initialize, rpc } from '../packages/cli/rpc.ts'
import { local } from '../packages/harness/local.ts'
import { hosted } from '../packages/harness/store.ts'
import { identityEid } from '@yaks/graph/identity'
import { seed } from '../packages/harness/agent.ts'

// new/send are deliberately CLI-only declarations; no HTTP substitutes are
// counted. spawn uses native provider transport, never a managed CLI process.
let FAMILIES = ['list', 'new', 'peek', 'send', 'spawn', 'stop', 'wait']
export let NAMES = ['cli', 'connector'].flatMap((door) =>
  FAMILIES.filter((family) =>
    door == 'cli' || !['new', 'send'].includes(family)
  ).map((family) => `${door}/session-${family}`)
)
let root = new URL('../', import.meta.url).pathname
export let DEPENDENCIES = [
  'session_new/session_send have CLI-only declarations; their MCP names are not production doors',
  'Remote provider authentication, generation and transport latency require an independently authorized provider run',
  'Managed process-transport spawn/stop/wait are not these native fixture operations',
]
let decoder = new TextDecoder()
let PROVIDER = 'operation-session-fixture'
let MODEL = 'operation-session-local'
let ANSWER = 'operation session fixture completed'
let check = (text: string, want: string) => {
  if (!text.includes(want)) {
    throw new Error(`missing ${want}: ${text.slice(0, 700)}`)
  }
}

// Collection failures must return to the monitor, and their timers must not
// outlive a successful sample. Only CLI children created below receive abort.
async function bounded<T>(value: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      value,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded 30s`)),
          30_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function measure(
  args: string[] = [],
): Promise<Record<string, Samples>> {
  let n = Number(args[0] ?? 3)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-session-' })
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let runner: ReturnType<typeof local> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let results: Record<string, Samples> = {}
  let releases = new Set<ReturnType<typeof Promise.withResolvers<void>>>()
  let hold: {
    entered: ReturnType<typeof Promise.withResolvers<void>>
    released: ReturnType<typeof Promise.withResolvers<void>>
  } | undefined
  let fixtureModel: Model = async (request) => {
    let pending = hold
    hold = undefined
    if (pending) {
      releases.add(pending.released)
      pending.entered.resolve()
      await new Promise<void>((resolve) => {
        let done = () => {
          request.signal?.removeEventListener('abort', done)
          resolve()
        }
        request.signal?.addEventListener('abort', done, { once: true })
        pending.released.promise.then(done)
        if (request.signal?.aborted) done()
      })
      releases.delete(pending.released)
    }
    return {
      id: crypto.randomUUID(),
      model: MODEL,
      items: [{ kind: 'assistant', text: ANSWER }],
    }
  }
  let person = crypto.randomUUID()
  try {
    await Deno.mkdir(`${dir}/transcripts`)
    let config = starter(person)
    config.db = `${dir}/yak.db`
    config.duties = false
    config.plugins = config.plugins?.map((p) =>
      p == '@yaks/session'
        ? { use: '@yaks/session', with: { transcripts: `${dir}/transcripts` } }
        : p
    )
    for (
      let p of [
        '@yaks/sqlite',
        '@yaks/harness',
        '@yaks/spawn',
        '@yaks/model',
        '@yaks/blob',
        '@yaks/key',
        '@yaks/secrets',
        '@yaks/connections',
        '@yaks/mcp-client',
        '@yaks/connections',
        '@yaks/mcp-client',
      ]
    ) {
      if (!config.plugins?.includes(p)) config.plugins!.push(p)
    }
    let path = `${dir}/yak.json`
    await Deno.writeTextFile(path, JSON.stringify(config))
    host = await compose(read(path), ['graph', 'web'])
    let graph = host.graph
    await graph.apply([
      {
        entity: { eid: person },
        person: {},
        doc: { title: 'Session fixture person' },
      },
      ...seed({ provider: PROVIDER, model: MODEL }),
    ])
    runner = local({
      h: hosted(host),
      provider: PROVIDER,
      name: MODEL,
      tools: [],
      model: fixtureModel,
      providers: { [PROVIDER]: fixtureModel },
      web: false,
      images: false,
      streaming: false,
    })
    if (!host.handler) throw new Error('session fixture has no HTTP handler')
    server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      host.handler,
    )
    config.port = server.addr.port
    await Deno.writeTextFile(path, JSON.stringify(config))
    let ask = rpc({
      url: `http://127.0.0.1:${server.addr.port}/mcp`,
      fetch: (request) =>
        fetch(new Request(request, { signal: AbortSignal.timeout(30_000) })),
    })
    await initialize(ask)
    let listed = await ask('tools/list', {})
    let available = new Set(
      (listed.tools as { name: string }[]).map((t) => t.name),
    )
    for (let family of FAMILIES.filter((f) => !['new', 'send'].includes(f))) {
      if (!available.has(`session_${family}`)) {
        throw new Error(`missing MCP session_${family}`)
      }
    }
    let transcript = async (session: string, stopped = false) => {
      let [row] = await graph.get([session], ['session'])
      let entries = await graph.read(
        `.entry.session=${session} ?content ?stop .order=entry.seq`,
      )
      check(JSON.stringify(entries), ANSWER)
      let status = (row.session as { status: string }).status
      if (status !== (stopped ? 'stopped' : 'settled')) {
        throw new Error(`session ${session} is ${status}`)
      }
      return entries
    }
    let fixture = async () => {
      let s = await runner!.start('Prepare a populated local session')
      await bounded(runner!.idle(s), 'fixture preparation')
      await transcript(s)
      return s
    }
    let call = async (
      door: string,
      family: string,
      input: Record<string, unknown>,
    ) => {
      if (door == 'connector') {
        let reply = await ask('tools/call', {
          name: `session_${family}`,
          arguments: input,
        })
        if (reply.isError) throw new Error(JSON.stringify(reply))
        return JSON.stringify(reply)
      }
      let flags = Object.entries(input).flatMap((
        [key, value],
      ) => [
        `--${key.replaceAll('_', '-')}`,
        typeof value == 'string' ? value : JSON.stringify(value),
      ])
      let abort = new AbortController()
      let timer = setTimeout(() => abort.abort(), 30_000)
      let output: Deno.CommandOutput
      try {
        output = await new Deno.Command(Deno.execPath(), {
          signal: abort.signal,
          args: [
            'run',
            '--allow-read',
            '--allow-write',
            '--allow-env',
            '--allow-run',
            '--allow-ffi',
            '--allow-sys',
            '--allow-net=127.0.0.1,localhost',
            '--config',
            `${root}deno.json`,
            `${root}packages/cli/yak.ts`,
            '--config',
            path,
            '--no-duties',
            'session',
            family,
            ...flags,
            '--json',
          ],
          env: {
            TASKS_HOME: `${dir}/tasks`,
            HARNESS_HOME: `${dir}/harness`,
            PROCESS_DIR: `${dir}/process`,
            YAK_RUNTIME_CACHE: `${dir}/runtime`,
            TASKS_SESSION: '',
            CLAUDE_CODE_SESSION_ID: '',
          },
          cwd: dir,
          stdin: 'null',
          stdout: 'piped',
          stderr: 'piped',
        }).output()
      } finally {
        clearTimeout(timer)
      }
      if (!output.success) {
        throw new Error(
          `${family}: ${decoder.decode(output.stderr)} ${
            decoder.decode(output.stdout)
          }`,
        )
      }
      return decoder.decode(output.stdout)
    }
    let only = args.find((arg) => arg.startsWith('--family='))?.slice(9)
    for (let door of ['cli', 'connector']) {
      for (let family of FAMILIES) {
        if (door == 'connector' && ['new', 'send'].includes(family)) continue
        if (only && family !== only) continue
        let samples: Sample[] = []
        for (let i = 0; i < n; i++) {
          let session = await fixture()
          let before = new Set(
            (await graph.read('.session')).map((row) => row.entity.eid),
          )
          let input: Record<string, unknown> = family == 'new'
            ? {
              prompt: `Local lifecycle new ${door} ${i}`,
              provider: PROVIDER,
              model: MODEL,
            }
            : family == 'list'
            ? {}
            : { session }
          let task = ''
          if (family == 'send') input.text = `Local lifecycle send ${door} ${i}`
          if (family == 'spawn') {
            task = crypto.randomUUID()
            await graph.apply([{
              entity: { eid: task },
              task: {},
              doc: { title: `Local fixture task ${door} ${i}` },
            }])
            input = {
              task,
              provider: identityEid('provider', [PROVIDER]),
              model: identityEid('model', [MODEL]),
              wait: true,
              instruction: 'Reply with local fixture completion only',
            }
          }
          let pending: typeof hold
          if (family == 'wait' || family == 'stop') {
            pending = {
              entered: Promise.withResolvers<void>(),
              released: Promise.withResolvers<void>(),
            }
            hold = pending
            await runner!.send(
              session,
              'Prepare an active local lifecycle turn',
            )
            await bounded(pending.entered.promise, 'provider turn admission')
            let [active] = await graph.get([session], ['session'])
            if (
              !['pending', 'running'].includes(
                String((active.session as { status: string }).status),
              )
            ) throw new Error('lifecycle preparation is not active')
          }
          if (family == 'wait') input.timeout = '15s'
          console.error(
            `session fixture ${door}/${family} sample ${i + 1}/${n}`,
          )
          let took = stopwatch()
          let answer = call(door, family, input)
          // A wait races real local completion beginning at command launch;
          // no synthetic provider delay is added to the timing. CLI startup
          // may outlast this reply; the HTTP door may await it in-handler.
          if (family == 'wait') pending!.released.resolve()
          let text = await answer
          if (family == 'stop') {
            pending!.released.resolve()
            await bounded(runner!.idle(session), 'session completion')
          }
          let elapsed = took()
          if (family == 'new' || family == 'spawn') {
            let made = (await graph.read('.session')).filter((row) =>
              !before.has(row.entity.eid)
            )
            if (made.length !== 1) {
              throw new Error(`expected one new session, got ${made.length}`)
            }
            session = made[0].entity.eid
            await bounded(runner!.idle(session), 'session completion')
          }
          await transcript(session, family == 'stop')
          if (family == 'new' || family == 'send' || family == 'peek') {
            check(text, ANSWER)
          }
          if (family == 'list') {
            check(text, session)
          }
          if (family == 'stop') check(text, 'stop')
          if (family == 'wait' || family == 'spawn') check(text, 'settled')
          if (family == 'send') {
            check(JSON.stringify(await transcript(session)), String(input.text))
          }
          if (task) {
            let [row] = await graph.get([task], ['claim'])
            check(JSON.stringify(row), session)
          }
          samples.push({ ...elapsed, counts: { samples: 1 } })
        }
        results[`${door}/session-${family}`] = samples
      }
    }
    console.error(
      `session fixture completed ${
        Object.keys(results).length
      } real doors; local provider only; wait/stop start from active native turns; wait races local completion at launch`,
    )
    return results
  } finally {
    hold?.released.resolve()
    for (let release of releases) release.resolve()
    try {
      await runner?.close()
    } finally {
      try {
        await server?.shutdown()
      } finally {
        try {
          await host?.close()
        } finally {
          await Deno.remove(dir, { recursive: true })
        }
      }
    }
    console.error(
      'session fixture closed runner, listener and SQLite; removed private directory',
    )
  }
}
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
