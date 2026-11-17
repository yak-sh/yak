// The `./routes` facet: a form's door, at `/api/form/<name>` beside the pages
// that link it, open to whoever asks whatever the app's access. GET shows the
// form, POST takes a sign-up, and a browser's native post is answered by
// sending it back to the page it came from (`native`).
//
// What only the host knows comes in as data: who is asking (`host.who`), the
// row of the app's own people a signed-in person is (`options.known`), how a
// registration is written (`options.post`) and the clock (`options.now`). A
// host that splits the door across two processes, as yaks.app answers the
// browser at its edge and the form in the app's store, wraps its own forward
// in `native` and answers the rest with `door`.
import { line } from '@yaks/query'
import type { Actor, Bundle, Comp, Graph } from '@yaks/graph'
import { derivedEid, mint } from '@yaks/graph/identity'
import { Refused } from '@yaks/graph/errors'
import type { Handler, Route } from '@yaks/api/routed'
import { IDEMPOTENCY } from '@yaks/api/log'
import {
  accepted,
  type Answers,
  type Form,
  missing,
  open,
  posted,
  prefilled,
  screened,
  type Signs,
  signsOf,
} from './mod.ts'
import type { Door } from './fill.ts'
import type { Options } from './options.ts'

/** Where a form's door is: `<FORM><name>`, the form's alias or its eid. */
export let FORM = '/api/form/'

/** What the door is given by its host: the app's graph, and who a request is
 * from (@yaks/api `Authenticate`), whose `by` is the person submitting. */
export type Host = {
  graph: Graph
  who?: (req: Request) => Actor | null | Promise<Actor | null>
}

let NO_STORE = { 'cache-control': 'no-store' }
let reply = (message: string, status: number) =>
  new Response(message, { status, headers: NO_STORE })
let nothing = () => new Response(null, { status: 204, headers: NO_STORE })

let plain = (req: Request) =>
  req.method == 'POST' &&
  req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ==
    'application/x-www-form-urlencoded'

// The form a path names, decoded strictly: an incomplete escape names none.
let nameOf = (req: Request): string | null => {
  let rest = new URL(req.url).pathname.split(FORM)[1]
  if (!rest || rest.includes('/')) return null
  try {
    return decodeURIComponent(rest) || null
  } catch {
    return null
  }
}

/** Where a native form post sends the browser: back to the page it came
 * from, or the app's page beside the door, told the door's answer in its
 * `yak-form` parameter (@yaks/forms/fill `returned`). */
/// back('https://a.test/app/api/form/x', null).headers.get('location') -> 'https://a.test/app/?yak-form=%7B%22at%22%3A%22https%3A%2F%2Fa.test%2Fapp%2Fapi%2Fform%2Fx%22%2C%22sent%22%3Atrue%7D'
/// new URL(back('https://a.test/app/api/form/x', 'https://a.test/app/join?k=1', 'Full.').headers.get('location')!).searchParams.get('k') -> '1'
/// new URL(back('https://a.test/app/api/form/x', 'https://evil.test/', 'Full.').headers.get('location')!).origin -> 'https://a.test'
export let back = (
  at: string,
  referer: string | null,
  said?: string,
): Response => {
  let door = new URL(at), page = new URL(door)
  page.pathname = door.pathname.replace(/\/api\/form\/[^/]+$/, '/')
  page.search = ''
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
      ...said == null ? { sent: true } : { said },
    }),
  )
  return new Response(null, {
    status: 303,
    headers: { ...NO_STORE, location: page.href },
  })
}

/** `handle`, answering a browser's native post (`x-www-form-urlencoded`) by
 * sending it back to its page with what the door said; the door asked at
 * `address`, the request's own URL by default. A failure of the door's own
 * passes on as it came. */
export let native = (
  handle: Handler,
  address: (req: Request) => string = (req) => req.url,
): Handler =>
async (req) => {
  let answer = await handle(req)
  if (!plain(req) || answer.status >= 500) return answer
  let text = answer.status == 204 ? '' : await answer.text()
  return back(
    address(req),
    req.headers.get('referer'),
    answer.ok ? undefined : text,
  )
}

/** Why a form takes no file for `question` now, as its door showed it, or
 * undefined where it does: the bytes an upload sends are admitted only for a
 * file question of a form that is open. */
/// noFile({ form: {}, open: false, questions: [] }, 'q') -> 'This form is closed or full.'
/// noFile({ form: {}, open: true, questions: [{ entity: { eid: 'q' }, question: { form: 'f', label: 'CV', kind: 'file' } }] }, 'q') -> undefined
/// noFile({ form: {}, open: true, questions: [{ entity: { eid: 'q' }, question: { form: 'f', label: 'Name', kind: 'line' } }] }, 'q') -> 'No such file question.'
export let noFile = (form: Door, question: string | null): string | undefined =>
  !form.open
    ? 'This form is closed or full.'
    : form.questions.some((q) =>
        q.entity.eid == question && q.question.kind == 'file'
      )
    ? undefined
    : 'No such file question.'

