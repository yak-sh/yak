// App pages and workers use the same scoped service operations as commands.
import { CallError, refused } from '@yaks/tools/errors'
import type { App, Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import { itsApp } from './dispatch.ts'
import type { Who } from './session.ts'
import {
  callService,
  connectService,
  serviceFrom,
  verifyService,
} from './service-call.ts'

export let serviceRoute = async (
  req: Request,
  env: Env,
  dir: Directory,
  source: { space: Space; app: App },
  who: Who,
  path: string,
): Promise<Response> => {
  if (req.method != 'POST') return new Response(null, { status: 405 })
  try {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
      throw new CallError('arguments', 'Send a JSON object')
    }
    if (!body || typeof body != 'object' || Array.isArray(body)) {
      throw new CallError('arguments', 'Send a JSON object')
    }
    if (path == '/service/verify') {
      if (!itsApp(who, source.app)) {
        throw new CallError(
          'access',
          'Only the service worker verifies its retained authority',
        )
      }
      let authority = typeof body.authority == 'string'
        ? await serviceFrom(env, body.authority)
        : null
      if (
        !authority || authority.service != source.app.eid ||
        !await verifyService(env, dir, authority)
      ) throw new CallError('access', 'This service authority was revoked')
      return Response.json(authority)
    }
    if (!who.person || itsApp(who, source.app)) {
      throw new CallError('access', 'Call as the person using the app')
    }
    if (typeof body.service != 'string') {
      throw new CallError('arguments', 'Name the service app id')
    }
    if (path == '/service/connect') {
      if (!Array.isArray(body.operations)) {
        throw new CallError(
          'arguments',
          'Give the selected operations as a list',
        )
      }
      return Response.json(
        await connectService(
          env,
          dir,
          source,
          who,
          body.service,
          body.operations as string[],
        ),
      )
    }
    if (path != '/service') return new Response(null, { status: 404 })
    if (
      typeof body.name != 'string' || !body.args ||
      typeof body.args != 'object' || Array.isArray(body.args)
    ) throw new CallError('arguments', 'Name the command and its arguments')
    return Response.json(
      await callService(
        env,
        dir,
        source,
        who,
        body.service,
        body.name,
        body.args as Record<string, unknown>,
      ),
    )
  } catch (error) {
    if (error instanceof CallError) return refused(error)
    throw error
  }
}
