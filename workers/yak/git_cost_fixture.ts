// App uploads and deploys at the kernel seam, billed only to yak/git by
// workerd's SQL cursor counters. Every other Store and R2 is probe-local.
import { type State, Store } from './graph.ts'
import { directory, fetch as directoryFetch } from './directory.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import { GIT_STORE, type Namespace, PLATFORM_STORE, storeOf } from './door.ts'
import { type Args, call } from './tools.ts'
import type { Env } from './env.ts'
import { BODY, held, refAt } from './gitobj.ts'
import { meter, type Steps } from './release_cost_fixture.ts'
import { DIR, oid, treeEntries, treeOf } from '@yaks/git'
import { r2Objects } from './lib/objects.ts'
import { directoryStanding } from './directory_standing_fixture.ts'

export class GitCostStore {
  #store: Store
  #meter: ReturnType<typeof meter>
  constructor(ctx: State) {
    this.#store = new Store(ctx, { STORE_TRACING: 'off' })
    this.#meter = meter(ctx.storage)
  }
  alarm(): void {}
  async fetch(req: Request): Promise<Response> {
    let url = new URL(req.url)
    if (url.pathname == '/_cost/step') {
      this.#meter.step(url.searchParams.get('name'))
      return Response.json({})
    }
    if (url.pathname == '/_cost/report') {
      return Response.json({
        steps: this.#meter.steps,
        top: this.#meter.top(15),
      })
    }
    return await this.#store.fetch(req)
  }
}

export let gitPushCost = async (
  storage: State['storage'],
  bindings: Pick<Env, 'STORE' | 'BLOBS'> & { GIT_COST: Namespace },
  count: number,
) => {
  let context = { storage, getWebSockets: () => [], acceptWebSocket: () => {} }
  let store: Store
  let git = bindings.GIT_COST.get(
    bindings.GIT_COST.idFromName(crypto.randomUUID()),
  )
  let env = {
    ...bindings,
    STORE: {
      idFromName: (name: string) => name,
      get: (name: unknown) =>
        name == PLATFORM_STORE
          ? { fetch: (req: Request) => store.fetch(req) }
          : name == GIT_STORE
          ? git
          : bindings.STORE.get(bindings.STORE.idFromName(String(name))),
    },
    WIRE: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: () => Promise.resolve(Response.json({})) }),
    },
    BUILDER: {
      idFromName: (name: string) => name,
      get: () => {
        throw new Error('git push probe needs no builder')
      },
    },
    ASSETS: {
      fetch: () => {
        throw new Error('git push probe needs no assets')
      },
    },
    OAUTH_KV: {},
    STORE_TRACING: 'off',
  } satisfies Env
  store = new Store(context, env)
  let dir = directory({ fetch: (req) => directoryFetch(req, env) }, true)
  await dir.apply({ entities: [] })
  let person = (await dir.personAt('admin@bot.yak.sh'))!
  let slug = `git-cost-${crypto.randomUUID().slice(0, 8)}`
  let spaceId = crypto.randomUUID()
  await meta(env).apply([{
    entity: { eid: spaceId },
    space: { slug },
    doc: { title: 'Git cost probe' },
  }, {
    entity: { eid: crypto.randomUUID() },
    member: { space: spaceId, person, role: 'owner' },
  }], KERNEL)
  let run = (name: string, args: Args) =>
    call({ env, dir, person }, name, { space: slug, ...args })
  await run('app_new', { slug: 'probe', title: 'Probe' })
  let space = (await dir.space(slug))!
  let app = (await dir.app(space, 'probe'))!
  await directoryStanding(bindings.STORE, space, app, person)
  let paths = Array.from(
    { length: count },
    (_, i) =>
      i == 0
        ? 'index.html'
        : i < count * 0.6
        ? `file${i}.txt`
        : `dir${i % 11}/file${i}.txt`,
  )
  let content = (path: string, changed = false) =>
    path == 'index.html'
      ? '<!doctype html><title>Probe</title>'
      : `${changed ? 'second' : 'first'} ${path}\n`
  let upload = (paths: string[], changed = false) =>
    run('app_files', {
      app: 'probe',
      files: paths.map((path) => ({ path, content: content(path, changed) })),
    })
  let changed = [paths[1], paths[2], ...paths.slice(-4)]
  let heads: string[] = []
  let commits: { tree: string; parent: string | null }[] = []
  let objectMeta = metaOf(storeOf(env.STORE, GIT_STORE))
  let bytes = r2Objects(env.BLOBS)
  let body = async (id: string) => {
    let [row] = await objectMeta.query(`.entity.eid=${id}`)
    let sha = (row?.blob as { sha?: string } | undefined)?.sha
    let found = sha ? await bytes.read(BODY + sha) : null
    if (!found) throw new Error(`no stored object ${id}`)
    return found
  }
  // Read each completed tree outside the cost window: every path and every
  // unchanged child must survive the cheaper write path, as a clone sees it.
  let verify = async (changedFiles: boolean) => {
    let head = await refAt(held(meta(env)), app.eid)
    if (!head) throw new Error('deploy minted no commit')
    let commit = await body(head)
    let tree = treeOf(commit)
    if (!tree) throw new Error('commit names no tree')
    let parent =
      new TextDecoder().decode(commit).match(/^parent (\S+)$/m)?.[1] ?? null
    let found = new Map<string, string>()
    let walk = async (id: string, prefix: string) => {
      for (let entry of treeEntries(await body(id))) {
        let path = prefix + entry.name
        if (entry.mode == DIR) await walk(entry.oid, path + '/')
        else found.set(path, entry.oid)
      }
    }
    await walk(tree, '')
    if (found.size != paths.length) throw new Error('tree lost files')
    for (let path of paths) {
      let want = await oid(
        'blob',
        new TextEncoder().encode(
          content(path, changedFiles && changed.includes(path)),
        ),
      )
      if (found.get(path) != want) {
        throw new Error(`wrong git bytes for ${path}`)
      }
    }
    heads.push(head)
    commits.push({ tree, parent })
  }
  let step = async (name: string | null) => {
    let url = new URL('http://cost/_cost/step')
    if (name) url.searchParams.set('name', name)
    await git.fetch(new Request(url))
  }
  try {
    await step('first push')
    await upload(paths)
    await run('app_deploy', { app: 'probe' })
    await step(null)
    await verify(false)
    await step('six files changed')
    await upload(changed, true)
    await run('app_deploy', { app: 'probe' })
    await step(null)
    await verify(true)
    await step('unchanged push')
    await run('app_deploy', { app: 'probe' })
    await step(null)
    await verify(true)
    await step('revert six files')
    await upload(changed)
    await run('app_deploy', { app: 'probe' })
    await step(null)
    await verify(false)
    let report =
      await (await git.fetch(new Request('http://cost/_cost/report')))
        .json() as {
          steps: Steps
          top: ReturnType<ReturnType<typeof meter>['top']>
        }
    return { count, changed, heads, commits, ...report }
  } finally {
    await step(null)
  }
}
