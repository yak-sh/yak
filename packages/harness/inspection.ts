/** Bounded transcript source inspection. Rendering and client storage are not involved. */
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { valueTools } from '@yaks/blob'

export type SearchCursor = { segment: number; seq: number; offset: number }
export type SourceMatch = { entity: string; offset: number; revision: string; text: string }
export type SearchPage = { matches: SourceMatch[]; next: SearchCursor | null }
export type SourcePage = { revision: string; total: number; start: number; next: number | null; text: string; entry: Bundle }
export type Inspection = {
  search: (session: string, query: string, cursor?: SearchCursor) => Promise<SearchPage>
  inspect: (session: string, entity: string, start?: number, revision?: string) => Promise<SourcePage>
}

export const inspection = (g: Graph): Inspection => {
  const row = async (id: string) => (await g.storage.tx((tx) => tx.get([id])))[0]
  const segments = async (session: string) => {
    const result: { session: string; max: number }[] = []
    const seen = new Set<string>()
    let id = session, max = Infinity
    while (!seen.has(id)) {
      seen.add(id)
      result.unshift({ session: id, max })
      const parent = await row(id)
      if (!parent?.session) throw new Error('Session unavailable')
      const from = (parent.fork as Comp | undefined)?.from
      if (!from) break
      const anchor = await row(String(from))
      if (!anchor?.entry) throw new Error('Fork boundary unavailable')
      id = String((anchor.entry as Comp).session)
      max = Math.min(max, Number((anchor.entry as Comp).seq))
    }
    return result
  }
  const sourceRow = async (id: string) => {
    const b = await row(id)
    if (b && typeof (b.content as Comp | undefined)?.body != 'string') {
      return { ...b, content: { body: JSON.stringify(b, null, 2) } }
    }
    return b
  }
  const tools = valueTools(sourceRow)
  const read = tools.find((t) => t.name == 'graph_value_read')!
  const search = tools.find((t) => t.name == 'graph_value_search')!
  return {
    async inspect(session, entity, start = 0, revision) {
      const plan = await segments(session), entry = await row(entity)
      const e = entry?.entry as Comp | undefined
      if (!e || !plan.some((p) => p.session == e.session && Number(e.seq) <= p.max)) {
        throw new Error('Entry is outside this transcript')
      }
      const page = JSON.parse(await read.run({ entity, component: 'content', property: 'body', start, count: 4096, revision }))
      const metadata: Bundle = { entity: { eid: entity } }
      for (const key of ['prompt', 'result', 'error', 'exception', 'attachment', 'ask']) {
        if (entry![key]) metadata[key] = {}
      }
      return { ...page, entry: metadata } as SourcePage
    },
    async search(session, query, cursor = { segment: 0, seq: 0, offset: 0 }) {
      if (!query || query.length > 256) throw new Error('Search needs 1–256 characters')
      const plan = await segments(session)
      if (![cursor.segment, cursor.offset].every((n) => Number.isInteger(n) && n >= 0) || !Number.isFinite(cursor.seq) || cursor.seq < 0) throw new Error('Invalid search cursor')
      let at = { ...cursor }
      const matches: SourceMatch[] = []
      // Bound each request even when no matches exist; the caller can continue.
      for (let scanned = 0; scanned < 64 && at.segment < plan.length; scanned++) {
        const p = plan[at.segment]
        const [b] = await g.read('.entry.session=' + p.session + '&.content&.entry.seq' + (at.offset ? '>=' : '>') + at.seq + (Number.isFinite(p.max) ? '&.entry.seq<=' + p.max : '') + '&.order=entry.seq&.limit=1')
        if (!b) { at = { segment: at.segment + 1, seq: 0, offset: 0 }; continue }
        const seq = Number((b.entry as Comp).seq)
        const result = JSON.parse(await search.run({ entity: b.entity.eid, component: 'content', property: 'body', query, start: at.offset, limit: 20 - matches.length })) as { revision: string; matches: { offset: number; text: string }[]; next: number | null }
        matches.push(...result.matches.map((m) => ({ ...m, entity: b.entity.eid, revision: result.revision })))
        at = { segment: at.segment, seq, offset: result.next ?? 0 }
        if (matches.length >= 20) break
      }
      return { matches, next: at.segment < plan.length ? at : null }
    },
  }
}
