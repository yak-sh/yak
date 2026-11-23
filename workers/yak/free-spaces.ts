// One person's allowance of free spaces (@yaks/platform/plans `freeSpaces`),
// or a role's, read or set by an owner of the platform's space, the way a comp
// is (comp.ts): a number, `unlimited`, or `default` to take it off. A
// person's is written on their directory row as `free_spaces{count}`; a
// role's, the allowance of every seat of that role in the platform's space
// whose person has none of their own, on that space's row as
// `role_free_spaces{owner, editor, viewer}`.
import * as dirPart from './directory.ts'
import { directory, type Role, stamp } from './directory.ts'
import { freeSpaces } from '@yaks/platform/plans'
import { bound, type Env } from './env.ts'
import { adminWho } from './asking.ts'

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })
let quota = (allowed: number) =>
  Number.isFinite(allowed) ? allowed : 'unlimited'
let ROLES: Role[] = ['owner', 'editor', 'viewer']

// What `spaces` asks for, as the row's component: null takes it off.
let wanted = (said: string) =>
  said == 'default'
    ? null
    : said == 'unlimited'
    ? { count: null }
    : /^\d+$/.test(said)
    ? { count: Number(said) }
    : undefined

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return json(405, 'method_not_allowed', 'get the allowance, or post one')
  }
  let form = req.method == 'POST' ? await req.formData() : null
  let said = (key: string) =>
    String(
      (form ? form.get(key) : new URL(req.url).searchParams.get(key)) ?? '',
    ).trim()
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let meta = await dir.space(dirPart.META.space)
  if (!meta) return json(503, 'no_platform', 'the directory has not seeded yet')
  let who = await adminWho(env, req, (person) => dir.role(meta, person))
  if (who.role != 'owner') {
    return json(
      403,
      'not_owner',
      `an allowance is set by an owner of ${meta.slug}`,
    )
  }
  let role = said('role') as Role
  if (role) {
    if (!ROLES.includes(role)) {
      return json(400, 'bad_role', `say a role: ${ROLES.join(', ')}`)
    }
    if (!form) {
      return Response.json({
        role,
        spaces: quota(freeSpaces((await dir.roleSpaces())[role])),
      })
    }
    let allowance = wanted(said('spaces'))
    if (allowance === undefined) {
      return json(400, 'bad_spaces', 'say a number, unlimited or default')
    }
    await stamp(env, {
      entities: [{
        entity: { eid: meta.eid },
        role_free_spaces: { [role]: allowance },
      }],
    }, { actor: { by: who.person! } })
    return Response.json({ role, spaces: quota(freeSpaces(allowance)) })
  }
  let address = said('person').toLowerCase()
  let person = address && await dir.personAt(address)
  if (!person) return json(404, 'no_person', 'nobody has that address')
  if (!form) {
    let { held, allowed, canCreate } = await dir.spaceRoom(person)
    return Response.json({
      person: address,
      spaces: quota(allowed),
      used: held.length,
      canCreate,
    }, { headers: { 'cache-control': 'private, no-store' } })
  }
  let free_spaces = wanted(said('spaces'))
  if (free_spaces === undefined) {
    return json(400, 'bad_spaces', 'say a number, unlimited or default')
  }
  await stamp(env, { entities: [{ entity: { eid: person }, free_spaces }] }, {
    actor: { by: who.person! },
  })
  return Response.json({
    person: address,
    spaces: quota(await dir.freeSpaces(person)),
  })
}
