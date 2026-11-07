import type { Bundle } from '@yaks/graph'
import { type ComponentChildren as Node, Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import {
  Button,
  Card,
  Check,
  Drop,
  Field,
  Form,
  Icon,
  SideNav,
} from '@yaks/ui/parts'
import type { Env } from './env.ts'
import { directoryOf, type Reach, type Space } from './directory.ts'
import { reachOf } from './operator-reach.ts'
import { builderOf, operatorDoor, SPACE } from './build-door.ts'
import { vouched, type Who } from './session.ts'
import { PROTOCOL, protocolled, upgrading } from './protocol.ts'
import { choice as spaceChoice, esc, type Picked, shell } from './pages.ts'
import { spaceHost, url } from './host.ts'
import {
  chatPath,
  logoPath,
  MANAGE,
  managePath,
  manifestPath,
  SLUG,
} from './route.ts'
import { PLATFORM_BACKGROUND } from './apps.ts'
import {
  keepFile,
  type Request as Intake,
  rootOf,
} from './operator-channels.ts'
import { mailFrom } from './post.ts'
import { parts } from './form.ts'
import { gathered } from './bytes.ts'
import { refuse } from './tool.ts'
import { Idle, MOVES } from './mascot.ts'
import {
  CONSENT,
  handed,
  REPLIES,
  tell,
  type Texting,
  texts,
} from './operator-texts.ts'
import { given } from './operator-name.ts'
import {
  backendOf,
  BUTLERS,
  modelOf,
  offered,
  paceOf,
  sampled,
  speaks,
  voiceOf,
} from './speech.ts'
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import { attached, PICTURES, reply, talks, trouble } from './operator-view.ts'
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

// One of a few to pick, as a radio: its name in bold, what it means beside
// it, `also` on its input.
type Offer = { id: string; name: string; about: string; checked: boolean }
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
    offers.map((o) => choice(name, o)),
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
      'Text your Operator about anything, and it answers by text; call it, and it answers by voice. It also texts you when it finishes a change, needs an answer from you, or something about your space needs you, and apps you build can text you reminders. You can still use chat and email.',
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
// What a person agreed to be texted at. Any opt-in this space's operator
// store still keeps from before the number moved onto the person is handed to
// the directory first, unless the directory already holds a newer one
// (operator-texts.ts `handed`). The move is the platform's, not the
// viewer's, so it is written as the platform.
let textingOf = async (env: Env, space: Space, who: Who) => {
  let dir = directoryOf(env.STORE)
  let kept = await operatorDoor(env, space, who, 'texts', {}) as Parameters<
    typeof handed
  >[0][]
  if (kept.length) {
    let had = await Promise.all(kept.map((k) => dir.texting(k.person)))
    let owed = kept.filter((_, i) => !had[i])
    if (owed.length) {
      await dir.apply({ entities: owed.flatMap(handed) })
    }
    await operatorDoor(env, space, who, 'texts', { handed: true })
  }
  return dir.texting(who.person ?? '')
}

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
    let row = await operatorDoor(env, space, who, 'request', {
      id: q.get('attachment'),
    }) as Bundle
    let file = (row.operator_request as Intake).files?.[Number(q.get('file'))]
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
    return socketTo(env, space, req, who, '/operator/ws')
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
    let talked = await conversationOf(env, space, who, at, open)
    if (!talked.title) {
      return Response.json({ message: 'That conversation is missing.' }, {
        status: 404,
      })
    }
    return Response.json({
      title: talked.title,
      task: talked.task,
      html: talked.html,
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
) => {
  let none = { task: '', begun: '', title: '', html: '' }
  if (open == 'new') return none
  let { task, begun, title, html, waiting } = await operatorDoor(
    env,
    space,
    who,
    'conversation',
    { at, open, ...everyone ? { everyone } : {}, ...opens ? { opens } : {} },
  ).catch((e) => {
    if (e.status != 404) throw e
    return { ...none, waiting: [] }
  }) as {
    task: string
    begun: string
    title: string
    html: string
    waiting: Bundle[]
  }
  return { task, begun, title, html: html + conversation(waiting) }
}

// The Operator's settings, which the dashboard draws beside its side like
// every other page (pages.ts `desk`): what it does and where, a link to its
// conversations in the chat app (`chatPage`), and the texts it may send.
export let operatorBody = async (env: Env, space: Space, who: Who) => {
  let at = managePath('operator', space.slug)
  let [consent, { pa, beyond }, phone, platform] = await Promise.all([
    textingOf(env, space, who),
    reachOf(directoryOf(env.STORE), space, who.person ?? ''),
    phoneAt(env, space.sender),
    phoneAt(env),
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

// The settings page's script: the name, the voice and the texts choice, and
// each voice's sample played in place of whichever was playing.
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
for (let form of document.querySelectorAll('#texts, #name, #voice')) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    let said = form.querySelector('[data-status]')
    let body = new FormData(form)
    if (e.submitter?.name == 'stop') body.set('stop', '1')
    said.textContent = 'Saving…'
    try {
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
 * apps of this one they may open, and what they are called. */
export type Beside = {
  spaces?: Picked[]
  apps?: { eid: string; slug: string; title: string }[]
  name?: string | null
}

// How many of the space's apps the side shows before "All N apps".
let APPS = 4

// The chat app's side, the product's whole menu (T-140506): whose Operator
// it is, in the space selector; the Operator by name, which opens the
// person's one conversation with it (T-141349); Updates from the Operator,
// with how many wait on the person; the space's apps; and at the foot Manage,
// the settings behind the product (today's dashboard pages: its Apps for the
// space's owner, the Operator's settings for a member, the only one of them
// they may open), where older chats are listed. `current` holds what this
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

// The app open beside the chat (T-140509): its icon, its name and where it
// lives, a way to open it in a tab of its own, and the app itself, live,
// which the page reloads when the Operator changes it (`chatScript`). The
// app's host lets the platform frame it (cache.ts `sealed`). On a phone it
// takes the screen in the chat's place while chosen (`#app`), and Chat goes
// back.
let canvas = (env: Env, space: Space, app: Shown) => {
  let host = `${spaceHost(env, space.slug)}/${app.slug}`
  let title = app.title || app.slug
  return h(
    'section',
    { class: 'Talk_App', id: 'app', 'aria-label': title, 'data-app': app.slug },
    h(
      'header',
      { class: 'Talk_AppHead' },
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
      h(
        Button,
        { href: `https://${host}/`, target: '_blank', rel: 'noopener' },
        h(Icon, { of: icons['external-link'] }),
        'Open',
      ),
    ),
    h(
      'div',
      { class: 'Talk_Stage' },
      h('iframe', {
        class: 'Talk_Frame',
        src: `https://${host}/`,
        title,
        'data-frame': '',
      }),
    ),
  )
}

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

/** A space's Operator page as a web app: what a phone installs from. */
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
    icons: [{ src: ICON, type: 'image/png', sizes: '512x512' }],
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
    app?: Shown
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
            page.app
              ? h(
                Button,
                { href: '#app', class: 'Talk_Show' },
                page.app.title || page.app.slug,
              )
              : null,
          ),
          page.main,
        ),
        page.app ? canvas(env, space, page.app) : null,
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
 * of those the person may open, and no other: an app the conversation
 * changed opens only when they choose it. A new chat about an app asks what should change
 * in it, and the words sent say which page and app are open (operator-view.ts
 * `onPage`).
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
  let root = rootOf(space.eid, who.person ?? '')
  let [talked, news] = await Promise.all([
    conversationOf(env, space, who, at, open == 'new' ? root : open),
    updatesOf(env, space, who),
  ])
  if (open == 'new' && talked.title) open = root
  let fresh = open == 'new'
  let first = beside.name?.trim().split(/\s+/)[0]
  let app = beside.apps?.find((a) => a.slug == chosen)
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
      talked.begun || open,
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
        h(Button, { mod: 'go', class: 'Talk_Send', type: 'submit' }, 'Send'),
      ),
    ),
    h('p', { class: 'Talk_Status', role: 'status', 'data-send-status': '' }),
  )
}

