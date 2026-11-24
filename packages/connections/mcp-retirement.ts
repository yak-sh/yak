import { after, together } from '@yaks/fp'
import {
  type Bundle,
  type Comp,
  type Graph,
  mint,
  minted,
  type Tx,
} from '@yaks/graph'
import { line, sub } from '@yaks/query'
import { secretEid } from '@yaks/secrets'
import { clientSecret } from './clients.ts'
import { integrationEid } from './identity.ts'

export let mcpIntegration = (server: string) => `mcp:${server}`

type Server = { id: string; owner?: string }
type Row = Bundle & {
  connection?: Comp
  edge?: Comp
  integration?: Comp
  secret?: Comp
}
type Plan = {
  id: string
  rows: string[]
  secrets: string[]
  removed: boolean
  retained: boolean
}

/** A server owns the integration named by its identity. Connections lent to
 * surviving apps, and an OAuth client used by another integration, stay. */
export let retirement = (
  tx: Pick<Tx, 'get' | 'read'>,
  servers: Server[],
  gone: ReadonlySet<string> = new Set(),
  pending: Bundle[] = [],
): Plan[] | Promise<Plan[]> => {
  if (!servers.length) return []
  let names = servers.map(({ id }) => mcpIntegration(id))
  let clients = names.map((name) => secretEid(clientSecret(name)))
  return after(
    together([
      tx.read(line`.connection.integration=${names} ?secret`),
      tx.read(
        line`(.integration.name=${names})|(.integration.client=${names})|(.integration.links=${names})`,
      ),
      tx.get(clients, ['secret']),
    ]),
    ([connections, integrations, registrations]: [Row[], Row[], Row[]]) => {
      let ids = connections.map((b) => b.entity.eid)
      let links = ids.length ? tx.read(line`.edge.to=${ids}&.uses`) : []
      return after(links, (edges) => {
        let used = new Set(
          ([...edges, ...pending] as Row[]).flatMap((b) =>
            b.uses && b.edge?.to && !gone.has(b.entity.eid) &&
              !gone.has(String(b.edge.from))
              ? [String(b.edge.to)]
              : []
          ),
        )
        return servers.map(({ id, owner }, index) => {
          let name = names[index]!, client = clients[index]!
          let integration = integrations.find((b) =>
            b.entity.eid == integrationEid(name) && b.integration?.name == name
          )
          let elsewhere = integrations.filter((b) =>
            integration?.entity.eid != b.entity.eid && !gone.has(b.entity.eid)
          )
          let shared = integration?.integration?.built ||
            elsewhere.some((b) =>
              b.integration?.links == name ||
              b.integration?.name == name
            )
          let held = connections.filter((b) =>
            b.connection?.integration == name
          )
          let kept = held.filter((b) =>
            shared || used.has(b.entity.eid) ||
            b.connection?.owner != (owner ?? integration?.integration?.owner)
          )
          let removed = held.filter((b) => !kept.includes(b))
          let retire = !shared && !kept.length
          let registered = registrations.find((b) =>
            b.entity.eid == client && b.secret
          )
          let eraseClient = retire &&
            !elsewhere.some((b) => b.integration?.client == name)
          return {
            id,
            rows: [
              ...removed.map((b) => b.entity.eid),
              ...retire && integration ? [integration.entity.eid] : [],
              ...eraseClient && registered ? [client] : [],
            ],
            secrets: [
              ...removed.map((b) => b.entity.eid),
              ...eraseClient && (registered || integration || removed.length)
                ? [client]
                : [],
            ],
            removed: removed.some((b) => !!b.secret?.value) ||
              eraseClient && !!registered?.secret?.value,
            retained: kept.some((b) => !!b.secret?.value) ||
              !eraseClient && !!registered?.secret?.value,
          }
        })
      })
    },
  )
}

/** Look for dedicated MCP integrations left by earlier permanent removals.
 * Recoverable servers still have a row or a copy in the graph trash. */
export let orphans = (
  graph: Graph,
  tx: Tx,
  candidates: string[],
): Plan[] | Promise<Plan[]> =>
  after(tx.get(candidates, ['integration']), (integrations: Row[]) => {
    let servers = integrations.flatMap((b) => {
      let name = b.integration?.name
      if (typeof name != 'string' || !name.startsWith('mcp:')) return []
      let id = name.slice('mcp:'.length)
      return minted(id) && b.entity.eid == integrationEid(name) ? [{ id }] : []
    })
    if (!servers.length) return []
    return after(
      tx.get(servers.map(({ id }) => id), ['mcp_server']),
      (live) => {
        let kept = new Set(
          live.filter((b) => b.mcp_server).map((b) => b.entity.eid),
        )
        let missing = servers.filter(({ id }) => !kept.has(id))
        return after(
          together(
            missing.map(({ id }) =>
              after(
                graph.storage.trash?.([id], { limit: 1 }) ?? [],
                (entries) =>
                  entries.some((entry) =>
                    entry.bundles.some((b) =>
                      b.entity.eid == id && b.mcp_server
                    )
                  ),
              )
            ),
          ),
          (saved) => retirement(tx, missing.filter((_, i) => !saved[i])),
        )
      },
    )
  })

export type Notice = {
  to: string
  about: string
  subject: string
  body: string
}

export type Retirement = {
  rows: string[]
  secrets: string[]
  notices: Notice[]
}

/** The vault and archive erasure is owed by the same write that buried the
 * graph rows. Its notice becomes deliverable after the erasure finishes. */
export let retiring = (plans: Plan[], notices: Notice[] = []): Bundle[] => {
  let rows = [...new Set(plans.flatMap((p) => p.rows))]
  let secrets = [...new Set(plans.flatMap((p) => p.secrets))]
  if (!rows.length && !secrets.length && !notices.length) return []
  return [
    ...rows.map((eid) => ({ entity: { eid }, tombstone: {} })),
    { entity: { eid: mint() }, mcp_retirement: { rows, secrets, notices } },
  ]
}

/** Scan the directory in the same 50-row windows as its store mover. Each
 * request rechecks the candidates inside the transaction that removes them. */
export let retireOrphans = async (graph: Graph): Promise<void> => {
  let afterId: string | undefined
  for (;;) {
    let page = await graph.read(
      line`.integration.name>=${'mcp:'}&.integration.name<${'mcp;'}${
        sub(afterId ? line`&.entity.eid>${afterId}` : line``)
      }&.order=entity.eid&.limit=50&.fields=entity.eid`,
    )
    if (!page.length) return
    let candidates = page.map((b) => b.entity.eid)
    await graph.apply(
      candidates.map((eid) => ({ entity: { eid }, $retireMcp: true })),
      { trusted: true },
    )
    afterId = candidates.at(-1)
  }
}
