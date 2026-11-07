import type { Bundle } from '@yaks/graph'
import { type ComponentChildren as Node, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  Button,
  Card,
  Check,
  Drop,
  Empty,
  Field,
  Form,
  Icon,
  SideNav,
  TabSet,
} from '@yaks/ui/parts'
import type { Env } from './env.ts'
import { directoryOf, type Reach, type Space, walkTo } from './directory.ts'
import { reachOf } from './operator-reach.ts'
import { builderOf, operatorDoor, SPACE } from './build-door.ts'
import { vouched, type Who } from './session.ts'
import { PROTOCOL, protocolled, upgrading } from './protocol.ts'
import { esc, type Picked, shell } from './pages.ts'
import { choice as spaceChoice } from './desk-pages.ts'
import { spaceHost, url } from './host.ts'
import {
  ADMIN,
  chatPath,
  logoPath,
  MANAGE,
  managePath,
  manifestPath,
} from './route.ts'
import { SLUG } from '@yaks/platform/names'
import { PLATFORM_BACKGROUND } from './apps.ts'
import {
  type File,
  keepFile,
  type Request as Intake,
} from './operator-channels.ts'
import { mailFrom } from './post.ts'
import { parts } from './form.ts'
import { gathered } from './bytes.ts'
import { inApp, refuse } from './tool.ts'
import { Idle, MOVES } from './mascot.ts'
import {
  CONSENT,
  REPLIES,
  tell,
  type Texting,
  texts,
} from './operator-texts.ts'
import {
  type Alerting,
  alertsRow,
  pushRow,
  routeOf,
  vapidOf,
} from './operator-alerts.ts'
import { publicKey, type Subscription } from '@yaks/push'
import { given } from './operator-name.ts'
import {
  backendOf,
  BUTLERS,
  hearing,
  modelOf,
  offered,
  paceOf,
  sampled,
  setupOf,
  speaking,
  speaks,
  speechOf,
  voiceOf,
} from './speech.ts'
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import { type Changed, talks, type Underway } from './operator-view.ts'
import {
  attached,
  type Lines,
  PICTURES,
  reply,
  trouble,
} from './operator-draw.ts'
import { does, keeps, type Made, madeOf, type Page, pagesOf } from './made.ts'
import { drafting } from './written.ts'
import { r2RawObjects } from './lib/objects.ts'
import { linkOf } from './preview.ts'
import { VOCABS } from './vocab.ts'
import { DOCUMENTS } from './documents.ts'
import { phoneAt } from './phones.ts'
import { icons } from './icons.ts'
import { needing, needsCard, updates, updatesOf, visitsOf } from './updates.ts'

// What this page draws, as markup: the edge where its parts become text.
let html = (node: Node) => renderToString(h(Fragment, null, node))

// What the message box takes: up to COUNT files at a time, each up to SIZE
// (keepFile's ceiling), and the kinds the Operator reads (operator-channels.ts
// `fileText`, and Claude's own); a file of another kind is kept with the
// message, and the box says the Operator can't read it.
let COUNT = 10
let SIZE = 16 * 1000 * 1000
let READ = ['image/*', 'text/*', ...DOCUMENTS.map((d) => '.' + d)].join(',')
// The most a recording heard at once may be, a minute of Opus with room to
// spare, and the most a line said at once.
let HEARD = 2 * 1000 * 1000
let SAID = 600

let shown = (number: string) =>
  number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')

// One of the Operator's settings, the way the dashboard draws one (pages.ts):
// a form around its card, the card's head naming it, and under the card
// Save, with what saving said beside it (`settingsScript`). `id` names the
// form and the answer it posts to (`operatorAnswer`).
let setting = (at: string, id: string, title: string, ...inside: Node[]) =>
  h(
    Form,
    { id, method: 'post', action: `${at}?${id}=1` },
    h(Card, null, h(Card.Head, null, h(Card.Title, null, title)), ...inside),
    h(
      Form.Actions,
      null,
      h(Button, { mod: 'go', type: 'submit' }, 'Save'),
      h('p', { role: 'status', 'data-status': '' }),
    ),
  )

// A field under its label.
let field = (id: string, label: string, control: Node) =>
  h(Form.Field, null, h(Form.Label, { for: id }, label), control)

/** Over a newcomer's chat (newcomer.ts): their address, which signs them in
 * by a code and keeps the space, its apps and this chat as theirs, back on
 * this page (identity.ts `landed`, newcomer.ts `keep`). */
export let keepCard = (back: string) =>
  h(
    Form,
    { class: 'Talk_Keep', method: 'post', action: '/login' },
    h(
      Card,
      null,
      h(Card.Head, null, h(Card.Title, null, 'Keep this app')),
      h(
        'p',
        null,
        "Give your email and we'll send you a code. The app and this chat become yours, free.",
      ),
      field(
        'keep-email',
        'Email',
        h(Field, {
          id: 'keep-email',
          name: 'address',
          type: 'email',
          required: true,
          autocomplete: 'email',
        }),
      ),
      h('input', { type: 'hidden', name: 'return', value: back }),
    ),
    h(
      Form.Actions,
      null,
      h(Button, { mod: 'go', type: 'submit' }, 'Send me a code'),
    ),
  )

// One of a few to pick, as a radio: its name in bold, what it means beside
// it, `also` on its input.
type Offer = {
  id: string
  name: string
  about: string
  checked: boolean
  also?: Record<string, unknown>
}
let choice = (
  name: string,
  o: Offer,
  also: Record<string, unknown> = {},
  more = '',
) =>
  h(
    Check,
    null,
    h('input', {
      type: 'radio',
      name,
      value: o.id,
      ...also,
      checked: o.checked,
    }),
    h(
      'span',
      null,
      h('b', null, o.name),
      more,
      ' ',
      h('span', { class: 'Note Note-small' }, o.about),
    ),
  )

// A field of few to pick one from, its label over them.
let choices = (id: string, label: string, name: string, offers: Offer[]) =>
  h(
    Form.Field,
    { role: 'radiogroup', 'aria-labelledby': id },
    h(Form.Label, { id }, label),
    offers.map((o) => choice(name, o, o.also)),
  )

// The texts' terms, their addresses links to yaks.app's own pages.
let TERMS = /https:\/\/yaks\.app\/(terms|privacy)/g
let terms = (said: string) =>
  said.split(TERMS).map((part, i) =>
    i % 2 ? h('a', { href: `/${part}` }, `yaks.app/${part}`) : part
  )

// Where a person agrees to texts from the operator, or stops them, and finds
// the numbers to text and call it at. `from` is the number the Operator texts
// from (its phone's `transport().number`) and `call` the platform's number
// that answers calls (operator-calls.ts `rang`), both read from
// configuration, so the card names them with no call to the provider.
export let textsCard = (
  at: string,
  consent: Texting | null,
  from?: string,
  call?: string,
) =>
  setting(
    at,
    'texts',
    'Texts and calls',
    h(
      'p',
      null,
      'Text your Operator about anything, and it answers by text; call it, and it answers by voice. It also texts you its alerts, unless you choose another way for them above, and apps you build can text you reminders. You can still use chat and email.',
    ),
    from || call
      ? h(
        'p',
        null,
        from === call
          ? [h('a', { href: `sms:${from}` }, 'Text'), ' or call ']
          : from
          ? ['Text ', h('a', { href: `sms:${from}` }, shown(from))]
          : null,
        from && call && from !== call ? ' or call ' : !from ? 'Call ' : null,
        call ? h('a', { href: `tel:${call}` }, shown(call)) : null,
        consent
          ? ' to reach your Operator.'
          : ' from the mobile number you agree to texts at below to reach your Operator.',
      )
      : null,
    consent
      ? h(
        'p',
        null,
        'Texts go to ',
        h('b', null, shown(consent.number)),
        from
          ? ''
          : '; to text your Operator, reply to the number your welcome text came from',
        `. You agreed on ${
          new Date(consent.at).toLocaleDateString('en-US', {
            dateStyle: 'long',
            timeZone: 'UTC',
          })
        }. `,
        h(Button, { type: 'submit', name: 'stop', value: '1' }, 'Stop texts'),
      )
      : null,
    field(
      'texts-number',
      consent ? 'Change your mobile number' : 'Mobile number',
      h(Field, {
        id: 'texts-number',
        type: 'tel',
        name: 'number',
        autocomplete: 'tel',
        inputmode: 'tel',
        placeholder: '269-555-0142',
      }),
    ),
    h(
      Check,
      { style: 'align-items:flex-start' },
      h('input', { type: 'checkbox', name: 'agreed', value: 'yes' }),
      h('span', null, terms(CONSENT)),
    ),
    h('p', null, 'Agreeing is not required to use yaks.app.'),
  )

