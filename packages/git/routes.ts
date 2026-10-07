// An opt-in Git door: configured slugs, authenticated readers and writers,
// and a transient decoder sandbox from the host's explicit default provider.
// No configuration means no routes, not a scan of global repositories.

import type { Authenticate, Route } from '@yaks/api'
import { type Eid, type Graph, signed } from '@yaks/graph'
import type { Blobs } from '@yaks/blob'
import type { Machine, MachineProvider } from '@yaks/machine'
import { advertise, type Ref, type Refs, uploadPack } from './http.ts'
import type { Writes } from './index.ts'
import { objects } from './objects.ts'
import { advertiseReceive, receivePack } from './receive.ts'
import type { Repo } from './refs.ts'

/** Every configured slug is served to authenticated callers of this host. */
export type Options = {
  /** Explicit repository exposure: slug → repository entity id. */
  repositories?: Record<string, Eid>
}

export type Hosting = {
  graph: Graph
  artifacts: Blobs
  who: Authenticate
  machines?: {
    local?: Machine
    providers: Record<string, MachineProvider>
    defaultProvider: string
  }
}

/**
 * Mount `/git/<slug>.git/info/refs`, `git-upload-pack`, and `git-receive-pack`.
 * A mapping grants all authenticated callers read and fast-forward write of
 * that repository; hosts requiring per-repository grants should not map it
 * here. Unmapped repositories have no route, even if their ids are known.
 */
export let routes = (host: Hosting, options: Options = {}): Route[] => {
  let out: Route[] = []
  for (let [slug, app] of Object.entries(options.repositories ?? {})) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug)) {
      throw Error('git routes: repository slug must be a simple name')
    }
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        app,
      )
    ) {
      throw Error('git routes: repository must name an entity id')
    }
    let root = `/git/${slug}.git`
    let handle: Route['handle'] = async (req) => {
      let actor = await host.who(req)
      if (!actor || !(actor.by || actor.via)) {
        return new Response('git: authentication required\n', { status: 401 })
      }
      let graph: Writes = {
        read: (q, opts) => host.graph.read(q, opts),
        apply: (bundles, opts) =>
          host.graph.apply(signed(bundles, actor), opts),
      }
      let repo: Repo = { refs: graph, objects: graph, bytes: host.artifacts }
      let refs: Refs = {
        list: async () => {
          let rows = await graph.read(`.ref.app=${app}&.ref.present!=false`)
          return rows.map((b): Ref => {
            let r = b.ref as { name: string; commit?: string; oid?: string }
            return { name: r.name, oid: r.commit ?? r.oid ?? '' }
          }).filter((r) => /^[a-f0-9]{40}$/.test(r.oid))
        },
      }
      let url = new URL(req.url)
      if (url.pathname == root + '/info/refs') {
        return url.searchParams.get('service') == 'git-receive-pack'
          ? advertiseReceive(req, refs)
          : advertise(req)
      }
      if (url.pathname == root + '/git-upload-pack') {
        return uploadPack(req, refs, objects(graph, host.artifacts))
      }
      let machines = host.machines
      let provider = machines?.providers[machines.defaultProvider]
      if (!provider?.request) {
        return new Response('git: no receive decoder provider configured\n', {
          status: 503,
        })
      }
      let ref = { id: `git-receive-${crypto.randomUUID()}` }
      try {
        let lent = await provider.request(ref)
        return await receivePack(req, repo, app, {
          machine: lent.machine,
          cwd: lent.cwd,
        })
      } finally {
        await provider.release(ref)
      }
    }
    out.push(
      { method: 'GET', path: root + '/info/refs', handle },
      { method: 'POST', path: root + '/git-upload-pack', handle },
      { method: 'POST', path: root + '/git-receive-pack', handle },
    )
  }
  return out
}