let only = (comp: unknown, keys: readonly string[]): Comp =>
  Object.fromEntries(
    keys.flatMap((key) => {
      let value = (comp as Comp | undefined)?.[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )

// `closed` is what the form says while it takes no sign-ups (T-151836).
let SHOWN = ['opens', 'closes', 'capacity', 'thanks', 'closed']

/** The door itself, answering in JSON: GET is what a page needs to draw the
 * form and nothing more (never `notify`, whose recipients are the app's, and
 * of its registrations only whether one more fits), with the answers a known
 * person's row already holds; POST `{answers, signs}`, or a native post's
 * fields, files a registration and answers 204, or says in a sentence why
 * not. */
export let door = (host: Host, options: Options = {}): Handler => {
  let now = options.now ?? Date.now
  let post = options.post ?? ((rows: Bundle[]) => host.graph.apply(rows))
  let known = (person: string | null) =>
    person ? options.known?.(person) : undefined
  let questions = (eid: string) => host.graph.read(line`.question.form=${eid}`)

  let shown = async (eid: string, row: Bundle, person: string | null) => {
    let form = only(row.form, SHOWN)
    let [rows, held, me] = await Promise.all([
      questions(eid),
      form.capacity == null
        ? []
        : host.graph.read(accepted(eid, Number(form.capacity))),
      known(person),
    ])
    let asked = rows.map((q) => ({
      entity: { eid: q.entity.eid },
      question: q.question,
    })) as unknown as Form['questions']
    let answers = prefilled({ form, questions: asked }, me)
    return Response.json({
      entity: { eid },
      doc: only(row.doc, ['title', 'body']),
      form,
      open: open({ form }, now(), held.length),
      questions: asked,
      ...Object.keys(answers).length ? { answers } : {},
    }, { headers: NO_STORE })
  }

  let take = async (
    req: Request,
    eid: string,
    row: Bundle,
    person: string | null,
  ) => {
    let asked = async () =>
      ({ form: row.form, questions: await questions(eid) }) as unknown as Form
    let answers: unknown, signs: Signs = {}
    if (plain(req)) {
      let fields = new URLSearchParams(await req.text())
      answers = posted(await asked(), fields)
      signs = signsOf(fields)
    } else {
      try {
        let sent = await req.json() as {
          answers?: unknown
          signs?: Signs
        } | null
        answers = sent?.answers
        if (sent?.signs && typeof sent.signs == 'object') signs = sent.signs
      } catch {
        return reply('Submit an answers object.', 400)
      }
    }
    if (!answers || typeof answers != 'object' || Array.isArray(answers)) {
      return reply('Submit an answers object.', 400)
    }
    // A submission sent again, because its answer was cut off, carries the
    // key it carried the first time and names the same registration: one
    // that landed is not filed twice.
    let key = req.headers.get(IDEMPOTENCY)
    let filed = key ? derivedEid(JSON.stringify(['registration', key])) : mint()
    if (key && (await host.graph.get([filed], ['registration']))[0]) {
      return nothing()
    }
    // A sign-up taken for a bot's is kept, held and not completed, so it
    // sends nothing and takes no place until the app's people accept it. A
    // person the app knows is never screened: their form comes filled in.
    let why = person ? undefined : screened(signs)
    if (why && missing(await asked(), answers as Answers).length) {
      return reply('Answer every required question.', 400)
    }
    let me = await known(person)
    try {
      await post([{
        entity: { eid: filed },
        registration: {
          form: eid,
          answers,
          at: new Date(now()).toISOString(),
          ...person ? { submitter: person } : {},
          ...me ? { person: me.entity.eid } : {},
        },
        ...why ? { held: { why } } : { completed: {} },
      }])
    } catch (error) {
      if (error instanceof Refused) return reply(error.message, 400)
      throw error
    }
    return nothing()
  }

  return async (req) => {
    let name = nameOf(req)
    if (!name) return reply('No such form.', 404)
    if (req.method != 'GET' && req.method != 'POST') {
      return reply('Use GET or POST.', 405)
    }
    let eid = (await host.graph.address([name], 'form')).get(name) ?? name
    let [row] = await host.graph.get([eid], ['form', 'doc'])
    if (!row?.form) return reply('No such form.', 404)
    let person = (await host.who?.(req))?.by ?? null
    return req.method == 'GET'
      ? shown(eid, row, person)
      : take(req, eid, row, person)
  }
}

/** The form door, natively posted to or asked in JSON. */
export let routes = (host: Host, options: Options = {}): Route[] => [{
  method: '*',
  path: `${FORM}*`,
  handle: native(door(host, options)),
  says: 'the app’s forms',
}]
