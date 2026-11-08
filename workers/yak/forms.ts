// A public write-only door; ordinary app pages render permanent form links.
import { mint, signed } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import type { Answer } from './apps.ts'
import type { Stored } from './graph.ts'
import { appStore } from './directory.ts'
import { KERNEL } from './meta.ts'
import { decodedPath } from './request-path.ts'

let reply = (message: string, status: number) =>
  new Response(message, { status, headers: { 'cache-control': 'no-store' } })

export let formIn = async (req: Request, at: Stored): Promise<Response> => {
  if (!at.app) return reply('No such form.', 404)
  let name = new URL(req.url).searchParams.get('name') ?? ''
  let ids = await at.graph.address([name], 'form')
  let eid = ids.get(name) ?? name
  let [row] = await at.graph.get([eid], ['form'])
  if (!row?.form) return reply('No such form.', 404)
  if (req.method == 'GET') return new Response(null, { status: 204 })
  if (req.method != 'POST') return reply('Use POST to submit.', 405)
  let body: { answers?: unknown } | null
  try {
    body = await req.json()
  } catch {
    return reply('Submit an answers object.', 400)
  }
  let answers = body?.answers
  if (!answers || typeof answers != 'object' || Array.isArray(answers)) {
    return reply('Submit an answers object.', 400)
  }
  try {
    await at.graph.apply(signed([{
      entity: { eid: mint() },
      registration: {
        form: eid,
        answers,
        at: new Date(at.now()).toISOString(),
      },
      completed: {},
    }], { by: at.app }))
  } catch (error) {
    if (error instanceof Refused) return reply(error.message, 400)
    throw error
  }
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store' },
  })
}

export let forms: Answer = ({ req, env, path, space, app, json }) => {
  let match = path.match(/^\/form\/([^/]+)$/)
  if (!match) return null
  if (req.method != 'POST') return json(405, 'method_not_allowed')
  let name = decodedPath(match[1])
  if (!name) return reply('No such form.', 404)
  return appStore(env.STORE, space, app, env).consume(
    `/form?${new URLSearchParams({ name })}`,
    async (r) => new Response(r.status == 204 ? null : await r.text(), r),
    { method: 'POST', body: req.body, headers: req.headers },
    KERNEL,
  )
}
