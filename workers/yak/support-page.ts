// A support thread's page (support.ts), at `/support/<thread>`, the link the
// feedback tool answers with and the person's Updates lead to
// (support-reply.ts): what was told yaks.app, every answer after it with the
// fix it links, and how it stands, and a box to add to it.
//
// Read and written signed in, through the same operations the feedback tool
// uses: `read`, the one access decision `opens`, and `adding`, which keeps
// the words with the letter TaskMaster is owed. A thread nobody here may read
// answers exactly what a thread that does not exist answers, so an id says
// nothing about anybody's thread, a thread said signed out included.
import { h } from 'preact'
import { Button, Card, Field, Time } from '@yaks/ui/parts'
import { bound, type Env } from './env.ts'
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { meta } from './meta.ts'
import { sessionAt, titling, vouched } from './session.ts'
import { lost, page, said as notice } from './pages.ts'
import { markdown } from './operator-draw.ts'
import {
  adding,
  asking,
  type Fix,
  lately,
  type Message,
  named,
  opens,
  read,
  SAYS,
  SUPPORT,
  type Thread,
} from './support.ts'

export let PATH = SUPPORT

/** How a thread stands, in a sentence. */
export let standing = (t: Thread) =>
  t.completed
    ? 'yaks.app marked this done.'
    : t.messages.some((m) => m.from == 'platform')
    ? 'yaks.app answered; it is still open.'
    : 'Waiting for an answer from yaks.app.'

// Who said one message, to `me` reading it.
let speaker = (m: Pick<Message, 'from' | 'person'>, me: string) =>
  m.from == 'platform'
    ? 'yaks.app'
    : m.person && m.person == me
    ? 'You'
    : 'Someone in its space'

// A fix as the person reads it: a commit links to its page in the public
// repository, by its title; anything else is its title alone, and a fix
// with nothing kept of it its id (support.ts `fixOf`).
let fixed = (f: Fix) =>
  f.href
    ? h('a', { href: f.href }, named(f))
    : f.title ?? h('code', null, f.eid)

// One message: who said it and when, its words, and the fix it links.
let message = (
  m: Pick<Message, 'from' | 'person' | 'at' | 'words' | 'fixes'>,
  me: string,
) =>
  h(
    Card,
    null,
    h(
      'p',
      { class: 'Support_Meta' },
      speaker(m, me),
      m.at ? [' · ', h(Time, { at: m.at })] : null,
    ),
    h('div', { class: 'Support_Words' }, markdown(m.words)),
    m.fixes.length
      ? h(
        'p',
        { class: 'Support_Fix' },
        'Fix: ',
        m.fixes.map((f, i) => [i ? ', ' : '', fixed(f)]),
      )
      : null,
  )

/** The thread as `me` reads it: what opened it, each message after it, how
 * it ended, and the box that adds to it. */
export let view = (t: Thread, me: string, say?: string, no?: boolean) =>
  h(
    'div',
    { class: 'Support' },
    message({
      from: 'person',
      person: t.person,
      at: t.at,
      words: t.words,
      fixes: [],
    }, me),
    t.messages.map((m) => message(m, me)),
    t.completed
      ? h(
        'p',
        { class: 'Support_Meta' },
        'Marked done',
        t.completed.at ? [' · ', h(Time, { at: t.completed.at })] : null,
      )
      : null,
    notice(say, no),
    h(
      'form',
      { class: 'Support_Form Page_Form', method: 'post' },
      h(Field, {
        class: 'Support_Input',
        lines: true,
        name: 'text',
        required: true,
        'aria-label': 'Add to the thread',
      }),
      h(Button, { mod: 'go', type: 'submit' }, 'Send'),
    ),
  )

let drawn = (
  env: Env,
  t: Thread,
  me: string,
  say?: string,
  status = 200,
) =>
  page(env, {
    title: t.title,
    lead: standing(t),
    status,
    headers: { 'cache-control': 'no-store' },
  }, view(t, me, say, status != 200))

/** `/support/<thread>`: the thread to anybody it opens to, signed in; a
 * POST adds its words. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
): Promise<Response> => {
  let eid = path.slice(PATH.length + 1)
  if (!eid || eid.includes('/') || !['GET', 'POST'].includes(req.method)) {
    return lost(env)
  }
  let person = (await sessionAt(req, env.SESSION_SECRET))?.person
  if (!person) {
    return new Response(null, {
      status: 303,
      headers: { location: `/login?return=${encodeURIComponent(path)}` },
    })
  }
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let store = meta(env)
  let t = await read(store, eid)
  if (!t || !await opens(t, asking(dir, person))) return lost(env)
  if (req.method != 'POST') return drawn(env, t, person)
  let words = String((await req.formData()).get('text') ?? '').trim()
  if (!words) return drawn(env, t, person, 'Say something to add.', 400)
  let held = await lately(store, person)
  if (held >= SAYS) {
    return drawn(
      env,
      t,
      person,
      `That is ${held} already this hour. Every one is kept and read; add the rest later.`,
      429,
    )
  }
  await adding(store, env, dir, t, { words, person }, {
    ...vouched({ person, role: null }),
    ...await titling(dir, person),
  })
  return new Response(null, { status: 303, headers: { location: path } })
}
