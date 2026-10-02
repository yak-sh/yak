// Resolve the same app selector commands take, without asking an app to
// declare a command. The account's reach is the directory's; the store's own
// doors still decide what this caller may read once it gets there.
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import { picked, reachable } from './declared.ts'
import { bound, type Env } from './env.ts'
import { narrowed } from './grants.ts'
import { spaceHost } from './host.ts'
import { asking, challenge } from './identity.ts'

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let no = (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, {
      status,
      headers: status == 401
        ? { 'www-authenticate': challenge(new URL(req.url), env) }
        : {},
    })
  if (req.method != 'GET') {
    return no(405, 'method_not_allowed', 'app resolution takes GET')
  }
  let { who } = await asking(env, req)
  if (!who) return no(401, 'sign_in', 'Sign in with yak login first')
  let said = new URL(req.url).searchParams.get('app') ?? ''
  if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(said)) {
    return no(400, 'arguments', 'name an app by its slug or <space>/<app>')
  }
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let all = await reachable({
    dir: who.space ? narrowed(dir, who.space) : dir,
    person: who.person,
  })
  let found = picked(all, said)
  if (!found.length) {
    return no(404, 'not_found', `no app ${said} in your spaces`)
  }
  if (found.length > 1) {
    return no(
      400,
      'arguments',
      `${said} is in several spaces — name <space>/<app>`,
    )
  }
  let { space, app } = found[0]
  return Response.json({
    app: `${space.slug}/${app.slug}`,
    url: `https://${spaceHost(env, space.slug)}/${app.slug}/api`,
  })
}
