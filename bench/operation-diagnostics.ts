/** Populated diagnostic production doors over private SQLite. The catalogue
 * transport is redirected to an owned loopback fixture; its figure measures
 * local CLI/catalogue handling, never OpenAI latency or credential completion. */
import type { Sample, Samples } from '@yaks/benchmark'
import { compose } from '../packages/cli/host.ts'
import { read } from '../packages/cli/config.ts'
import { starter } from '../packages/cli/init.ts'
import { initialize, rpc } from '../packages/cli/rpc.ts'
import { install, state } from '../packages/embedding/native.ts'
import {
  as,
  col,
  count,
  eq,
  fn,
  select,
  statements,
  table,
  val,
} from '@yaks/sql'
import { TABLE } from '../packages/embedding/ddl.ts'
import { service } from '../packages/embedding/service.ts'

export let DIAGNOSTIC_NAMES = [
  'cli/model-list-local-catalogue',
  'cli/vector-check-populated',
  'connector/vector-check-populated',
  'cli/session-home',
  'connector/session-home',
]
let root = new URL('../', import.meta.url).pathname
let decode = new TextDecoder()
let includes = (text: string, want: string) => {
  if (!text.includes(want)) {
    throw new Error(`missing ${want}: ${text.slice(0, 800)}`)
  }
}
export let measure = async (
  args: string[] = [],
): Promise<Record<string, Samples>> => {
  let n = Number(args[0] ?? 3)
  if (!Number.isInteger(n) || n < 1) {
    throw new Error('positive sample count required')
  }
  let dir = await Deno.makeTempDir({ prefix: 'T-127678-diagnostics-' })
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let http: Deno.HttpServer<Deno.NetAddr> | undefined
  let catalogue: Deno.HttpServer<Deno.NetAddr> | undefined
  let requests = 0
  let result: Record<string, Samples> = {}
  try {
    catalogue = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      (req) => {
        if (
          new URL(req.url).pathname != '/v1/models' ||
          req.headers.get('authorization') !=
            'Bearer local-catalogue-placeholder'
        ) {
          return new Response('fixture route refused', { status: 403 })
        }
        requests++
        return Response.json({
          data: [{ id: 'operation-local-catalogue', context_length: 8192 }],
        })
      },
    )
    let person = crypto.randomUUID(),
      session = crypto.randomUUID(),
      workspace = crypto.randomUUID()
    await Deno.mkdir(`${dir}/transcripts`)
    let config = starter(person)
    config.db = `${dir}/yak.db`
    config.duties = false
    config.plugins = config.plugins!.map((p) =>
      p == '@yaks/session'
        ? { use: '@yaks/session', with: { transcripts: `${dir}/transcripts` } }
        : p
    )
    config.plugins.push('@yaks/sqlite', '@yaks/harness', '@yaks/model', {
      use: '@yaks/embedding',
      with: { embedder: { provider: 'hash' }, text: ['doc.title'] },
    })
    let path = `${dir}/yak.json`
    await Deno.writeTextFile(path, JSON.stringify(config))
    host = await compose(read(path), ['graph', 'web'])
    await host.graph.apply([
      { entity: { eid: workspace }, workspace: { root: dir } },
      { entity: { eid: session }, session: { id: 'diagnostic-home-fixture' } },
      {
        entity: { eid: person },
        person: {},
        doc: { title: 'Diagnostic person' },
      },
      ...Array.from(
        { length: 2000 },
        (_, i) => ({
          entity: { eid: crypto.randomUUID() },
          task: {},
          doc: { title: `Diagnostic populated vector ${i}` },
        }),
      ),
    ])
    install(statements(host.storage))
    await service(host, {
      embedder: { provider: 'hash' },
      text: ['doc.title'],
      batch: 4096,
    })
    let index = state(statements(host.storage))
    let [vectors] = statements(host.storage).query(select({
      cols: [as(count(), 'rows')],
      from: table(TABLE),
      where: eq(fn('length', col('vec')), val(64 * 4)),
    }))
    if (
      !index.installed || index.model != 'hash-64' ||
      Number(vectors.rows) < 2000
    ) {
      throw new Error(
        'native vector fixture not populated: ' +
          JSON.stringify({ ...index, rows: vectors.rows }),
      )
    }
    if (!host.handler) throw new Error('missing HTTP handler')
    http = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen() {} },
      host.handler,
    )
    config.port = http.addr.port
    await Deno.writeTextFile(path, JSON.stringify(config))
    let ask = rpc({ url: `http://127.0.0.1:${http.addr.port}/mcp` })
    await initialize(ask)
    let names = (await ask('tools/list', {})).tools as { name: string }[]
    if (!names.some((t) => t.name == 'vector_check')) {
      throw new Error('vector check absent from MCP')
    }
    if (names.some((t) => t.name == 'model_list')) {
      throw new Error(
        'catalogue unexpectedly exposed on MCP; inventory needs review',
      )
    }
    let bootstrap = `${dir}/catalogue.ts`
    await Deno.writeTextFile(
      bootstrap,
      `const wire = globalThis.fetch;\nglobalThis.fetch = (input, init) => {\n const req = new Request(input, init);\n if (req.url !== 'https://api.openai.com/v1/models') throw new Error('external request refused: ' + req.url);\n return wire(new Request('http://127.0.0.1:${catalogue.addr.port}/v1/models', req));\n};\nconst {main} = await import(${
        JSON.stringify(`${root}packages/cli/yak.ts`)
      });\nconst code = await main(Deno.args);\nconst held = await import(${
        JSON.stringify(`${root}packages/cli/held.ts`)
      });\nawait held.close(code);\nDeno.exit(code);\n`,
    )
    let env = {
      TASKS_HOME: `${dir}/tasks`,
      HARNESS_HOME: `${dir}/harness`,
      PROCESS_DIR: `${dir}/process`,
      YAK_RUNTIME_CACHE: `${dir}/runtime`,
      TASKS_SESSION: '',
      CLAUDE_CODE_SESSION_ID: '',
      OPENAI_API_KEY: 'local-catalogue-placeholder',
    }
    for (let name of DIAGNOSTIC_NAMES) {
      let samples: Sample[] = []
      for (let i = 0; i < n; i++) {
        if (name.includes('session-home')) {
          await host.graph.apply([{ entity: { eid: session }, home: null }])
        }
        let before = requests
        let start = performance.now()
        let text: string
        if (name.startsWith('connector/')) {
          let home = name.includes('session-home')
          let answer = await ask('tools/call', {
            name: home ? 'session_home' : 'vector_check',
            arguments: home ? { session, workspace, cwd: dir } : {},
          })
          if (answer.isError) throw new Error(JSON.stringify(answer))
          text = JSON.stringify(answer)
        } else {
          let model = name.includes('model-list')
          let out = await new Deno.Command(Deno.execPath(), {
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
              model ? bootstrap : `${root}packages/cli/yak.ts`,
              '--config',
              path,
              '--no-duties',
              ...(model ? ['model', 'list'] : name.includes('session-home')
                ? [
                  'session',
                  'home',
                  '--session',
                  session,
                  '--workspace',
                  workspace,
                  '--cwd',
                  dir,
                ]
                : ['vector', 'check']),
              '--json',
            ],
            env,
            cwd: dir,
            stdin: 'null',
            stdout: 'piped',
            stderr: 'piped',
          }).output()
          if (!out.success) {
            throw new Error(
              decode.decode(out.stderr) + decode.decode(out.stdout),
            )
          }
          text = decode.decode(out.stdout)
        }
        let value = performance.now() - start
        if (name.includes('model-list')) {
          includes(text, 'operation-local-catalogue')
          includes(text, '8192')
          if (requests !== before + 1) {
            throw new Error('catalogue did not cross owned HTTP fixture')
          }
        } else if (name.includes('session-home')) {
          includes(text, workspace)
          let [saved] = await host.graph.get([session], ['home'])
          if (
            (saved?.home as { workspace?: string })?.workspace !== workspace
          ) throw new Error('home not persisted')
        } else {
          includes(text, 'vector search reads the current canonical vectors')
          if (
            text.includes('"level"') ||
            text.includes('no vector table') ||
            text.includes('nothing is being embedded')
          ) {
            throw new Error(
              'vector check did not inspect a populated vector table: ' + text,
            )
          }
        }
        samples.push({
          value,
          source: 'end-to-end',
          counts: { tasks: 2000 },
          details: {
            fixture:
              'private SQLite; offline hash vectors; local catalogue only',
          },
        })
      }
      result[name] = samples
      console.error(name, JSON.stringify(samples))
    }
    return result
  } finally {
    try {
      await http?.shutdown()
    } finally {
      try {
        await host?.close()
      } finally {
        try {
          await catalogue?.shutdown()
        } finally {
          await Deno.remove(dir, { recursive: true })
        }
      }
    }
  }
}
if (import.meta.main) console.log(JSON.stringify(await measure(Deno.args)))
