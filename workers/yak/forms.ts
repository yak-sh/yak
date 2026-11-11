// A public door onto an app's forms: it shows one form and takes its
// submissions, whatever the app's access; ordinary app pages render permanent
// form links. A caller signed in as one of the app's own people (recognized.ts)
// is shown the answers their row already holds, and their sign-up names them.
import { type Comp, mint, signed } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import {
  type Answers,
  type Form,
  missing,
  open,
  posted,
  prefilled,
  screened,
  type Signs,
  signsOf,
} from '@yaks/forms'
import { accepted } from './form-rules.ts'
import type { Answer } from './apps.ts'
import { type Door, IDEMPOTENCY } from './door.ts'
import type { Stored } from './graph.ts'
import { appStore } from './directory.ts'
import { KERNEL } from './meta.ts'
import { decodedPath } from './request-path.ts'
import { ADDRESS } from './route.ts'
import { recognized } from './recognized.ts'

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
// recipients are the app's, and no registration but their count. The caller's
// own row fills `answers`, and only theirs.
let shown = async (
  at: Stored,
  eid: string,
  row: Comp,
  person: string | null,
) => {
  let form = only(row.form, SHOWN)
  let [questions, held, me] = await Promise.all([
    at.graph.read(`.question.form=${JSON.stringify(eid)}`),
    form.capacity == null
      ? []
      : at.graph.read(accepted(eid, Number(form.capacity))),
    recognized(at, person),
  ])
  let asked = questions.map((q) => ({
    entity: { eid: q.entity.eid },
    question: q.question,
  })) as unknown as Form['questions']
  let answers = prefilled({ form, questions: asked }, me)
  return Response.json({
    entity: { eid },
    doc: only(row.doc, ['title', 'body']),
    form,
    open: open({ form }, at.now(), held.length),
    questions: asked,
    ...Object.keys(answers).length ? { answers } : {},
  }, { headers: NO_STORE })
}

export let formIn = async (req: Request, at: Stored): Promise<Response> => {
  if (!at.app) return reply('No such form.', 404)
  let name = new URL(req.url).searchParams.get('name') ?? ''
  let ids = await at.graph.address([name], 'form')
  let eid = ids.get(name) ?? name
  let [row] = await at.graph.get([eid], ['form', 'doc'])
  if (!row?.form) return reply('No such form.', 404)
  let person = req.headers.get('x-yak-person')
  if (req.method == 'GET') return shown(at, eid, row, person)
  if (req.method != 'POST') return reply('Use GET or POST.', 405)
  let asked = async () =>
    ({
      form: row.form,
      questions: await at.graph.read(`.question.form=${JSON.stringify(eid)}`),
    }) as unknown as Form
  let answers: unknown, signs: Signs = {}
  if (native(req)) {
    let fields = new URLSearchParams(await req.text())
    answers = posted(await asked(), fields)
    signs = signsOf(fields)
  } else {
    try {
      let sent = await req.json() as { answers?: unknown; signs?: Signs } | null
      answers = sent?.answers
      if (sent?.signs && typeof sent.signs == 'object') signs = sent.signs
    } catch {
      return reply('Submit an answers object.', 400)
    }
  }
  if (!answers || typeof answers != 'object' || Array.isArray(answers)) {
    return reply('Submit an answers object.', 400)
  }
  // A submission the door sends again, because a deploy's restart cut off its
  // answer, carries the key it carried the first time, and names the same
  // registration: one that landed is not filed twice.
  let key = req.headers.get(IDEMPOTENCY)
  let filed = key ? derivedEid(JSON.stringify(['registration', key])) : mint()
  if (key && (await at.graph.get([filed], ['registration']))[0]) {
    return new Response(null, { status: 204, headers: NO_STORE })
  }
  // A sign-up the door takes for a bot's is kept, held and not completed, so
  // it sends nothing and takes no place until the app's people accept it. A
  // person the app knows is never screened: their form comes filled in.
  let why = person ? undefined : screened(signs)
  if (why && missing(await asked(), answers as Answers).length) {
    return reply('Answer every required question.', 400)
  }
  let me = await recognized(at, person)
  try {
    await at.graph.apply(signed([{
      entity: { eid: filed },
      registration: {
        form: eid,
        answers,
        at: new Date(at.now()).toISOString(),
        ...person ? { submitter: person } : {},
        ...me ? { person: me.entity.eid } : {},
      },
      ...why ? { held: { why } } : { completed: {} },
    }], { by: at.app }))
  } catch (error) {
    if (error instanceof Refused) return reply(error.message, 400)
    throw error
  }
  return new Response(null, { status: 204, headers: NO_STORE })
}

export let forms: Answer = async (
  { req, env, path, space, app, who, json },
) => {
  let match = path.match(/^\/form\/([^/]+)$/)
  if (!match) return null
  let post = req.method == 'POST'
  if (!post && req.method != 'GET') return json(405, 'method_not_allowed')
  let name = decodedPath(match[1])
  if (!name) return reply('No such form.', 404)
  // A store still on code from before GET showed a form answers it an empty
  // 204, which passes on as it came. A submission is sent as its bytes, never
  // its stream, so the door can send it again when a deploy's restart cuts it
  // off (door.ts `storeOf`).
  let body = post ? await req.arrayBuffer() : null
  return await appStore(env.STORE, space, app, env).consume(
    `/form?${new URLSearchParams({ name })}`,
    async (r) => {
      let text = r.status == 204 ? '' : await r.text()
      if (native(req) && r.status < 500) {
        return returned(req, r.ok ? undefined : text)
      }
      return new Response(r.status == 204 ? null : text, r)
    },
    { method: req.method, body, headers: req.headers },
    who.person ? { ...KERNEL, 'x-yak-person': who.person } : KERNEL,
  )
}

/** A public form admits bytes only for a file question it is accepting now. */
export let formUpload = (
  req: Request,
  store: Door,
): Promise<Response | null> => {
  let params = new URL(req.url).searchParams
  return store.consume(
    `/form?${new URLSearchParams({ name: params.get('form') ?? '' })}`,
    async (r) => {
      if (!r.ok) return r
      let form = await r.json() as {
        open: boolean
        questions: Form['questions']
      }
      if (!form.open) return reply('This form is closed or full.', 400)
      return form.questions.some((q) =>
          q.entity.eid == params.get('question') && q.question.kind == 'file'
        )
        ? null
        : reply('No such file question.', 400)
    },
    {},
    KERNEL,
  )
}
