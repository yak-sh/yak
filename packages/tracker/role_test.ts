// A composed box tracker owns a separate SQL store. Its declared downstream
// effect resolves a scratch spool report through an HTTP RAM code catalog.

import { equal, ok, test, until } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { gitDoc } from '@yaks/git'
import { run } from '@yaks/git/land'
import { codeDoc } from '@yaks/code/vocab'
import { codeMirror } from '@yaks/code'
import { sync } from '@yaks/mirror'
import { ask } from '@yaks/api'
import { compose } from '@yaks/cli/host'
import { files } from './file.ts'
import { caught, spool } from './report.ts'
import { comp } from './model.ts'

test('box role groups and enriches a spool occurrence through its configured catalog', async () => {
  let dir = await Deno.makeTempDir()
  let host: Awaited<ReturnType<typeof compose>> | undefined
  let server: Deno.HttpServer<Deno.NetAddr> | undefined
  let controller = new AbortController()
  let duties: Promise<void> | undefined
  try {
    let git = async (...args: string[]) => {
      let got = await run(args, dir)
      if (!got.ok) throw Error(got.err)
      return got.out.trim()
    }
    await git('init', '-q')
    await Deno.writeTextFile(
      `${dir}/deno.json`,
      '{"name":"@test/tracker-code","exports":"./fail.ts"}',
    )
    await Deno.writeTextFile(
      `${dir}/fail.ts`,
      'export let fail = () => { throw Error("broken") }\n',
    )
    await git('add', '.')
    await git(
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '-qm',
      'fixture',
    )
    let commit = await git('rev-parse', 'HEAD')
    let vocab = loadVocab([kernelDoc, docDoc, edgeDoc, gitDoc, codeDoc], [
      kernelKeywords,
      edgeKeywords,
    ])
    let catalog = graph({ vocab, storage: ram(vocab) })
    equal((await sync((await codeMirror(catalog, dir)).binding)).failed, [])
    let [symbol] = await catalog.read('.symbol.name=fail')
    server = Deno.serve(
      { hostname: '127.0.0.1', port: 0, onListen: () => {} },
      (request) => ask(catalog, request),
    )
    let url = `http://127.0.0.1:${server.addr.port}`
    host = await compose({
      db: `${dir}/tracker.db`,
      tracker: { spool: `${dir}/spool` },
      plugins: [
        '@yaks/kernel',
        '@yaks/doc',
        '@yaks/tools',
        '@yaks/api',
        '@yaks/process',
        '@yaks/effects',
        '@yaks/mail',
        '@yaks/wake',
        { use: '@yaks/tracker', with: { code: { cwd: dir, url } } },
      ],
    }, ['graph', 'effects', '@yaks/tracker'])
    let error = new Error('broken')
    error.stack = `Error: broken\n at fail (file://${dir}/fail.ts:1:33)`
    await caught(error, {
      sink: spool(files(`${dir}/spool`).append),
      commit,
      eid: 'scratch-occurrence',
    })
    await host.duties(AbortSignal.abort(), ['@yaks/tracker'])
    duties = host.duties(controller.signal, ['effects'])
    await until(async () => {
      let [bug] = await host!.graph.read('.bug *')
      return comp(bug, 'bug').culprit == symbol.entity.eid
    })
    let [row] = await host.graph.get(['scratch-occurrence'])
    let [bug] = await host.graph.read('.bug *')
    equal(comp(bug, 'bug').hits, 1)
    equal(comp(bug, 'bug').culprit, symbol.entity.eid)
    ok(!comp(bug, 'bug').spot)
    let frames = comp(row, 'exception').frames
    if (!Array.isArray(frames)) throw Error('frames absent')
    equal(frames[0].symbol, symbol.entity.eid)
    equal((await Array.fromAsync(files(`${dir}/spool`).source())).length, 0)
    // The code catalog is allowed to be unavailable. Grouping still lands.
    await server.shutdown()
    server = undefined
    await caught(error, {
      sink: spool(files(`${dir}/spool`).append),
      commit,
      eid: 'scratch-unavailable',
      fault: 'catalog-down',
    })
    await host.duties(AbortSignal.abort(), ['@yaks/tracker'])
    await until(async () => {
      let [row] = await host!.graph.get(['scratch-unavailable'])
      return !!comp(row, 'error').bug
    })
    equal((await host.graph.read('.bug')).length, 2)
    equal((await Array.fromAsync(files(`${dir}/spool`).source())).length, 0)
  } finally {
    controller.abort()
    await duties
    await host?.close()
    await server?.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
})
