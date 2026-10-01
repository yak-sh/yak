// Recovery is explicit evidence-backed metadata, not inferred defaults or key
// deletion. The graph owns admission and CAS; the sweep narrows the mutation.
import { type Bundle, token } from '@yaks/graph'
import { type Door } from './door.ts'
import { part } from './key-audit.ts'
import { KERNEL } from './meta.ts'

let object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value == 'object' && !Array.isArray(value)
let uuid = (value: unknown): value is string =>
  typeof value == 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
let no = (message: string) =>
  Response.json({ error: { code: 'bad_repair', message } }, { status: 400 })

export let repair = async (request: Request, door: Door): Promise<Response> => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return no('send {check, change} as JSON')
  }
  if (
    !object(body) ||
    Object.keys(body).some((k) => !['check', 'change'].includes(k)) ||
    typeof body.check != 'boolean' || !Array.isArray(body.change) ||
    !body.change.length || body.change.length > 2
  ) return no('send explicit check:boolean and one or two changes')
  let changes: Bundle[] = []
  let seen = new Set<string>()
  for (let row of body.change) {
    if (
      !object(row) || !object(row.entity) || Object.keys(row.entity).some((k) =>
        k != 'eid'
      ) || !uuid(row.entity.eid) || seen.has(row.entity.eid)
    ) return no('each change selects a distinct eid UUID')
    let eid = row.entity.eid
    seen.add(eid)
    let name = row.build ? 'build' : 'built'
    let prop = name == 'build' ? 'match' : 'build'
    if (
      Object.keys(row).some((k) => !['entity', name, '$was'].includes(k)) ||
      !object(row[name]) || Object.keys(row[name]).length != 1 ||
      !Object.hasOwn(row[name], prop) || !object(row.$was) ||
      Object.keys(row.$was).length != 1 || !object(row.$was[name]) ||
      Object.keys(row.$was[name]).length != 1 ||
      !Object.hasOwn(row.$was[name], prop)
    ) {
      return no(
        'only build.match or built.build and its explicit $was are accepted',
      )
    }
    let value = row[name][prop]
    if (name == 'build') {
      let tuple: unknown
      try {
        tuple = typeof value == 'string' ? JSON.parse(value) : null
      } catch {
        return no('match must be a JSON entity-ID tuple')
      }
      if (
        !Array.isArray(tuple) ||
        !tuple.every((id) => id === null || (typeof id == 'string' && !!id))
      ) return no('match must be a JSON entity-ID tuple')
    } else if (!uuid(value)) {
      return no('built.build must name an existing build UUID')
    }
    let q = `.entity.eid=${eid}&*`
    let rows: Bundle[] = await door.consume(
      `/query?q=${encodeURIComponent(q)}`,
      (r) => r.json(),
      { method: 'GET' },
      KERNEL,
    )
    let held = part(rows[0], name)
    if (!held) return no(`selected eid has no ${name}`)
    if (held[prop] != null) {
      return no(
        'repair only fills missing metadata; it never replaces held values',
      )
    }
    if (row.$was[name][prop] !== token(held[prop])) {
      return Response.json({
        error: { code: 'stale_repair', message: 'selected field changed' },
      }, { status: 409 })
    }
    if (name == 'built') {
      let target: Bundle[] = await door.consume(
        `/query?q=${encodeURIComponent(`.entity.eid=${value}&*`)}`,
        (r) => r.json(),
        { method: 'GET' },
        KERNEL,
      )
      if (!part(target[0], 'build')) {
        return no('built.build must name a build in this store')
      }
    }
    // Also guard the identity evidence read beside the missing field. A
    // concurrent rebuild must not receive metadata derived from an older one.
    let was = Object.fromEntries(
      (name == 'build'
        ? ['builder', 'variant', 'key', 'match']
        : ['slot', 'key', 'build']).map((p) => [p, token(held[p])]),
    )
    changes.push({
      entity: { eid },
      [name]: { [prop]: value },
      $was: { [name]: was },
    })
  }
  return await door(`/apply${body.check ? '?check=1' : ''}`, {
    method: 'POST',
    body: JSON.stringify(changes),
  }, KERNEL)
}