// Where a person chooses how their Operators tell them something away from
// the page (operator-alerts.ts): what they would be told by when they have
// not chosen is checked. Browser notifications are offered when yaks.app has
// a VAPID key (`key`, its public half), which the page's script subscribes
// this browser with before the choice is saved (`settingsScript`).
export let alertsCard = (
  at: string,
  chosen: Alerting | null,
  consent: Texting | null,
  email: string | null,
  browsers: Subscription[] = [],
  key: string | null = null,
) => {
  let route = routeOf(chosen, consent, email, browsers)
  let current = chosen ?? route?.by ?? 'updates'
  let n = browsers.length
  let offers: Omit<Offer, 'checked'>[] = [
    ...key
      ? [{
        id: 'push',
        name: 'Browser notification',
        about: n
          ? `on the ${
            n == 1 ? 'browser' : `${n} browsers`
          } you allowed; saving here allows this one too`
          : 'on this browser, once you allow it',
        also: { 'data-push': key, 'data-at': `${at}?push=1` },
      }]
      : [],
    {
      id: 'text',
      name: 'Text',
      about: consent
        ? `to ${shown(consent.number)}`
        : 'once you agree to texts below; until then, by email',
    },
    {
      id: 'email',
      name: 'Email',
      about: email
        ? `to ${email}`
        : 'once you give an address; until then, by text',
    },
    { id: 'updates', name: 'Only in Updates', about: 'nothing sent' },
  ]
  return setting(
    at,
    'alerts',
    'Alerts',
    h(
      'p',
      null,
      'How your Operator tells you something when you are not here: work you are waiting on finished, something needs you, or you asked to be told. It is always in your Updates too.',
    ),
    choices(
      'alerts-channel',
      'Tell me by',
      'channel',
      offers.map((o) => ({ ...o, checked: o.id == current })),
    ),
  )
}

// Where a space's people change what its Operator is called.
export let nameCard = (at: string, name: string) =>
  setting(
    at,
    'name',
    'Name',
    h(
      'p',
      null,
      'What this Operator goes by. It introduces itself by this name and signs its letters with it.',
    ),
    field(
      'operator-name',
      'Name',
      h(Field, {
        id: 'operator-name',
        name: 'name',
        value: name,
        maxlength: 40,
        required: true,
        autocomplete: 'off',
      }),
    ),
  )

// Where a space's people hear a few voices its Operator may speak in on a
// call, pick one, how fast it speaks, and how its calls are answered, each
// said in a line (speech.ts `offered`). Play speaks a sample at the speed
// picked (speech.ts `sampled`); a voice the chosen way cannot speak is
// greyed (`settingsScript`).
export let voiceCard = (
  at: string,
  space: Pick<Space, 'operator'>,
  { setup, voices, ways, paces, backends }: ReturnType<typeof offered>,
) =>
  setting(
    at,
    'voice',
    'Voice',
    h(
      'p',
      null,
      `How ${space.operator} sounds and answers when you call. Play a few voices, pick one, and save.`,
    ),
    h(
      'div',
      { class: 'Voices' },
      voices.map((v) =>
        h(
          'div',
          { class: 'Voices_Row' },
          choice(
            'voice',
            { ...v, checked: v.id == setup.voice },
            {
              'data-ways': ways.filter((w) => speaks(w.model, v.id))
                .map((w) => w.model).join(' '),
            },
            BUTLERS.includes(v.id) ? ' (like a butler)' : '',
          ),
          h(Button, {
            type: 'button',
            'data-sample': `${at}?sample=${v.id}`,
            'aria-label': `Play ${v.name}`,
          }, 'Play'),
        )
      ),
    ),
    choices(
      'voice-speed',
      'Speed',
      'voice_speed',
      paces.map((p) => ({ ...p, checked: p.id == setup.pace })),
    ),
    choices(
      'voice-answers',
      'Answers',
      'voice_model',
      ways.map((w) => ({
        id: w.model,
        name: w.name,
        about: w.about,
        checked: w.model == setup.model,
      })),
    ),
    choices(
      'voice-backend',
      'Hard requests',
      'voice_backend',
      backends.map((b) => ({ ...b, checked: b.id == setup.backend })),
    ),
  )
/** A request no session has taken yet, as its conversation draws it: what
 * was asked with the files sent with it, and what became of it in plain
 * words, never the error. */
export let conversation = (rows: Bundle[]) =>
  html(rows.map((row) => {
    let request = row.operator_request as Intake
    let doc = row.doc as { title?: string; body?: string }
    let answer = row.operator_answer as { text?: string } | undefined
    let failed = row.failed ?? row.bounced
    let files = request.files ?? []
    return h(
      'div',
      {
        class: 'Talk_Thread',
        'data-pending': answer || failed ? undefined : '',
      },
      h(
        'div',
        { class: 'Talk_Said' },
        h(
          'div',
          null,
          doc.body ? h('p', { class: 'Talk_You' }, doc.body) : null,
          attached(row.entity.eid, files),
        ),
        answer?.text ? reply(answer.text) : failed
          ? trouble(
            'Your request is kept, but the Operator could not finish it. Send it again to try once more.',
            failed,
          )
          : h(
            'p',
            { class: 'Talk_Note' },
            'Your request is saved. The Operator will start on it soon.',
          ),
        failed && answer
          ? trouble(
            'The answer could not be sent to you. It is kept here.',
            failed,
          )
          : null,
      ),
    )
  }))