// The chat app's script: the durable draft and sending, Stop, and the
// conversation kept current from the Builder object's socket, each step's
// lines put in place by id.
let chatScript = (
  at: string,
  who: Who,
  space: Space,
  open: string,
  talk: string,
) =>
  `<script type="module">
import { browserDrafts } from '/_draft.js'
import { redraw } from '/redraw.js'
import { when } from '/when.js'
let open = ${JSON.stringify(open)}
let root = ${JSON.stringify(rootOf(space.eid, who.person ?? ''))}
let chats = ${JSON.stringify(chatPath(space.slug, ''))}
let box = document.querySelector('[data-conversation]')
let heading = document.querySelector('[data-title]')
let form = document.querySelector('#ask')
// The app open beside the chat (T-140509) is loaded again when the Operator
// changes it.
let here = ${JSON.stringify(space.slug)}
let app = document.querySelector('[data-app]')
let shown = app?.querySelector('[data-frame]')
let changing = (o) => {
  if (shown && (o.changed ?? []).some((c) => (!c.space || c.space == here) && c.app == app.dataset.app)) shown.src = shown.getAttribute('src')
}
let status = document.querySelector('[data-send-status]') ?? document.createElement('p')
let draftAt = '${at}?draft=1'
let submission
let draftClient = {
  me: async () => ({ person: '${who.person}' }),
  apply: async (bundles) => {
    let response
    if (submission) {
      let sent = submission; submission = undefined
      sent.set('draft', JSON.stringify(bundles))
      response = await fetch(form.action, { method: 'POST', body: sent })
    } else response = await fetch(draftAt, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bundles }) })
    if (!response.ok) throw new Error('Your draft could not sync. A recovery copy is kept on this device.')
    return response.json()
  },
  // Read once, then heard on the page's socket as each change lands, and read
  // again whenever the socket opens, for what landed while it was closed.
  subscribe: (_q, hear) => {
    hearing.add(hear)
    readDrafts([hear])
    return () => hearing.delete(hear)
  }
}
let hearing = new Set()
let readDrafts = async (hears = hearing) => {
  try {
    let response = await fetch(draftAt)
    if (!response.ok) throw new Error(String(response.status))
    let { bundles } = await response.json()
    for (let hear of hears) if (hearing.has(hear)) hear(bundles)
  } catch (e) { status.textContent = 'Your draft is kept on this device until syncing returns.' }
}
let drafts = browserDrafts(draftClient, '${space.eid}:operator', { by: '${who.person}', report: (e) => { status.textContent = e.message } })
// Each conversation keeps its own draft, and the box is ready to type in.
let place = ${JSON.stringify('operator:' + talk)}
if (form) { drafts.bind(form.elements.say, place); form.elements.say.focus() }
let said = (e) => { status.textContent = e.message }
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
// One read at a time; a step heard during one reads once more after it.
let reading, again = false
let read = async () => {
  if (open == 'new') return
  if (reading) return void (again = true)
  reading = (async () => {
    do {
      again = false
      let response = await fetch('${at}?talk=' + encodeURIComponent(open))
      if (!response.ok) throw new Error('This page could not be brought up to date. Your conversation is saved; reload to try again.')
      let got = await response.json()
      let was = near()
      if (got.html) redraw(box, got.html), redrawn()
      if (got.title) heading.textContent = got.title
      follow(was)
    } while (again)
  })()
  try { await reading } finally { reading = undefined }
}
// Each step the Operator takes arrives on the socket as the lines it changed,
// put in place by id; a conversation the page has not drawn yet (a request
// just taken up) reads the page again, and another one's step is not this page's.
let live = false
let hear = (frame) => {
  if (frame.drafts) for (let heard of hearing) heard(frame.drafts)
  let o = frame.operator
  if (!o) return
  changing(o)
  let card = thread()
  if (!card) return void read().catch(said)
  if (card.dataset.task != o.task) return
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
  for (let row of o.rows) {
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
  let socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '${at}?live=1')
  socket.onopen = () => { live = true; readDrafts(); read().catch(said) }
  socket.onmessage = (e) => { try { hear(JSON.parse(e.data)) } catch (error) { said(error) } }
  socket.onclose = () => { live = false; poll(); setTimeout(listen, 3000) }
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
    if (thread()?.dataset.task != root) return void location.assign(chats + request + (app ? '?app=' + encodeURIComponent(app.dataset.app) : ''))
    await read(); poll()
  } catch (error) { said(error) }
  finally { button.disabled = false }
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
