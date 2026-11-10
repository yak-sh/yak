// TaskMaster's door to the support threads (support.ts): the threads still
// waiting, one thread whole, and an answer in it. Only an owner of the
// platform's own space is answered, the seat every platform act answers to
// (comp.ts), and an answer is written as that person through their verified
// instrument, never as anyone the request names.
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { adminWho } from './asking.ts'
import { meta } from './meta.ts'
import { vouched } from './session.ts'
import {
  answer,
  context,
  link,
  read,
  type Thread,
  transcript,
  waiting,
} from './support.ts'

export let PATH = '/api/support'

let no = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// A thread as TaskMaster reads it: everything the store holds about it, and
// the same as words, each message with the id an answer names in reply_to.
let whole = (t: Thread, env: Env) => ({
  ...t,
  link: link(env, t.eid),
  text: `${context(t)}\n\n${transcript(t, null, true)}`,
})

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return no(405, 'method_not_allowed', 'get a thread, or post an answer')
  }
  let form = req.method == 'POST' ? await req.formData() : null
  let said = (key: string) => {
    let v = form ? form.get(key) : new URL(req.url).searchParams.get(key)
    return typeof v == 'string' && v.trim() ? v.trim() : null
  }
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let platform = await dir.space(dirPart.META.space)
  if (!platform) {
    return no(503, 'no_platform', 'the directory has not seeded yet')
  }
  let who = await adminWho(env, req, (person) => dir.role(platform, person))
  if (who.role != 'owner') {
    return no(
      403,
      'not_owner',
      `support threads are answered by an owner of ${platform.slug}`,
    )
  }
  let store = meta(env)
  let eid = said('thread')
  if (!eid) {
    if (form) return no(400, 'no_thread', 'name the thread to answer')
    return Response.json({
      threads: (await waiting(store)).map((t) => whole(t, env)),
    })
  }
  let t = await read(store, eid)
  if (!t) return no(404, 'no_thread', `no thread ${eid}`)
  if (!form) return Response.json(whole(t, env))
  let reply_to = said('reply_to')
  if (reply_to && !t.messages.some((m) => m.eid == reply_to)) {
    return no(400, 'no_message', `no message ${reply_to} in ${eid}`)
  }
  let words = said('text') ?? '', fix = said('fix')
  let complete = said('complete') == 'true'
  if (!words && !fix && !complete) {
    return no(400, 'nothing', 'give text, a fix or complete')
  }
  await answer(
    store,
    eid,
    { words, reply_to, fix, complete },
    vouched({
      person: who.person,
      role: 'owner',
      ...who.via ? { via: who.via } : {},
    }),
  )
  return Response.json(whole((await read(store, eid))!, env))
}