// What the Operator's requests are answered: an attachment, a texts choice,
// a draft, Stop, a request sent, and its conversations read again. A plain
// read of its settings is none of these; it is the dashboard's to draw,
// around `operatorBody`.
export let operatorAnswer = async (
  req: globalThis.Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let url = new URL(req.url)
  let q = url.searchParams
  let at = managePath('operator', space.slug)
  // A conversation's address from before the chat app (`?open=`), sent on
  // to its page there.
  if (q.has('open') && (req.method == 'GET' || req.method == 'HEAD')) {
    return new Response(null, {
      status: 301,
      headers: {
        location: new URL(chatPath(space.slug, q.get('open')!), url).href,
      },
    })
  }
  if (q.has('attachment')) {
    let file = await operatorDoor(env, space, who, 'attachment', {
      id: q.get('attachment'),
      file: Number(q.get('file')),
    }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
      | File
      | null
    if (!file) {
      return new Response('That attachment is missing.', { status: 404 })
    }
    let kept = await env.BLOBS.get(file.key)
    if (!kept) throw new Error('Operator attachment is missing: ' + file.name)
    // A picture opens in place, as the conversation draws it; anything else
    // is saved. Neither is ever read as a page of yaks.app.
    let shows = PICTURES.includes(file.mime)
    return new Response(await kept.arrayBuffer(), {
      headers: {
        'content-type': shows ? file.mime : 'application/octet-stream',
        'content-disposition': `${
          shows ? 'inline' : 'attachment'
        }; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'",
        'cache-control': 'private, no-store',
      },
    })
  }
  if (q.has('texts') && req.method == 'POST') {
    let form = await req.formData()
    let person = who.person ?? ''
    let dir = directoryOf(env.STORE)
    try {
      let before = await dir.texting(person)
      await dir.apply({
        entities: texts(
          person,
          form.has('stop') ? '' : String(form.get('number') ?? ''),
          form.get('agreed') == 'yes',
          undefined,
          space.eid,
        ),
      }, vouched(who))
      let now = await dir.texting(person)
      // The welcome the campaign promises, once for each number agreed to.
      if (now && now.number != before?.number) {
        await tell(
          env,
          { to: now.number, text: REPLIES.welcome },
          'text welcome',
        )
      }
      return Response.json(now)
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  if (q.has('alerts') && req.method == 'POST') {
    let form = await req.formData()
    try {
      let person = who.person ?? ''
      await directoryOf(env.STORE).apply({
        entities: [alertsRow(person, String(form.get('channel') ?? ''))],
      }, vouched(who))
      return Response.json({
        channel: await directoryOf(env.STORE).alerts(person),
      })
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  // A browser the person allowed notifications on, as its
  // `pushManager.subscribe` gave it.
  if (q.has('push') && req.method == 'POST') {
    try {
      let person = who.person ?? ''
      let dir = directoryOf(env.STORE)
      await dir.apply({
        entities: [pushRow(person, await req.json().catch(() => null))],
      }, vouched(who))
      return Response.json({ browsers: (await dir.pushes(person)).length })
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  if (q.has('voice') && req.method == 'POST') {
    let form = await req.formData()
    try {
      let { id } = voiceOf(String(form.get('voice') ?? ''))
      let model = form.get('voice_model')
      let speed = form.get('voice_speed')
      let backend = form.get('voice_backend')
      let set = await directoryOf(env.STORE).operate(
        space,
        {
          voice: id,
          ...speed ? { voice_speed: paceOf(String(speed)).id } : {},
          ...model ? { voice_model: modelOf(String(model), id) } : {},
          ...backend ? { voice_backend: backendOf(String(backend)).id } : {},
        },
        vouched(who),
      )
      return Response.json({
        voice: set.voice,
        voice_speed: set.voice_speed,
        voice_model: set.voice_model,
        voice_backend: set.voice_backend,
      })
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  if (q.has('sample') && req.method == 'GET') {
    try {
      let pace = q.get('pace') ?? undefined
      return new Response(await sampled(env, space, q.get('sample')!, pace), {
        headers: {
          'content-type': 'audio/mpeg',
          'cache-control': 'private, max-age=86400',
        },
      })
    } catch (e) {
      if (e instanceof CallError) {
        return Response.json({ message: e.message }, { status: 400 })
      }
      if (e instanceof ModelError) {
        return Response.json({ message: e.message }, {
          status: e.code == 'limit' ? 402 : 503,
        })
      }
      throw e
    }
  }
  // Speech for a browser that has none of its own (public/voice.js): what
  // the person said, heard, and the Operator's line, said in its own voice
  // and pace. Each is charged to the space's one budget (speech.ts).
  if ((q.has('hear') || q.has('speak')) && req.method == 'POST') {
    try {
      if (q.has('hear')) {
        let type = req.headers.get('content-type') ?? ''
        if (!type.startsWith('audio/') || !req.body) {
          throw refuse('arguments', 'Send what was said as audio.')
        }
        let audio = await gathered(
          req.body,
          HEARD,
          () => refuse('arguments', 'Talk for up to a minute at a time.'),
        )
        if (!audio.length) return Response.json({ text: '' })
        let got = await hearing(env, space, audio, type)
        return Response.json({ text: got.text })
      }
      let asked = await req.json().catch(() => null) as { text?: unknown }
      let text = String(asked?.text ?? '').trim()
      if (!text || text.length > SAID) {
        throw refuse('arguments', `Send up to ${SAID} characters to say.`)
      }
      let { voice, provider, speed } = setupOf(env, space)
      let said = await speaking(env, space, text, { voice, provider, speed })
      return new Response(said.body, {
        headers: { 'content-type': said.type, 'cache-control': 'no-store' },
      })
    } catch (e) {
      if (e instanceof CallError) {
        return Response.json({ message: e.message }, { status: 400 })
      }
      if (e instanceof ModelError) {
        return Response.json({ message: e.message }, {
          status: e.code == 'limit' ? 402 : 503,
        })
      }
      throw e
    }
  }
  if (q.has('name') && req.method == 'POST') {
    let form = await req.formData()
    try {
      let named = await directoryOf(env.STORE).operate(
        space,
        { name: given(String(form.get('name') ?? '')) },
        vouched(who),
      )
      return Response.json({ name: named.operator })
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  if (q.has('draft')) {
    return Response.json(
      await operatorDoor(
        env,
        space,
        who,
        'draft',
        req.method == 'POST' ? await req.json() : {},
      ),
      { headers: { 'cache-control': 'private, no-store' } },
    )
  }
  if (q.has('stop') && req.method == 'POST') {
    let { task } = await req.json() as { task?: string }
    return Response.json(
      await operatorDoor(env, space, who, 'stop', { task }),
    )
  }
  if (req.method == 'POST') {
    let form = new FormData()
    let files = []
    for await (let part of parts(req)) {
      if (part.filename && files.length == COUNT) {
        throw refuse('arguments', `Send up to ${COUNT} files at a time.`)
      }
      let bytes = await gathered(
        part.body,
        part.filename ? 16 * 1024 * 1024 : 1024 * 1024,
        () =>
          refuse(
            'arguments',
            'Operator attachments support files up to 16 MiB.',
          ),
      )
      if (part.name == 'file' && part.filename && bytes.length) {
        files.push(
          await keepFile(
            env,
            space,
            part.filename,
            part.type || 'application/octet-stream',
            bytes,
          ),
        )
      } else if (!part.filename) {
        form.set(part.name, new TextDecoder().decode(bytes))
      }
    }
    let request = String(form.get('request') || crypto.randomUUID())
    // The app open beside the chat, which the words are about, and the page
    // of yaks.app they were written on, which its box names (`composer`).
    let app = String(form.get('app') ?? '')
    let drawn = String(form.get('page') ?? '')
    let page = new URL(
      drawn.startsWith(MANAGE + '/') ? drawn : chatPath(space.slug),
      url,
    )
    // Whichever page it is sent from, it goes to the person's conversation.
    let received = await operatorDoor(env, space, who, 'receive', {
      say: String(form.get('say') ?? ''),
      request: {
        channel: 'chat',
        files,
        page: page.href,
        ...SLUG.test(app) ? { app } : {},
      },
      options: { id: request },
      ...(form.has('draft')
        ? { draft: JSON.parse(String(form.get('draft'))) }
        : {}),
    })
    if (form.has('draft')) return Response.json(received)
    return new Response(null, {
      status: 303,
      headers: { location: chatPath(space.slug, request) },
    })
  }
  if (q.has('live')) {
    if (!upgrading(req)) {
      return new Response("This is the Operator page's WebSocket.", {
        status: 426,
      })
    }
    // The conversation the page shows, for its socket to say where it
    // stands, and whether it draws its lines from data.
    let on = new URLSearchParams()
    if (q.get('talk')) on.set('talk', q.get('talk')!)
    if (q.has('lines')) on.set('lines', '1')
    return socketTo(
      env,
      space,
      req,
      who,
      '/operator/ws' + (on.size ? '?' + on : ''),
    )
  }
  // A browser lent to the Operator (operator-browser.ts), signed in by the
  // token it bears (apps.ts `manage`).
  if (q.has('browser')) {
    if (!upgrading(req)) {
      return new Response("This is the Operator's browser WebSocket.", {
        status: 426,
      })
    }
    return socketTo(env, space, req, who, '/operator/browser')
  }
  // One conversation read again.
  if (q.has('talk')) {
    let open = q.get('talk')!
    let talked = await conversationOf(
      env,
      space,
      who,
      at,
      open,
      false,
      undefined,
      q.has('lines'),
    )
    if (!talked.title) {
      return Response.json({ message: 'That conversation is missing.' }, {
        status: 404,
      })
    }
    return Response.json({
      title: talked.title,
      task: talked.task,
      html: talked.html,
      ...talked.lines ? { lines: talked.lines, now: talked.now } : {},
      making: ours(space, talked.making),
      started: !!talked.making?.started,
      standing: talked.standing,
    }, { headers: { 'cache-control': 'private, no-store' } })
  }
  // An app beside the chat drawn again as the Operator works on it, and the
  // bar's way to it on a phone, for a page that has none yet.
  if (q.has('made') && req.method == 'GET') {
    let making = await makingOf(env, space, who, q.get('made')!)
    if (!making) {
      return Response.json({ message: 'That app is missing.' }, {
        status: 404,
      })
    }
    return Response.json({
      canvas: html(canvas(env, space, making, space.operator)),
      show: html(showing(making)),
    }, { headers: { 'cache-control': 'private, no-store' } })
  }
}

// A socket, carried to the Builder object with the kernel's vouch on it and
// nothing of the client's (build.ts `joining`, the same way): no header of
// ours, and of its subprotocols only the platform's, never the token it bore.
let socketTo = (
  env: Env,
  space: Space,
  req: globalThis.Request,
  who: Who,
  path: string,
) =>
  builderOf(env, space.eid)(() => {
    let out = new Request(`https://builder${path}`, req)
    for (let [h] of [...out.headers]) {
      if (h.startsWith('x-yak-')) out.headers.delete(h)
    }
    out.headers.delete('authorization')
    if (protocolled(req)) out.headers.set('sec-websocket-protocol', PROTOCOL)
    else out.headers.delete('sec-websocket-protocol')
    out.headers.set(SPACE, space.eid)
    for (let [h, v] of Object.entries(vouched(who))) out.headers.set(h, v)
    return out
  })

/** One conversation, opened by its task or a request: its sessions as they
 * ran (operator-view.ts `talk`), or the request alone while no session has
 * taken it. `everyone` reads any person's, for the platform's admin, each
 * titled by whose it is, and `opens` is where its helpers' conversations
 * open, by their id: the chat app's unless the admin's. */
export let conversationOf = async (
  env: Env,
  space: Space,
  who: Who,
  at: string,
  open: string,
  everyone = false,
  opens?: string,
  drawing = false,
) => {
  let none = {
    root: '',
    task: '',
    begun: '',
    title: '',
    html: '',
    lines: null,
    now: '',
    making: null,
    standing: '',
  }
  if (open == 'new') return none
  let {
    root,
    task,
    begun,
    title,
    html,
    lines = null,
    now = '',
    waiting,
    making,
    standing,
  } = await operatorDoor(
    env,
    space,
    who,
    'conversation',
    {
      at,
      open,
      ...everyone ? { everyone } : {},
      ...opens ? { opens } : {},
      ...drawing ? { lines: true } : {},
    },
  ).catch((e) => {
    if (e.status != 404) throw e
    return { ...none, waiting: [] }
  }) as {
    root: string
    task: string
    begun: string
    title: string
    html: string
    lines?: Lines | null
    now?: string
    waiting: Bundle[]
    making: Underway | null
    standing: string
  }
  return {
    root,
    task,
    begun,
    title,
    html: html + conversation(waiting),
    lines,
    now,
    making,
    standing,
  }
}

// The Operator's settings, which the dashboard draws beside its side like
// every other page (pages.ts `desk`): what it does and where, a link to its
// conversations in the chat app (`chatPage`), and the texts it may send.
export let operatorBody = async (env: Env, space: Space, who: Who) => {
  let at = managePath('operator', space.slug)
  let dir = directoryOf(env.STORE)
  let [consent, { pa, beyond }, phone, platform, chosen, email, browsers] =
    await Promise
      .all([
        dir.texting(who.person ?? ''),
        reachOf(dir, walkTo(space.slug, space.eid), who.person ?? ''),
        phoneAt(env, space.sender),
        phoneAt(env),
        dir.alerts(who.person ?? ''),
        dir.emailAt(who.person ?? ''),
        dir.pushes(who.person ?? ''),
      ])
  let from = phone?.transport().number
  let call = platform?.caller ? platform.transport().number : undefined
  let address = mailFrom(space.slug, null, env)
  let operator = space.operator
  return html([
    h(
      Card,
      null,
      h(
        'p',
        null,
        `${operator} is this space’s Operator. Ask ${operator} for a change in your apps, or send a PDF or a photo. Your space's plan covers its work.`,
      ),
      pa
        ? h(
          'p',
          null,
          'This is your own space, so its Operator can also work in your other spaces, with your role in each.',
        )
        : null,
      elsewhere(beyond, pa),
      h(
        'p',
        null,
        `You can also email ${operator} from any mail app: write to `,
        h('a', { href: `mailto:${address}` }, address),
        ` with what you want changed, and attach a PDF or a photo if you have one. Send it from the email address you sign in with; ${operator} answers by email.`,
      ),
    ),
    talks(space.slug),
    nameCard(at, operator),
    voiceCard(at, space, offered(env, space)),
    alertsCard(at, chosen, consent, email, browsers, pushKey(env)),
    textsCard(at, consent, from, call),
  ]) + settingsScript
}

// Where else the Operator works and what it may do there, one sentence for
// all of it: the spaces it changes things in, then those it only looks at.
// Each space's owner sets that on its People page (pages.ts `operating`); on
// a person's own space it follows their role in each.
export let elsewhere = (beyond: Reach[], pa: boolean) => {
  if (!beyond.length) return null
  let named = (rs: Reach[]) =>
    rs.length
      ? LIST.formatToParts(rs.map((_, i) => String(i))).map((part) => {
        let { space } = rs[Number(part.value)] ?? {}
        return part.type == 'element' && space
          ? h('a', { href: chatPath(space.slug) }, space.title || space.slug)
          : part.value
      })
      : null
  let changes = named(beyond.filter((r) => r.role != 'viewer'))
  let looks = named(beyond.filter((r) => r.role == 'viewer'))
  return h(
    'p',
    null,
    ...changes && looks
      ? [
        'It can also change things in ',
        changes,
        ', and look at ',
        looks,
        ' without changing anything.',
      ]
      : changes
      ? ['It can also work in ', changes, ', and change things there.']
      : ['It can also look at ', looks, ', but not change anything there.'],
    pa ? null : ' Each space’s owner chooses this on its People page.',
  )
}

let LIST = new Intl.ListFormat('en', { type: 'conjunction' })

// The public half of yaks.app's VAPID key, which a browser subscribes with,
// or null when browser notifications are not switched on.
let pushKey = (env: Env) => {
  let vapid = vapidOf(env)
  return vapid ? publicKey(vapid.key) : null
}

// The settings page's script: the name, the voice, the alerts and the texts
// choice, and each voice's sample played in place of whichever was playing.
// Choosing browser notifications first allows them on this browser: it
// registers the service worker that shows them (public/push.js), subscribes
// with yaks.app's VAPID key and keeps the subscription (\`?push\`).
let settingsScript = `<script type="module">
let playing = new Audio()
for (let play of document.querySelectorAll('[data-sample]')) {
  play.addEventListener('click', async () => {
    let said = document.querySelector('#voice [data-status]')
    said.textContent = ''
    play.disabled = true
    try {
      let pace = document.querySelector('#voice [name=voice_speed]:checked')?.value
      let response = await fetch(play.dataset.sample + (pace ? '&pace=' + pace : ''))
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'That voice could not be played. Try again.')
      URL.revokeObjectURL(playing.src)
      playing.src = URL.createObjectURL(await response.blob())
      await playing.play()
    } catch (error) { said.textContent = error.message }
    play.disabled = false
  })
}
let voice = document.querySelector('#voice')
let fit = () => {
  let way = voice?.querySelector('[name=voice_model]:checked')?.value
  for (let v of voice?.querySelectorAll('[name=voice]') ?? []) {
    v.disabled = !!way && !v.dataset.ways.split(' ').includes(way)
  }
  let picked = voice?.querySelector('[name=voice]:checked')
  if (picked?.disabled) voice.querySelector('[name=voice]:not(:disabled)').checked = true
}
voice?.addEventListener('change', fit)
fit()
let allow = async (offer) => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser cannot show notifications. Choose another way.')
  if (await Notification.requestPermission() != 'granted') throw new Error('Notifications are blocked for yaks.app in this browser. Allow them in its settings, then save again.')
  let worker = await navigator.serviceWorker.register('/push.js')
  await navigator.serviceWorker.ready
  let key = Uint8Array.from(atob(offer.dataset.push.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))
  let sub = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  let response = await fetch(offer.dataset.at, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) })
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message ?? 'This browser could not be allowed. Try again.')
}
for (let form of document.querySelectorAll('#texts, #name, #voice, #alerts')) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    let said = form.querySelector('[data-status]')
    let body = new FormData(form)
    if (e.submitter?.name == 'stop') body.set('stop', '1')
    said.textContent = 'Saving…'
    try {
      let offer = form.querySelector('[name=channel][value=push]:checked')
      if (offer) await allow(offer)
      let response = await fetch(form.action, { method: 'POST', body })
      let answer = await response.json().catch(() => null)
      if (!response.ok) throw new Error(answer?.message ?? 'Your choice could not be saved. Try again.')
      location.reload()
    } catch (error) { said.textContent = error.message }
  })
}
</script>`

/** What the chat app's side holds beside every page of it, read by its door
 * (apps.ts `beside`): every space the person may open (its selector), the
 * apps of this one they may open, what they are called, and whether they are
 * the platform's admin (tool.ts `admin`). */
export type Beside = {
  spaces?: Picked[]
  apps?: { eid: string; slug: string; title: string }[]
  name?: string | null
  admin?: boolean
}

// How many of the space's apps the side shows before "All N apps".
let APPS = 4

// The chat app's side, the product's whole menu (T-140506): whose Operator
// it is, in the space selector; the Operator by name, which opens the
// person's one conversation with it (T-141349); Updates from the Operator,
// with how many wait on the person; the space's apps; and at the foot Manage,
// the settings behind the product (today's dashboard pages: its Apps for the
// space's owner, the Operator's settings for a member, the only one of them
// they may open), where older chats are listed, and for the platform's admin
// Admin, its directory (admin.ts). `current` holds what this
// page shows: a conversation, `updates`, and `app` the app open beside it.
// Each app opens beside the conversation on screen, or else the person's one
// conversation, so their words stay where they were (T-140509, T-141273).
// Between the top and Manage the side scrolls on its own, so a long list
// never runs under Manage (T-141332), and its current item is the settings'
// tab (`SideNav`, T-141334). On a phone the bar's Menu opens the side over
// the page (`:target`, no script).
let side = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  at: { current: string[]; waiting: number; app?: string },
) => {
  let owner = who.role == 'owner'
  let here = beside.spaces?.find((s) => s.slug == space.slug) ?? {
    slug: space.slug,
    title: space.title,
    owner,
    own: false,
    operator: space.operator,
    logo: logoPath(space),
  }
  let spaces = beside.spaces ?? []
  let apps = beside.apps ?? []
  let host = `https://${spaceHost(env, space.slug)}`
  let operator = space.operator
  let open = at.current.find((c) => c && c != 'updates') ?? 'new'
  return h(
    'aside',
    { class: 'Talk_Side', id: 'menu', 'aria-label': 'Menu' },
    h(
      'div',
      { class: 'Talk_Top' },
      h(
        'a',
        { class: 'Talk_Brand', href: chatPath(space.slug) },
        h(Idle, { base: url(env), size: 36 }),
        'yaks.app',
      ),
      h(Button, { href: '#', class: 'Talk_Close' }, '✕ Close'),
    ),
    h(
      'div',
      { class: 'Talk_Scroll' },
      // The space selector is the dashboard's own (pages.ts).
      h(
        'div',
        { class: 'Talk_Whose' },
        spaceChoice(
          here,
          spaces.some((s) => s.slug == space.slug) ? spaces : [here, ...spaces],
          (s) => chatPath(s.slug),
          null,
          (s) => s.operator ?? '',
        ),
      ),
      h(
        SideNav,
        { 'aria-label': operator },
        link(
          chatPath(space.slug),
          !at.app && !at.current.includes('updates'),
          h(Icon, { of: icons['message-circle'] }),
          operator,
        ),
        link(
          managePath('updates', space.slug),
          at.current.includes('updates'),
          h(Icon, { of: icons.bell }),
          `Updates from ${operator}`,
          at.waiting ? h('span', { class: 'Talk_Count' }, at.waiting) : null,
        ),
      ),
      h('h2', { class: 'Talk_Group', id: 'side-apps' }, 'Your apps'),
      apps.length
        ? h(
          SideNav,
          { 'aria-labelledby': 'side-apps' },
          apps.slice(0, APPS).map((a) =>
            link(
              aboutPath(space.slug, a.slug, open),
              a.slug == at.app,
              h('img', {
                class: 'Talk_Icon',
                src: `${host}/${a.slug}/icon.png`,
                width: 24,
                height: 24,
                alt: '',
                loading: 'lazy',
              }),
              a.title || a.slug,
            )
          ),
          owner && apps.length > APPS
            ? h(
              SideNav.Link,
              { href: managePath('apps', space.slug), class: 'Talk_All' },
              `All ${apps.length} apps`,
            )
            : null,
        )
        : h(
          'p',
          { class: 'Talk_None' },
          `None yet. Ask ${operator} to make one.`,
        ),
    ),
    h(
      SideNav,
      { class: 'Talk_Foot', 'aria-label': 'Settings' },
      link(
        managePath(owner ? 'apps' : 'operator', space.slug),
        false,
        h(Icon, { of: icons['sliders-horizontal'] }),
        'Manage',
      ),
      beside.admin
        ? link(ADMIN, false, h(Icon, { of: icons.shield }), 'Admin')
        : null,
    ),
  )
}

// A link of the side, the page on screen lit and said to be current.
let link = (href: string, on: boolean, ...face: Node[]) =>
  h(
    SideNav.Link,
    { href, mod: on && 'on', 'aria-current': on ? 'page' : undefined },
    ...face,
  )

/** A conversation, or a new chat, with one of the space's apps beside it. */
export let aboutPath = (space: string, app: string, open = 'new') =>
  `${chatPath(space, open)}?app=${encodeURIComponent(app)}`

/** An app as the chat shows it. */
type Shown = { slug: string; title: string }

/** An app beside the chat as it is being made: what it is made of, and
 * where its screens are, if anywhere yet: the app itself once released, and
 * its draft's preview link (preview.ts), which follows the draft write by
 * write (public/release.js), while the draft holds a page that is not live:
 * before the first release, and while changes wait for the next. */
type Making = Shown & {
  made: Made
  pages: Page[]
  live: string | null
  draft: string | null
}

// An app beside the chat as the person may see it, with the tools' own
// access (tool.ts `inApp`), from its draft as it stands (written.ts
// `drafting`); null for one they may not open, or one gone.
let makingOf = async (
  env: Env,
  space: Space,
  who: Who,
  slug: string,
): Promise<Making | null> => {
  let ctx = { env, dir: directoryOf(env.STORE), person: who.person ?? '' }
  let found = await inApp(ctx, { space: space.slug, app: slug }, true)
    .catch((e) => e instanceof CallError ? null : Promise.reject(e))
  if (!found) return null
  let { app } = found
  let draft = await drafting(r2RawObjects(env.BLOBS), ctx.dir, app)
  let file = VOCABS.find((p) => p in draft.files)
  let words = file ? await draft.view.read(`${draft.root}/${file}`) : null
  let decoded = (bytes: Uint8Array | null) =>
    bytes ? new TextDecoder().decode(bytes) : ''
  let pages = pagesOf(
    await Promise.all(
      Object.keys(draft.files).filter((p) => p.endsWith('.html')).map(
        async (p) =>
          [p, decoded(await draft.view.read(`${draft.root}/${p}`))] as [
            string,
            string,
          ],
      ),
    ),
  )
  let pending = !!pages.length && draft.unreleased && !!env.SESSION_SECRET
  return {
    slug: app.slug,
    title: app.title || app.slug,
    made: madeOf(words && decoded(words), file),
    pages,
    live: app.source
      ? `https://${spaceHost(env, space.slug)}/${app.slug}/`
      : null,
    draft: pending ? (await linkOf(ctx, space, app, found.who)).at : null,
  }
}

// Which of the canvas's tabs opens: the newest stage of making it reached,
// screens once there are any.
let stageOf = ({ made, live, draft }: Making) =>
  live || draft
    ? 'screens'
    : !made.kinds.length && made.acts.length
    ? 'does'
    : 'keeps'

// Its screens: the draft while it differs from what is live, and the app
// itself once released, each in a frame, the one on screen said. While both
// are there a pair of radios switches them (pages.css shows the frame of the
// checked one, and the other loads once shown), the draft first, since it
// is what is changing.
let screens = (app: Making, operator: string) => {
  let { live, draft } = app
  let frame = (which: 'draft' | 'live', at: string) =>
    h('iframe', {
      class: 'Talk_Frame',
      src: at,
      title: `${app.title}, ${which == 'draft' ? 'the draft' : 'live'}`,
      name: `screen-${which}`,
      'data-frame': which,
      'data-screen': which,
      ...which == 'live' && draft ? { loading: 'lazy' } : {},
    })
  let note = (which: string, said: string) =>
    h('p', { class: 'Talk_MadeNote', 'data-screen': which }, said)
  if (!live && !draft) {
    return h(
      Empty,
      null,
      h(
        'p',
        null,
        `${app.title}’s screens show here as ${operator} draws them.`,
      ),
    )
  }
  if (!live) {
    return [
      note(
        'draft',
        `A draft with its own test data, changing as ${operator} works on it.`,
      ),
      frame('draft', draft!),
    ]
  }
  if (!draft) return frame('live', live)
  let pick = (which: string, word: string) =>
    h(
      Check,
      null,
      h('input', {
        type: 'radio',
        name: 'screen',
        value: which,
        checked: which == 'draft',
      }),
      word,
    )
  return [
    h(
      'div',
      {
        class: 'Talk_Screens',
        role: 'radiogroup',
        'aria-label': 'Which screens',
      },
      pick('draft', 'Draft'),
      pick('live', 'Live'),
    ),
    note(
      'draft',
      `${operator}’s changes, not live yet, with the draft’s own test data.`,
    ),
    note(
      'live',
      `What people see now. The draft’s changes show here once released.`,
    ),
    frame('draft', draft),
    frame('live', live),
  ]
}

// The app open beside the chat (T-140509), and the one the Operator is
// making in it (D-146737, `following`): its icon, its name and where it
// lives, a way to open it in a tab of its own, and under them what it is
// made of, a tab each, in the order it is made: the kinds of things it
// keeps, what it can do, and its screens, the newest stage open. Its screens
// are the app itself, live, which the page reloads when the Operator changes
// it, or before it is released its draft, which follows each write
// (`chatScript`). The app's host lets the platform frame it (cache.ts
// `sealed`). On a phone it takes the screen in the chat's place while chosen
// (`#app`), and Chat goes back. Each part the page puts in place again as
// the Operator works is named by `data-part`.
let canvas = (env: Env, space: Space, app: Making, operator: string) => {
  let host = `${spaceHost(env, space.slug)}/${app.slug}`
  let title = app.title || app.slug
  let whose = { app: title, operator }
  let stage = stageOf(app)
  // Where Open takes it: the app itself, else its draft.
  let away = app.live ?? app.draft
  let tab = (id: string, name: string, ...inside: Node[]) =>
    h(
      TabSet.Item,
      null,
      h('input', {
        type: 'radio',
        name: 'made',
        id: `made-${id}`,
        value: id,
        checked: id == stage,
      }),
      h(TabSet.Tab, { for: `made-${id}` }, name),
      h(
        TabSet.Panel,
        { as: Card, class: `Talk_Part Talk_Part-${id}`, 'data-part': id },
        h('div', { class: 'Talk_Sheet' }, ...inside),
      ),
    )
  return h(
    'section',
    {
      class: 'Talk_App',
      id: 'app',
      'aria-label': title,
      'data-app': app.slug,
      'data-stage': stage,
    },
    h(
      'header',
      { class: 'Talk_AppHead', 'data-part': 'head' },
      h(Button, { href: '#', class: 'Talk_Back' }, '← Chat'),
      h('img', {
        class: 'Talk_Icon',
        src: `https://${host}/icon.png`,
        width: 24,
        height: 24,
        alt: '',
      }),
      h(
        'span',
        { class: 'Talk_AppName' },
        h('b', null, title),
        h('small', null, host),
      ),
      away
        ? h(
          Button,
          { href: away, target: '_blank', rel: 'noopener' },
          h(Icon, { of: icons['external-link'] }),
          'Open',
        )
        : null,
    ),
    h(
      'div',
      { class: 'Talk_Stage' },
      h(
        TabSet,
        { class: 'Talk_Made', 'aria-label': `What ${title} is made of` },
        tab('keeps', 'What it keeps', keeps(app.made, whose)),
        tab(
          'does',
          'What it can do',
          does(
            app.made,
            whose,
            !!app.live,
            app.pages,
            app.draft
              ? { frame: 'draft', at: app.draft }
              : app.live
              ? { frame: 'live', at: app.live }
              : null,
          ),
        ),
        tab('screens', 'Screens', screens(app, operator)),
      ),
    ),
  )
}

/** Which apps open beside the chat by themselves, with none chosen, as the
 * Operator works (D-146737): for a newcomer any it works on, since their
 * space holds only what it builds them; for anyone else one it started in
 * this conversation (app_new), never one that was there before, which opens
 * only when they choose it (T-140509). Each is a frame's list of them
 * (operator-view.ts `frame`). */
type Follows = 'worked' | 'started' | null
let following = (newcomer: boolean, chosen?: string | null): Follows =>
  chosen ? null : newcomer ? 'worked' : 'started'
// Whether the app a conversation is making opens beside it.
let opens = (follows: Follows, made: Underway | null) =>
  !!made && (follows == 'worked' || follows == 'started' && made.started)

// The app a step worked on, when it is this space's.
let ours = (space: Space, worked: Changed | null) =>
  worked && (!worked.space || worked.space == space.slug) ? worked.app : null

// The bar's way to the app on a phone, named for it in one line, cut short
// where the bar is narrow (pages.css).
let showing = (app: Shown) =>
  h(
    Button,
    { href: '#app', class: 'Talk_Show' },
    h('span', { class: 'Talk_ShowName' }, app.title || app.slug),
  )

// The Operator page installs to a home screen as a web app (D-136811): each
// space's own manifest (`installing`), named for its Operator and opening its
// chat, and the tags a phone reads beside it. The icon is the Operator's own
// tile, the connector's, which is opaque, so iOS paints no black behind it.
// The window wears the page's ground, light or dark (@yaks/ui's linen theme,
// `--bg`), so the status bar reads as part of the page. Its
// scope is the whole origin, so signing in stays in the window.
let ICON = '/connector-512.png'
let NIGHT = '#2b231f'
let whoseOf = (space: Space) =>
  `${space.operator}, ${space.title || space.slug}’s Operator`
let installable = (space: Space) =>
  html([
    h('link', {
      rel: 'manifest',
      href: manifestPath(space.slug),
      crossorigin: 'use-credentials',
    }),
    h('link', { rel: 'apple-touch-icon', href: ICON }),
    h('meta', {
      name: 'theme-color',
      content: PLATFORM_BACKGROUND,
      media: '(prefers-color-scheme: light)',
    }),
    h('meta', {
      name: 'theme-color',
      content: NIGHT,
      media: '(prefers-color-scheme: dark)',
    }),
    h('meta', { name: 'mobile-web-app-capable', content: 'yes' }),
    h('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
    h('meta', {
      name: 'apple-mobile-web-app-status-bar-style',
      content: 'default',
    }),
    h('meta', { name: 'apple-mobile-web-app-title', content: space.operator }),
  ])

/** A space's Operator page as a web app: what a phone installs from, and the
 * space's brand a white-labelled shell wears (native/brand.ts): its name, its
 * Operator's, and its logo as the icon where it has one. */
export let installing = (space: Space) => {
  let at = chatPath(space.slug)
  return Response.json({
    id: at,
    name: whoseOf(space),
    short_name: space.operator,
    start_url: at,
    scope: '/',
    display: 'standalone',
    background_color: PLATFORM_BACKGROUND,
    theme_color: PLATFORM_BACKGROUND,
    icons: [
      space.logo
        ? { src: logoPath(space), type: space.logo.type }
        : { src: ICON, type: 'image/png', sizes: '512x512' },
    ],
  }, {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'private, no-cache',
    },
  })
}

// A page of the chat app: the side, and beside it the bar naming the page
// and whose Operator it is, over `main`, and the app open beside them.
let talkPage = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  page: {
    title: string
    status: number
    // how many Updates wait on the person (updates.ts `updatesOf`)
    waiting: number
    current: string[]
    main: Node
    // the main's own modifier, beside `Talk_Main`
    kind?: string
    // where the skip link goes, and what it says
    skip: [string, string]
    script?: string
    app?: Making
  },
) =>
  shell(
    env,
    `${esc(page.title)} · ${esc(space.operator)}`,
    null,
    page.status,
    html([
      h('a', { class: 'Desk_Skip', href: page.skip[0] }, page.skip[1]),
      h(
        'div',
        { class: page.app ? 'Talk Talk-app' : 'Talk' },
        side(env, space, who, beside, {
          waiting: page.waiting,
          current: page.current,
          app: page.app?.slug,
        }),
        h(
          'div',
          {
            class: page.kind ? `Talk_Main ${page.kind}` : 'Talk_Main',
            id: 'content',
          },
          h(
            'header',
            { class: 'Talk_Bar' },
            h(Button, {
              href: '#menu',
              class: 'Talk_Menu',
              'aria-label': 'Menu',
            }, '☰'),
            h(
              'div',
              { class: 'Talk_Heads' },
              h('h1', { class: 'Talk_Head', 'data-title': '' }, page.title),
              h('p', { class: 'Talk_Who' }, whoseOf(space)),
            ),
            page.app ? showing(page.app) : null,
          ),
          page.main,
        ),
        page.app ? canvas(env, space, page.app, space.operator) : null,
      ),
    ]) + (page.script ?? ''),
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    'Talk_Page',
    installable(space),
  )

// What a new chat offers to start with, each a few words the box is filled
// with for the person to finish: an app made, one of theirs changed, a
// problem, and what the Operator can do.
let starts = (operator: string, apps: Beside['apps'] = []) =>
  [
    ['Make a new app', 'Make me an app for '],
    ...apps.slice(0, 1).map((a) => [
      `Change ${a.title || a.slug}`,
      `In ${a.title || a.slug}, `,
    ]),
    ['Something isn’t working', 'Something isn’t working: '],
    [`What can ${operator} do?`, 'What can you do for me?'],
  ].map(([label, say]) => h(Button, { type: 'button', 'data-say': say }, label))

// What a chat says before anything is in it: what it is for, in a heading
// and a line.
/** A conversation as its pages draw it, the chat app and the admin's: the
 * Builder object's drawing (`conversationOf`), or `empty` in its place. */
export let column = (html: string, empty: Node = null) =>
  h('div', {
    class: 'Talk_Column',
    'data-conversation': '',
    'aria-live': 'polite',
    ...html ? { dangerouslySetInnerHTML: { __html: html } } : {},
  }, html ? undefined : empty)

let hello = (heading: string, said: string) =>
  h('div', { class: 'Talk_Hello' }, h('h2', null, heading), h('p', null, said))

/**
 * One conversation with the Operator in its chat app, a page of its own
 * (route.ts `chatPath`): the product's side (`side`) with the person's chats
 * in it, newest first; the conversation filling the page, what it is doing
 * now under it; and the box to write in at the foot, with Stop while it
 * works. `open` is a task, a request no task has taken yet, or `new`, which
 * greets the person by name, holds over the box what needs them
 * (`data-needs`, T-140508), and under it a few ways to start.
 *
 * Beside it, the app the address names (`chosen`, the side's `aboutPath`),
 * of those the person may open, and no other. With none named, the app the
 * conversation is making opens there by itself (`following`). A new chat
 * about an app asks what should change in it, and the words sent say which
 * page and app are open (operator-view.ts `onPage`).
 */
export let chatPage = async (
  env: Env,
  space: Space,
  who: Who,
  open: string,
  beside: Beside = {},
  chosen?: string | null,
) => {
  let at = managePath('operator', space.slug)
  // The space's address opens the person's one conversation, and a new chat
  // only until they have one (T-141349).
  let [talked, news, newcomer] = await Promise.all([
    conversationOf(env, space, who, at, open == 'new' ? '' : open),
    updatesOf(env, space, who),
    who.person ? directoryOf(env.STORE).newcomer(who.person) : false,
  ])
  // Their one conversation, as the store names it: what an empty `open` asks
  // for (operator-host.ts `/operator/conversation`).
  let root = talked.root
  if (open == 'new' && talked.title) open = root
  let fresh = open == 'new'
  let first = beside.name?.trim().split(/\s+/)[0]
  let follows = following(!!newcomer, chosen)
  let made = opens(follows, talked.making) ? ours(space, talked.making) : null
  let named = beside.apps?.find((a) => a.slug == (chosen ?? made))
  let app = named && await makingOf(env, space, who, named.slug) || undefined
  // This page's address, which the words written on it name.
  let shown = open == root ? 'new' : open
  let here = app
    ? aboutPath(space.slug, app.slug, shown)
    : chatPath(space.slug, shown)
  let operator = space.operator
  let greeting = !fresh
    ? hello(
      'This chat is not here',
      `It may have been removed. Your older chats are listed in Manage, with ${operator}’s settings.`,
    )
    : app
    ? hello(
      `What should change in ${app.title || app.slug}?`,
      `Tell ${operator}, and watch it change beside this chat.`,
    )
    : hello(
      `What can I do for you${first ? `, ${first}` : ''}?`,
      `Ask ${operator} to make an app, change one, or find something out. You can send a photo or a document too.`,
    )
  // The person's one conversation, or a new chat until they have one, with
  // no app beside it is where they land: what needs them waits over the box,
  // and a new chat offers ways to start.
  let landing = (fresh || open == root) && !app
  let needs = landing ? needing(news) : undefined
  return talkPage(env, space, who, beside, {
    title: fresh
      ? app ? app.title || app.slug : `Message ${operator}`
      : talked.title || 'Not here',
    status: fresh || talked.title ? 200 : 404,
    waiting: news.waiting,
    current: [open, talked.task],
    kind: fresh ? 'Talk_Main-new' : '',
    skip: fresh || talked.title
      ? ['#ask', 'Skip to the message box']
      : ['#content', 'Skip to content'],
    main: [
      // The conversation is drawn by the Builder object (operator-view.ts
      // `talk`), and what needs the person by Updates (updates.ts).
      newcomer ? keepCard(here) : null,
      talked.html ? column(talked.html) : column('', greeting),
      landing
        ? h(
          'div',
          { class: 'Talk_Needs', 'data-needs': '' },
          needs
            ? needsCard(
              space,
              needs,
              h(
                'p',
                null,
                h(
                  'a',
                  {
                    href: `${managePath('updates', space.slug)}#u-${needs.eid}`,
                  },
                  `Ask ${operator} about it`,
                ),
              ),
            )
            : null,
        )
        : null,
      fresh || talked.title ? composer(env, at, here, operator, app) : null,
      fresh && !app
        ? h(
          'div',
          {
            class: 'Talk_Starts',
            role: 'group',
            'aria-label': 'Ways to start',
          },
          starts(operator, beside.apps),
        )
        : null,
    ],
    script: chatScript(
      at,
      who,
      space,
      open,
      root,
      talked.begun || open,
      follows,
      talked.standing,
      !!speechOf(env),
    ),
    app,
  })
}

/** Updates from the Operator (updates.ts), beside the chat app's side. */
export let updatesPage = async (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside = {},
) => {
  // Opening them reads them, and the count beside them goes with it.
  let [news, views] = await Promise.all([
    updatesOf(env, space, who, true),
    visitsOf(env, beside.apps ?? []),
  ])
  return talkPage(env, space, who, beside, {
    title: `Updates from ${space.operator}`,
    status: 200,
    waiting: news.updates.filter((u) => u.needs).length,
    current: ['updates'],
    skip: ['#content', 'Skip to content'],
    main: h(
      'div',
      { class: 'Talk_Column Updates' },
      updates(env, space, news, beside.apps, views),
    ),
  })
}

// The box a person writes in, at the foot of the conversation: their words,
// the files going with them along its top (a gathering drop part,
// public/drop.js: picked, pasted or dropped anywhere on the box, each a
// preview or a chip to take back), Send, and Stop while the Operator works.
// The yak sits in the margin beside it (mascot.ts `Idle`), taking no room
// from the conversation, and shows what the Operator is doing (`MOVES`). It
// asks for a message to the Operator by
// name, or with an app open beside it, what should change there, and the
// words say the page they were written on and the app (`onPage`).
let composer = (
  env: Env,
  at: string,
  here: string,
  operator: string,
  app?: Shown,
) => {
  let asked = app
    ? `What should change in ${app.title || app.slug}?`
    : `Message ${operator}`
  return h(
    'form',
    {
      class: 'Talk_Box',
      id: 'ask',
      method: 'post',
      action: at,
      enctype: 'multipart/form-data',
    },
    h('input', { type: 'hidden', name: 'request', value: crypto.randomUUID() }),
    h('input', { type: 'hidden', name: 'page', value: here }),
    app ? h('input', { type: 'hidden', name: 'app', value: app.slug }) : null,
    h(
      Drop,
      { mod: 'gather', class: 'Talk_Write' },
      h(Idle, { class: 'Talk_Yak', base: url(env) }),
      h(Drop.Chosen, { 'aria-label': 'Files to send', 'aria-live': 'polite' }),
      h(Field, {
        lines: true,
        class: 'Talk_Field',
        name: 'say',
        placeholder: asked,
        'aria-label': asked,
      }),
      h(
        'div',
        { class: 'Talk_Tools' },
        h(
          'label',
          {
            class: 'Talk_Attach',
            title: 'Add images or documents, or paste or drop them here',
          },
          '＋ Add files',
          h(Drop.File, {
            type: 'file',
            name: 'file',
            multiple: true,
            'data-count': COUNT,
            'data-size': SIZE,
            'data-reads': READ,
            'data-unread':
              "The Operator can't read this kind of file. It is kept with your message.",
          }),
        ),
        h(Drop.Said, { role: 'status' }),
        h(
          Button,
          { class: 'Talk_Stop', type: 'button', 'data-stop': '' },
          'Stop',
        ),
        // shown where the browser or the platform can hear (public/voice.js)
        h(
          Button,
          {
            class: 'Talk_Voice',
            type: 'button',
            hidden: true,
            'data-voice': '',
            'aria-pressed': 'false',
            title: 'Talk instead of typing',
          },
          h(Icon, { of: icons.mic }),
          h('span', { 'data-voice-says': '' }, 'Talk'),
        ),
        h(Button, { mod: 'go', class: 'Talk_Send', type: 'submit' }, 'Send'),
      ),
    ),
    h('p', { class: 'Talk_Status', role: 'status', 'data-send-status': '' }),
  )
}

// The chat app's script: the durable draft and sending, Stop, talking
// instead of typing, and the conversation kept current from the Builder
// object's socket, each step's lines put in place by id and what it says
// aloud said to a person who talked. `paid` is whether the platform's
// speech is on, for a browser that has none of its own.
let chatScript = (
  at: string,
  who: Who,
  space: Space,
  open: string,
  root: string,
  talk: string,
  follows: Follows,
  standing: string,
  paid: boolean,
) =>
  `<script type="module">
import { browserDrafts } from '/_draft.js'
import { redraw } from '/redraw.js'
import { rowsOf } from '/_talk.js'
import { voice } from '/voice.js'
import { when } from '/when.js'
let open = ${JSON.stringify(open)}
let root = ${JSON.stringify(root)}
let chats = ${JSON.stringify(chatPath(space.slug, ''))}
let box = document.querySelector('[data-conversation]')
let heading = document.querySelector('[data-title]')
let form = document.querySelector('#ask')
// The app open beside the chat (T-140509) is loaded again when the Operator
// changes it, and what it is made of drawn again as the Operator works on it
// (\`canvas\`). With none open, the one the Operator is making opens by
// itself (D-146737): any it works on for a newcomer, else one it started in
// this conversation (\`following\`), each a frame's list.
let here = ${JSON.stringify(space.slug)}
let follows = ${JSON.stringify(follows)}
let canvas = () => document.querySelector('[data-app]')
let ours = (apps = []) => apps.filter((c) => !c.space || c.space == here).map((c) => c.app)
let changing = (o) => {
  let app = canvas(), shown = app?.querySelector('[data-frame=live]')
  if (shown && ours(o.changed).includes(app.dataset.app)) shown.src = shown.getAttribute('src')
  if (app) return void (ours(o.worked).includes(app.dataset.app) && remake(app.dataset.app))
  let opening = follows ? ours(o[follows]) : []
  if (opening.length) remake(opening.at(-1))
}
// It comes drawn whole, and only the parts of it that changed are put in
// place, so the screens load again only when where they are changes; its
// newest stage opens as it is reached, and the person's own pick stays until
// then.
let put = (drawn) => {
  let made = document.createElement('template')
  made.innerHTML = drawn.canvas
  let next = made.content.firstElementChild
  let was = canvas()
  if (!was) {
    let page = document.querySelector('.Talk')
    page.classList.add('Talk-app')
    page.append(next)
    made.innerHTML = drawn.show
    document.querySelector('.Talk_Bar').append(made.content.firstElementChild)
    return
  }
  if (was.dataset.app != next.dataset.app) return
  for (let part of next.querySelectorAll('[data-part]')) {
    let at = was.querySelector('[data-part="' + part.dataset.part + '"]')
    if (at && at.outerHTML != part.outerHTML) at.replaceWith(part)
  }
  if (next.dataset.stage == was.dataset.stage) return
  was.dataset.stage = next.dataset.stage
  let tab = was.querySelector('[name=made][value="' + next.dataset.stage + '"]')
  if (tab) tab.checked = true
}
// A page pressed in What it can do opens in its frame by itself (its
// link's target); Screens, and that frame among them, come forward with it.
document.addEventListener('click', (e) => {
  let shows = e.target.closest?.('[data-shows]')
  if (!shows) return
  let app = canvas()
  let tab = app?.querySelector('[name=made][value=screens]')
  if (tab) tab.checked = true
  let frame = app?.querySelector('[name=screen][value="' + shows.dataset.shows + '"]')
  if (frame) frame.checked = true
})
// One read of it at a time; one asked for meanwhile follows it.
let remaking = false, wanted
let remake = async (slug) => {
  wanted = slug
  if (remaking) return
  remaking = true
  try {
    while (wanted) {
      let asked = wanted
      wanted = undefined
      let response = await ask('${at}?made=' + encodeURIComponent(asked))
      if (!response.ok) throw new Error('What is being made could not be brought up to date. Reload to try again.')
      put(await response.json())
    }
  } catch (e) { said(e) } finally { remaking = false }
}
let status = document.querySelector('[data-send-status]') ?? document.createElement('p')
let draftAt = '${at}?draft=1'
// How long the page waits on its door before giving up and asking again, so
// a request the network holds unanswered fails in seconds rather than stopping
// the draft from syncing until something else ends it.
let WAIT = 10_000
let submission
let draftClient = {
  me: async () => ({ person: '${who.person}' }),
  apply: async (bundles) => {
    let response
    if (submission) {
      let sent = submission; submission = undefined
      sent.set('draft', JSON.stringify(bundles))
      response = await fetch(form.action, { method: 'POST', body: sent })
    } else response = await fetch(draftAt, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundles }), signal: AbortSignal.timeout(WAIT) })
    if (!response.ok) throw new Error('Your draft could not sync. A recovery copy is kept on this device.')
    return response.json()
  },
  // Read once, then heard on the page's socket as each change lands, and read
  // again whenever the socket opens, for what landed while it was closed. It
  // is never read on a timer: what is typed here is kept on the device and
  // written whether or not a read answered.
  subscribe: (_q, hear) => {
    hearing.add(hear)
    readDrafts([hear])
    return () => hearing.delete(hear)
  }
}
// A read that had no answer in time, or one the platform failed, is asked
// again after a second, then two, four and eight: a deploy is a moment in
// which the edge answers 502 and the Builder restarts, and the page reads past
// it quietly (the reporter holds what it meets meanwhile). Only a read that
// failed through all of them is said.
let ask = async (url) => {
  for (let pause of [1000, 2000, 4000, 8000, null]) {
    try {
      let response = await fetch(url, { signal: AbortSignal.timeout(WAIT) })
      if (response.status < 500 || pause == null) return response
      response.body?.cancel()
    } catch (e) { if (pause == null) throw e }
    await new Promise((on) => setTimeout(on, pause))
  }
}
let hearing = new Set()
let KEPT = 'Your draft is kept on this device until syncing returns.'
// A read failed through all of ask's tries is said, and asked again when the
// socket next opens; a hearer that throws is the page's own fault, and goes to
// the reporter.
let readDrafts = async (hears = hearing) => {
  let bundles
  try {
    let response = await ask(draftAt)
    if (!response.ok) throw new Error(String(response.status))
    bundles = (await response.json()).bundles
  } catch (e) { return void (status.textContent = KEPT) }
  if (status.textContent == KEPT) status.textContent = ''
  for (let hear of hears) if (hearing.has(hear)) hear(bundles)
}
let drafts = browserDrafts(draftClient, '${space.eid}:operator', { by: '${who.person}', report: (e) => { status.textContent = e.message } })
// Each conversation keeps its own draft, and the box is ready to type in.
let place = ${JSON.stringify('operator:' + talk)}
if (form) { drafts.bind(form.elements.say, place); form.elements.say.focus() }
let said = (e) => { status.textContent = e.message }
let speech = form && voice({ button: form.querySelector('[data-voice]'), form, say: form.elements.say, at: '${at}', paid: ${paid}, said })
let thread = () => box.querySelector('[data-task]')
let working = () => !!box.querySelector('[data-pending]')
// The yak beside the box shows what the Operator is doing (mascot.ts
// \`MOVES\`): a loop over and over while it lasts, one played once as the
// work ends, and his waiting otherwise (idle.js).
let moves = ${JSON.stringify(MOVES)}
let yak = form?.querySelector('[data-idle]')
let last = 'idle'
let doing = (now = 'idle') => {
  if (!yak || now == last) return
  last = now
  let move = moves[now]
  if (move && !move.once) return void (yak.dataset.doing = move.loop)
  delete yak.dataset.doing
  if (move) yak.dispatchEvent(new CustomEvent('idle', { detail: move.loop }))
}
let redrawn = () => doing(thread()?.dataset.doing)
redrawn()
// The page follows the conversation down as it grows, unless the person has
// scrolled up to read.
let near = () => !globalThis.innerHeight || globalThis.innerHeight + globalThis.scrollY >= document.body.scrollHeight - 120
let follow = (was) => { if (was) globalThis.scrollTo?.(0, document.body.scrollHeight) }
// Enter sends, Shift+Enter starts a new line.
form?.elements.say.addEventListener('keydown', (e) => {
  if (e.key == 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit?.() }
})
// A way to start fills the box with its words, kept as the draft, for the
// person to finish.
document.addEventListener('click', (e) => {
  let start = e.target.closest('[data-say]')
  if (!start || !form) return
  let say = form.elements.say
  say.value = start.dataset.say
  say.dispatchEvent(new Event('input', { bubbles: true }))
  say.focus()
  say.setSelectionRange(say.value.length, say.value.length)
})
// Stop takes effect on the page at once; the Operator's own word follows.
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-stop]')) return
  let card = thread()
  if (!card) return
  card.removeAttribute('data-pending')
  card.querySelector('[data-now]').textContent = 'Stopped.'
  doing('idle')
  try {
    let response = await fetch('${at}?stop=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: card.dataset.task }) })
    if (!response.ok) throw new Error('It could not be stopped. Try again.')
    status.textContent = ''
  } catch (error) {
    card.setAttribute('data-pending', '')
    said(error)
  }
})
// Where the conversation stood when the page last drew it (operator-host.ts
// \`standingAt\`), until a step is heard; the socket says where it stands as
// it opens, and the page reads it again only when that moved.
let standing = ${JSON.stringify(standing)}
// One read at a time; a step heard during one reads once more after it.
let reading, again = false
let read = async () => {
  if (open == 'new') return
  if (reading) return void (again = true)
  reading = (async () => {
    do {
      again = false
      let response = await ask('${at}?talk=' + encodeURIComponent(open))
      if (!response.ok) throw new Error('This page could not be brought up to date. Your conversation is saved; reload to try again.')
      let got = await response.json()
      standing = got.standing
      let was = near()
      if (got.html) redraw(box, got.html), redrawn()
      if (got.title) heading.textContent = got.title
      if (follows && !canvas() && got.making && (follows == 'worked' || got.started)) remake(got.making)
      follow(was)
    } while (again)
  })()
  try { await reading } finally { reading = undefined }
}
// Each step the Operator takes arrives on the socket as the lines it changed,
// each as the entries it draws, drawn here as the conversation draws them
// (operator-rows.ts) and put in place by id; a conversation the page has not
// drawn yet (a request just taken up) reads the page again, and another
// one's step is not this page's.
let live = false, opened = false
let hear = (frame) => {
  if (frame.drafts) for (let heard of hearing) heard(frame.drafts)
  if (frame.ready && (frame.standing == null || frame.standing !== standing)) read().catch(said)
  let o = frame.operator
  if (!o) return
  changing(o)
  let card = thread()
  if (!card) return void read().catch(said)
  if (card.dataset.task != o.task) return
  if (o.said) speech?.tell(o.said)
  standing = undefined
  let was = near()
  let rows = card.querySelector('[data-rows]')
  // A reply as it is written, until the step that wrote it lands.
  let typing = card.querySelector('[data-typing]')
  if (o.typing) {
    if (!typing) {
      typing = document.createElement('p')
      typing.className = 'Talk_Reply'
      typing.dataset.typing = ''
      rows.append(typing)
    }
    typing.textContent += o.typing
    card.querySelector('[data-now]').textContent = 'Typing…'
    doing('writing')
    return follow(was)
  }
  typing?.remove()
  for (let row of o.lines ? rowsOf(o.lines) : o.rows) {
    let at = document.getElementById('row-' + row.id)
    if (!at) {
      at = document.createElement('div')
      at.id = 'row-' + row.id
      rows.append(at)
    }
    if (at.dataset.html == row.html) continue
    redraw(at, row.html)
    at.dataset.html = row.html
  }
  card.querySelector('[data-now]').textContent = o.now
  doing(o.doing)
  card.toggleAttribute('data-pending', !!o.now)
  follow(was)
}
let listen = () => {
  let socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '${at}?live=1&lines=1' + (open == 'new' ? '' : '&talk=' + encodeURIComponent(open)))
  // A socket still opening after the wait is closed, and so opened again.
  let opening = setTimeout(() => socket.close(), WAIT)
  // A socket opening again may follow a deploy, which the page then moves onto
  // (public/deploy.js).
  socket.onopen = () => {
    clearTimeout(opening); live = true; readDrafts()
    let app = canvas()
    if (app) remake(app.dataset.app)
    if (opened) dispatchEvent(new Event('yak-reconnect'))
    opened = true
  }
  socket.onmessage = (e) => { try { hear(JSON.parse(e.data)) } catch (error) { said(error) } }
  socket.onclose = () => { clearTimeout(opening); live = false; poll(); setTimeout(listen, 3000) }
}
let polling = false
let poll = async () => {
  if (live || polling || !working()) return
  polling = true
  try { await read() } catch (e) { said(e) }
  finally { polling = false; if (working()) setTimeout(poll, 2000) }
}
form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  let button = form.querySelector('[type=submit]')
  button.disabled = true
  form.setAttribute('aria-busy', 'true')
  status.textContent = 'Sending…'
  try {
    submission = new FormData(form)
    let request = form.elements.request.value
    let saved = await drafts.spend(place, [{ entity: { eid: request } }])
    if (!saved) throw new Error('Your message could not be confirmed. Your words are kept; try sending again.')
    form.elements.file.value = ''; form.elements.file.dispatchEvent(new Event('change', { bubbles: true })); form.elements.request.value = crypto.randomUUID()
    status.textContent = ''
    // Words go to the person's conversation, which opens to show them when
    // another page sent them.
    let app = canvas()
    if (thread()?.dataset.task != root) return void location.assign(chats + request + (app ? '?app=' + encodeURIComponent(app.dataset.app) : ''))
    await read(); poll()
  } catch (error) { said(error) }
  finally { button.disabled = false; form.removeAttribute('aria-busy') }
})
// When each message was sent, in the person's own time, kept current.
let stamps = () => {
  for (let t of box.querySelectorAll('time[datetime]')) t.textContent = when(t.dateTime)
}
stamps()
setInterval(stamps, 60_000)
follow(true)
listen()
</script>`
