// Retained graph removals, through the Store's own authority boundary.
// Directory callers are kernel code; app archives belong to named editors,
// including in apps whose ordinary writes are open to visitors.
import { type Graph, signed } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { restoreTrash } from '@yaks/graph/trash'
import { json } from '@yaks/api'
import { vouchOf, writer } from '@yaks/platform/app-authority'

let eidsOf = (value: unknown): string[] => {
  if (
    !Array.isArray(value) || !value.length ||
    value.some((id) => typeof id != 'string' || !id)
  ) throw new Refused('trash needs the retained entities’ ids')
  return value
}

export let trashDoor = async (
  request: Request,
  graph: Graph,
  directory: boolean,
): Promise<Response> => {
  let url = new URL(request.url)
  let kernel = request.headers.get('x-yak-kernel') == '1'
  let v = vouchOf(request)
  if (
    !kernel && (directory || !v.person ||
      !['owner', 'editor'].includes(v.level ?? ''))
  ) return json({ error: 'NotFound', message: 'no such door' }, 404)
  let read = graph.storage.trash
  if (!read) throw new Refused('this store has no retained trash')
  if (url.pathname == '/trash' && request.method == 'GET') {
    let eids = url.searchParams.getAll('eid')
    return json(await read(eids.length ? eidsOf(eids) : undefined))
  }
  if (
    request.method != 'POST' ||
    !['/trash/restore', '/trash/purge'].includes(url.pathname) ||
    (url.pathname == '/trash/purge' && !kernel)
  ) return json({ error: 'NotFound', message: 'no such door' }, 404)
  let body = await request.json().catch(() => {
    throw new Refused('trash takes a JSON object with id and eids')
  })
  if (!body || typeof body != 'object' || Array.isArray(body)) {
    throw new Refused('trash takes a JSON object with id and eids')
  }
  let { id, eids } = body as { id?: unknown; eids?: unknown }
  if (typeof id != 'string' || !id) {
    throw new Refused('a retained transaction id is required')
  }
  let entry = (await read(eidsOf(eids))).find((entry) => entry.id == id)
  if (!entry) {
    throw new Refused('no such retained transaction for these entities')
  }
  if (url.pathname == '/trash/purge') {
    if (!graph.storage.purgeTrash) {
      throw new Refused('this store cannot purge trash')
    }
    await graph.storage.purgeTrash(id)
    return json({ ok: true })
  }
  return json(
    await restoreTrash(graph, {
      ...entry,
      bundles: signed(entry.bundles, writer(request)),
    }, { trusted: true, stamp: false }),
  )
}
