// The opt-in boundary is the public interface: exact mappings, identity on
// both doors, sandbox lifetime, and the actor every acceptance write carries.
import { equal, ok, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { MachineProvider } from '@yaks/machine'
import { routed } from '@yaks/api'
import { type Hosting, routes } from './routes.ts'
import { MAIN } from './http.ts'
import { concat } from './oid.ts'
import { FLUSH, mark, pkt } from './pkt.ts'
import { ZERO } from './receive.ts'
import { refAt } from './refs.ts'
import { AUTHOR, COMMITTER, file, fixture } from './testing.ts'
import type { Machine, Proc } from '@yaks/machine'

let app = 'b2a13829-b705-493a-b248-90837dc34f7a'
let actor = { by: '2647d30c-3845-4e01-93f2-349dc55871bf' }

let machine = (): Machine => {
  let procs = new Map<string, Proc>()
  return {
    poll: 1,
    start: (command, cwd) => {
      let id = crypto.randomUUID()
      procs.set(id, {})
      let p = new Deno.Command('bash', {
        args: ['-c', command],
        cwd,
        stdout: 'null',
        stderr: 'null',
      }).spawn()
      p.status.then(({ code }) => procs.set(id, { exit: { code } }))
      return Promise.resolve(id)
    },
    look: (id) => Promise.resolve(procs.get(id) ?? null),
    tail: () => Promise.resolve([]),
    kill: () => Promise.resolve(),
    read: (path) => Deno.readTextFile(path),
    write: async (path, content) => {
      await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), {
        recursive: true,
      })
      await Deno.writeTextFile(path, content)
    },
  }
}

let setup = () => {
  let { g, bytes } = fixture()
  let host: Hosting = { graph: g, artifacts: bytes, who: () => null }
  let table = routes(host, { repositories: { code: app } })
  let ask = (path: string, method = 'GET', body?: Uint8Array<ArrayBuffer>) => {
    let req = new Request('http://scratch/git/' + path, { method, body })
    let route = table.find((r) => routed(r, method, new URL(req.url).pathname))
    return route ? route.handle(req) : new Response('unmapped', { status: 404 })
  }
  return { host, table, ask, g, bytes }
}

test('no configured repos exposes no route; unmapped apps and unsigned readers/writers are denied', async () => {
  let { host, ask, g } = setup()
  equal(routes(host).length, 0)
  await g.apply([{ entity: { eid: app } }])
  for (
    let path of [
      'other.git/info/refs?service=git-upload-pack',
      app + '.git/info/refs?service=git-receive-pack',
    ]
  ) {
    equal((await ask(path)).status, 404)
  }
  equal((await ask('code.git/info/refs?service=git-upload-pack')).status, 401)
  equal((await ask('code.git/info/refs?service=git-receive-pack')).status, 401)
  equal((await ask('code.git/git-upload-pack', 'POST')).status, 401)
  equal((await ask('code.git/git-receive-pack', 'POST')).status, 401)
  host.who = () => actor
  let res = await ask('code.git/info/refs?service=git-receive-pack')
  equal(res.status, 200)
  ok((await res.text()).includes('report-status'))
  equal((await ask('code.git/git-receive-pack', 'POST')).status, 503)
})

test('mapped acceptance signs object/ref writes and releases only its freshly requested provider sandbox', async () => {
  let { host, ask, g, bytes } = setup()
  let dir = await Deno.makeTempDir({ prefix: 'T-66426-routes-' })
  let requested: string[] = [], released: string[] = [], writes: Bundle[] = []
  let provider: MachineProvider = {
    request: async ({ id }) => {
      requested.push(id)
      await Deno.mkdir(`${dir}/${id}`)
      return { machine: machine(), cwd: `${dir}/${id}` }
    },
    wake: () => Promise.reject(Error('must request, not wake')),
    release: async ({ id }) => {
      released.push(id)
      await Deno.remove(`${dir}/${id}`, { recursive: true })
    },
    export: () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.reject(Error('no export needed')),
      }),
    }),
  }
  let refuseLocal: Machine = {
    ...machine(),
    start: () => Promise.reject(Error('must not inherit local machine')),
  }
  host.machines = {
    providers: { scratch: provider },
    defaultProvider: 'scratch',
    local: refuseLocal,
  }
  host.who = () => actor
  let originalApply = g.apply
  host.graph = {
    ...g,
    apply: (bundles, opts) => {
      writes.push(...bundles)
      return originalApply(bundles, opts)
    },
  }
  try {
    await g.apply([{ entity: { eid: app } }])
    let source = fixture()
    let tree = await source.git.files({
      file: file(source.bytes, 'route push'),
    })
    let tip = await source.git.commit({
      tree,
      author: AUTHOR,
      committer: COMMITTER,
      message: 'route push',
    })
    let { objects } = await import('./objects.ts')
    let pack = new Uint8Array(
      await new Response(await objects(source.g, source.bytes).pack([tip.oid]))
        .arrayBuffer(),
    )
    let body = concat([
      pkt(`${ZERO} ${tip.oid} ${MAIN}\0report-status\n`),
      mark(FLUSH),
      pack,
    ])
    let response = await ask('code.git/git-receive-pack', 'POST', body)
    ok((await response.text()).includes(`ok ${MAIN}`))
    equal(await refAt(g, app), tip.oid)
    ok(writes.length > 1)
    for (let row of writes) equal(row.$actor, actor)
    equal(requested.length, 1)
    equal(released, requested)
    let bad = await ask(
      'code.git/git-receive-pack',
      'POST',
      new TextEncoder().encode('bad pack'),
    )
    ok((await bad.text()).includes('unpack receive:'))
    equal(requested.length, 2)
    equal(released, requested)
    equal([...Deno.readDirSync(dir)].length, 0)
    // The byte store used by writes is the host's configured artifact store.
    equal((await objects(g, bytes).reach([tip.oid])).length, 3)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
