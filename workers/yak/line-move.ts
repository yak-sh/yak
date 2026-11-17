// Upgrade customer callbacks kept before their tickets named the receiving
// number. One connection per alarm pass, through the same reconciliation as
// a line-setting write; a failed provider call leaves its cursor unchanged.
import { line, sub } from '@yaks/query'
import type { Comp, Graph } from '@yaks/graph'
import type { Meta } from '@yaks/sqlite'
import type { Env } from './env.ts'
import { meta } from './meta.ts'

export let LINES = 'operator:line-tickets'

type Store = {
  g: Graph
  marks?: Pick<Meta, 'get' | 'set'>
  waiting?: () => number
}

// Old connections used connection.account in every writer's Operator before
// explicit operator_line settings existed. The store's sessions name its space.
let legacy = async (g: Graph, env: Env, cursor: string) => {
  let [session] = await g.read(
    '.operator_session&.limit=1&.fields=operator_session.space',
  )
  let space = (session?.operator_session as Comp | undefined)?.space
  if (!space) return []
  let dir = meta(env)
  let writers = await dir.query(
    line`.member.space=${
      String(space)
    }&.member.role=owner,editor&.fields=member.person`,
  )
  let ids = [
    space,
    ...writers.map((b) => (b.member as Comp | undefined)?.person),
  ].filter(Boolean).map(String)
  return dir.query(
    line`.connection.owner=${ids}&.connection.status=connected&.connection.account~="+"${
      sub(cursor ? line`&.entity.eid>${cursor}` : line``)
    }&.order=entity.eid&.limit=1&.fields=entity.eid`,
  )
}

export let lineBackfill = async (store: Store, env: Env): Promise<boolean> => {
  let { g, marks } = store
  let cursor = marks?.get(LINES)
  if (!marks || cursor == 'done') return false
  if (store.waiting?.()) return true
  let rows = await g.read(
    line`.operator_line${
      sub(cursor ? line`&.operator_line.connection>${cursor}` : line``)
    }&.order=operator_line.connection&.limit=1&.fields=operator_line.connection`,
  )
  let old = await legacy(g, env, cursor ?? '')
  let next = [
    ...rows.map((b) =>
      String((b.operator_line as Comp | undefined)?.connection ?? '')
    ),
    ...old.map((b) => b.entity.eid),
  ].filter(Boolean).sort()[0]
  if (!next) {
    marks.set(LINES, 'done')
    return false
  }
  let { pointed } = await import('./operator-line.ts')
  await pointed(env, g, next)
  marks.set(LINES, next)
  return true
}
