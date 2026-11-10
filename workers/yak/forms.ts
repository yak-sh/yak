// A public door onto an app's forms: it shows one form and takes its
// submissions, whatever the app's access; ordinary app pages render permanent
// form links.
import { type Comp, mint, signed } from '@yaks/graph'
import { Refused } from '@yaks/graph/errors'
import { type Form, open, posted } from '@yaks/forms'
import { accepted } from './form-rules.ts'
import type { Answer } from './apps.ts'
import type { Stored } from './graph.ts'
import { appStore } from './directory.ts'
import { KERNEL } from './meta.ts'
import { decodedPath } from './request-path.ts'
import { ADDRESS } from './route.ts'

let NO_STORE = { 'cache-control': 'no-store' }
let reply = (message: string, status: number) =>
  new Response(message, { status, headers: NO_STORE })
let native = (req: Request) =>
  req.method == 'POST' &&
  req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ==
    'application/x-www-form-urlencoded'

let returned = (req: Request, message?: string) => {
  let door = new URL(req.headers.get(ADDRESS) ?? req.url), page = new URL(door)
  page.pathname = door.pathname.replace(/\/api\/form\/[^/]+$/, '/')
  page.search = ''
  let referer = req.headers.get('referer')
  try {
    let from = referer && new URL(referer)
    if (from && from.origin == door.origin) page = from
  } catch { /* A malformed referring URL falls back to the app's page. */ }
  door.search = ''
  door.hash = ''
  page.searchParams.set(
    'yak-form',
    JSON.stringify({
      at: door.href,
      ...message == null ? { sent: true } : { said: message },
    }),
  )
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE, location: page.href },
  })
}

let only = (comp: unknown, keys: readonly string[]): Comp =>
  Object.fromEntries(
    keys.flatMap((key) => {
      let value = (comp as Comp | undefined)?.[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )

// `closed` is what the form says while it takes no sign-ups (T-151836).
let SHOWN = ['opens', 'closes', 'capacity', 'thanks', 'closed']

// What a page needs to draw the form and nothing more: never `notify`, whose
// recipients are the app's, and no registration but their count.
let shown = async (at: Stored, eid: string, row: Comp) => {
  let form = only(row.form, SHOWN)
  let [questions, held] = await Promise.all([
    at.graph.read(`.question.form=${JSON.stringify(eid)}`),
    form.capacity == null
      ? []
      : at.graph.read(accepted(eid, Number(form.capacity))),
  ])
  return Response.json({
    entity: { eid },
    doc: only(row.doc, ['title', 'body']),
    form,
    open: open({ form }, at.now(), held.length),
    questions: questions.map((q) => ({
      entity: { eid: q.entity.eid },
      question: q.question,
    })),
  }, { headers: NO_STORE })
}

export let formIn = async (req: Request, at: Stored): Promise<Response> => {
  if (!at.app) return reply('No such form.', 404)
  let name = new URL(req.url).searchParams.get('name') ?? ''
  let ids = await at.graph.address([name], 'form')
  let eid = ids.get(name) ?? name
  let [row] = await at.graph.get([eid], ['form', 'doc'])
  if (!row?.form) return reply('No such form.', 404)
  if (req.method == 'GET') return shown(at, eid, row)
  if (req.method != 'POST') return reply('Use GET or POST.', 405)
  let answers: unknown
  if (native(req)) {
    let questions = await at.graph.read(`.question.form=${JSON.stringify(eid)}`)
    answers = posted(
      { form: row.form, questions } as unknown as Form,
      new URLSearchParams(await req.text()),
    )
  } else {
    try {
      answers = (await req.json() as { answers?: unknown } | null)?.answers
    } catch {
      return reply('Submit an answers object.', 400)
    }
  }
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
  return new Response(null, { status: 204, headers: NO_STORE })
}

export let forms: Answer = ({ req, env, path, space, app, json }) => {
  let match = path.match(/^\/form\/([^/]+)$/)
  if (!match) return null
  let post = req.method == 'POST'
  if (!post && req.method != 'GET') return json(405, 'method_not_allowed')
  let name = decodedPath(match[1])
  if (!name) return reply('No such form.', 404)
  // A store still on code from before GET showed a form answers it an empty
  // 204, which passes on as it came.
  return appStore(env.STORE, space, app, env).consume(
    `/form?${new URLSearchParams({ name })}`,
    async (r) => {
      let text = r.status == 204 ? '' : await r.text()
      if (native(req) && r.status < 500) {
        return returned(req, r.ok ? undefined : text)
      }
      return new Response(r.status == 204 ? null : text, r)
    },
    { method: req.method, body: post ? req.body : null, headers: req.headers },
    KERNEL,
  )
}
