import { possessive } from '@yaks/text'
import { Notice, Transcript } from '@yaks/ui/parts'
import { wordsPage } from '@yaks/ui/parts'
import type { Bundle } from '@yaks/graph'
import {
  cloneElement,
  type ComponentChildren as Node,
  Fragment,
  h,
  isValidElement,
  toChildArray,
} from 'preact'
import { renderToString } from 'preact-render-to-string'
import { Button, Card, Empty, Field, Form, Icon } from '@yaks/ui/parts'
import type { Env } from './env.ts'
import { directoryOf, type Panes, type Space, walkTo } from './directory.ts'
import { chatRows } from './connections.ts'
import { reachOf } from './operator-reach.ts'
import { background, caught } from './defects.ts'
import {
  builderOf,
  carried,
  operatorDoor,
  seated,
  settingsAt,
} from './build-door.ts'
import { vouched, type Who } from './session.ts'
import { PROTOCOL, protocolled, upgrading } from './protocol.ts'
import { esc, page as drawn, type Picked, run, script, shell } from './pages.ts'
import { asset, chatPreloads } from './sheets.ts'
import { aboutPath, talkSide } from './talk-sidebar.ts'
import { type Ways, Ways as Reaching } from './operator-ways.ts'
import { frame, FRAMED } from './frame.ts'
import { apex, spaceHost, url } from '@yaks/platform/host'
import {
  backTo,
  chatPath,
  logoPath,
  MANAGE,
  managePath,
  manifestPath,
  type MarkedApp,
  type StoreDoor,
  talkPath,
} from '@yaks/platform/routes'
import { SLUG } from '@yaks/platform/names'
import { CONTEXT } from './app-operator.ts'
import {
  PLATFORM_BACKGROUND,
  PLATFORM_DARK_BACKGROUND,
} from '@yaks/platform/woven'
import type { Request as Intake } from './operator-channels.ts'
import { type Clock, clock } from './timing.ts'
import { attachmentKey } from './attachment-key.ts'
import { mailFrom } from '@yaks/platform/host'
import { subdomainMail } from './space-mail.ts'
import { parts } from './form.ts'
import { gathered } from './bytes.ts'
import { fromChunks, holding } from '@yaks/blob'
import { refuse } from './tool.ts'
import { MOVES } from './mascot.ts'
import { Ask, type Asking } from './operator-box.ts'
import {
  ALERTING,
  alertingOf,
  settingsOf,
  settingsRow,
  TEXTING,
  textingOf,
} from '@yaks/platform/operator-settings'
import {
  operatorSettingsView,
  type OperatorView,
} from '@yaks/platform/operator-settings-view'
import { ACCOUNT, accountOf } from '@yaks/platform/account-rows'
import { drawnRows } from '@yaks/platform/page-graph'
import { matchesRow } from '@yaks/platform/operator-matches'
import {
  matchesAt,
  type MatchesView,
  matchesView,
} from '@yaks/platform/operator-matches-view'
import { personRows } from './side.ts'
import { wearing } from './operator-settings.ts'
import { alertsRow, declinedRow, pushRow, vapidOf } from './operator-alerts.ts'
import { publicKey } from '@yaks/push'
import {
  hearing,
  offered,
  sampled,
  setupOf,
  speaking,
  speechOf,
} from './speech.ts'
import { ModelError } from '@yaks/model'
import { CallError } from '@yaks/tools/errors'
import { paneOf } from './operator-view.ts'
import type { HelperPage } from './operator-host.ts'
import { outcomeOf } from './operator-root.ts'
import { inputOf } from '@yaks/session/intake'
import {
  Aside,
  type Aside as Asided,
  Glance,
  glanceOf,
  type HelperLine,
  Mark,
} from './operator-aside.ts'
import {
  EntryMenu,
  framed,
  input,
  type Line,
  type Lines,
  row,
} from './operator-draw.ts'
import { PICTURES, reply, textual, trouble } from '@yaks/session/conversation'
import { DOCUMENTS } from '@yaks/platform/documents'
import { phoneAt } from './phones.ts'
import { icons } from './icons.ts'
import {
  ALL,
  allLater,
  allUpdates,
  type Apps,
  dismissedOf,
  dismissedUpdates,
  type Seat,
  type Updates,
  updates,
  updatesAcross,
  updatesLater,
  updatesOf,
  visitsOf,
} from './updates.ts'
import { PART, type TalkView, viewAttrs } from '@yaks/platform/talk-views'
import { friendsHere } from './friends.ts'
import {
  answered,
  type Listed,
  listingOf,
  listOf,
  waitsOf,
} from './operator-lists.ts'
import type { UpdateCounts } from './operator-updates.ts'
import { talkBeside } from './talk-beside.ts'
import {
  appCanvas,
  appQuestion,
  CANVAS_CHANGED,
  canvasAttrs,
  type CanvasRoot,
  type CanvasSlot,
  showing,
  SLOT,
} from '@yaks/platform/app-canvas-view'
import { appRows } from '@yaks/platform/side-rows'

// What this page draws, as markup: the edge where its parts become text.
let html = (node: Node) => renderToString(h(Fragment, null, node))

// What the message box takes: up to COUNT files at a time, and the kinds
// the Operator reads (operator-channels.ts
// `fileText`, and Claude's own); a file of another kind is kept with the
// message, and the box says the Operator can't read it.
let COUNT = 10
let READ = ['image/*', 'text/*', ...DOCUMENTS.map((d) => '.' + d)]
// The most a recording heard at once may be, a minute of Opus with room to
// spare, and the most a line said at once.
let HEARD = 2 * 1000 * 1000
let SAID = 600

// A field under its label.
let field = (id: string, label: string, control: Node) =>
  h(Form.Field, null, h(Form.Label, { for: id }, label), control)

/** The most bytes of words drawn in place as a page (`wordsPage`), which
 * reads them whole. */
let WORDS = 1024 * 1024

/** Over a newcomer's chat (newcomer.ts): their address, which signs them in
 * by a code and keeps the space, its apps and this chat as theirs, back on
 * this page (identity.ts `landed`, newcomer.ts `keep`). */
export let keepCard = (back: string) =>
  h(
    Form,
    { class: 'Talk_Keep Page_Form', method: 'post', action: '/login' },
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
          placeholder: 'you@example.com',
          name: 'address',
          type: 'email',
          required: true,
          autocomplete: 'email',
        }),
      ),
      h(Form.Hidden, { name: 'return', value: back }),
    ),
    h(
      Form.Actions,
      null,
      h(Button, { mod: 'go', type: 'submit' }, 'Send me a code'),
    ),
  )

/**
 * Alerts on this device, offered in the conversation (alerts-browser.ts
 * `offer`) when the Operator starts work that will take a while: one press
 * allows this browser's notifications and chooses them as how the person is
 * alerted, and Not now (`declined`) puts it away for good, saying where it
 * went: the Alerts setting (`alertsCard`) stays one tap away. On an iPhone's
 * browser it says to add the page to the Home Screen first, since Apple
 * pushes only to a page opened from there. Every part is hidden until the
 * script knows what this device can do, whether it already brings alerts
 * (`on`: notifications are the person's choice) and that the work is long.
 * `count` is how many things need them, which the installed page's icon
 * shows. Nothing is offered where yaks.app has no VAPID key (`key`).
 */
export let alertsOffer = (
  at: string,
  key: string | null,
  on: boolean,
  count: number | null = null,
  declined = false,
) => {
  if (!key) return null
  let notNow = h(
    Button,
    { type: 'button', mod: 'quiet', 'data-not-now': '' },
    'Not now',
  )
  let asked = (name: string, words: string, ...actions: Node[]) =>
    h(
      Card,
      { 'data-shows': name, hidden: true },
      h('p', null, words),
      h(Card.Actions, null, ...actions, notNow),
      h('p', { 'data-status': '', role: 'status' }),
    )
  return h(
    'div',
    {
      class: 'Talk_Alerts',
      'data-alerts-offer': '',
      'data-push': key,
      'data-at': at,
      'data-on': on ? '' : undefined,
      'data-badge': count ?? undefined,
    },
    declined ? null : [
      asked(
        'offer',
        'This may take a while. Want an alert on this device when it’s done?',
        h(Button, { type: 'button', mod: 'go' }, 'Turn on alerts'),
      ),
      asked(
        'install',
        'This may take a while. To get an alert on this iPhone when it’s done, add this page to your Home Screen first: tap Share, then Add to Home Screen, and open it from there. Apple sends alerts only to a page on the Home Screen.',
      ),
      h(
        'p',
        { 'data-shows': 'on', hidden: true, role: 'status' },
        'Alerts are on. You’ll get one on this device when it’s done.',
      ),
      h(
        'p',
        { 'data-shows': 'away', hidden: true, role: 'status' },
        'You can turn alerts on anytime in ',
        h('a', { href: `${at}#alerts` }, 'Settings'),
        '.',
      ),
    ],
  )
}

/** A request no session has taken yet, as its conversation draws it, with
 * the lines a settled one is drawn with: what was asked with the files sent
 * with it, under the id its line will have once taken, and what became of it
 * in plain words, never the error. */
export let conversation = (rows: Bundle[]) =>
  html(rows.map((asked) => {
    let request = asked.operator_request as Intake
    let doc = asked.doc as { title?: string; body?: string }
    let answer = asked.operator_answer as { text?: string } | undefined
    let failed = asked.failed ?? asked.bounced
    let files = request.files ?? []
    let id = inputOf(asked.entity.eid)
    let words: Bundle = {
      entity: { eid: id },
      content: { body: doc.body ?? '' },
      created: asked.created,
    }
    let sent = files.length ? { message: asked.entity.eid, files } : undefined
    let kept =
      'Your request is kept, but the Operator could not finish it. Send it again to try once more.'
    let unsent = 'The answer could not be sent to you. It is kept here.'
    let saved = 'Your request is saved. The Operator will start on it soon.'
    let [node, text] = answer?.text
      ? [
        h(
          Fragment,
          null,
          reply(answer.text),
          failed ? trouble(unsent, failed) : null,
        ),
        answer.text,
      ]
      : failed
      ? [trouble(kept, failed), kept]
      : [h(Notice, {}, saved), saved]
    let lines: Line[] = [
      {
        id,
        uses: [id],
        node: input(words, doc.body ?? '', sent),
        is: 'theirs',
      },
      { id: outcomeOf(asked.entity.eid), uses: [id], node, text },
    ]
    return h(
      Transcript,
      { 'data-pending': answer || failed ? undefined : '' },
      h(
        Transcript.Lines,
        { 'data-rows': '' },
        lines.map((l) => row(framed(l, [words]))),
      ),
    )
  }))

// What an app's page gave for the corner's note (`?about=`, public/edit.js):
// a JSON object of at most a send's context (app-operator.ts `CONTEXT`), or
// none.
let aboutOf = (said: string | null) => {
  if (!said || said.length > CONTEXT) return undefined
  try {
    let about = JSON.parse(said)
    return about && typeof about == 'object' && !Array.isArray(about)
      ? about as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/** The corner's note (public/edit.js): the page of yaks.app's own that an
 * app's page opens in a window of its own for a member who writes the app,
 * quoting the passage they selected there, with a box for their words. Send
 * is their own press on yaks.app, where the app's code cannot reach, so the
 * words go as theirs on the `chat` channel (`operatorAnswer`'s POST) with
 * all their tools, beside what the page gave as its context, and the window
 * goes on to their conversation. No page frames it. What the app's own code
 * sends is the app's words (app-operator.ts `send`). */
export let notePage = (
  env: Env,
  space: Space,
  app: string,
  about: Record<string, unknown> = {},
) => {
  let { page, ...context } = about
  let on = typeof page == 'string' && /^https:\/\//.test(page) ? page : ''
  let text = (v: unknown) => typeof v == 'string' ? v : ''
  let passage = text(context.selection)
  let title = text(context.title)
  return drawn(
    env,
    {
      title: 'A note to your Operator',
      // Never inside the app's page, which could dress it as its own box.
      headers: {
        'cache-control': 'no-store',
        'content-security-policy': "frame-ancestors 'none'",
      },
    },
    h(
      Card,
      null,
      h(Card.Head, null, h(Card.Title, null, 'A note to your Operator')),
      h(
        Card.Sub,
        null,
        `About ${title || app}${SLUG.test(app) ? ` in ${app}` : ''}.`,
      ),
      passage ? h('blockquote', null, passage.slice(0, 600)) : null,
      h(
        'form',
        {
          class: 'Page_Form',
          method: 'post',
          action: managePath('operator', space.slug),
          enctype: 'multipart/form-data',
          'data-note-form': '',
        },
        h(Form.Hidden, { name: 'request', value: crypto.randomUUID() }),
        SLUG.test(app) ? h(Form.Hidden, { name: 'app', value: app }) : null,
        on
          ? [
            h(Form.Hidden, { name: 'page', value: on }),
            h(Form.Hidden, {
              name: 'context',
              value: JSON.stringify(context),
            }),
          ]
          : null,
        h(
          'p',
          null,
          h(Field, {
            placeholder: 'Ask about this, or say what should change',
            lines: true,
            name: 'say',
            required: true,
            autofocus: true,
            'data-note': `${app}|${on}|${passage.slice(0, 200)}`,
            'aria-label': 'Your note',
          }),
        ),
        h(Button, { mod: 'go', type: 'submit' }, 'Send'),
        h('p', { role: 'status', 'data-note-said': '' }),
      ),
      h(
        'div',
        { 'data-note-sent': '', hidden: true },
        h(Transcript.Bubble, {}),
        h('p', { role: 'status' }),
      ),
    ),
    run(NOTE_SENDS),
  )
}

// The note sent shows at once, as the words of theirs it is, while its door
// takes it in; then the window goes on to their conversation. A note the door
// did not take is back in its box, and the page says why.
let NOTE_SENDS = `
let form = document.querySelector('form[data-note-form]')
let sent = document.querySelector('[data-note-sent]')
form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  let body = new FormData(form)
  let said = sent.querySelector('[role=status]')
  sent.querySelector('.Transcript_Bubble').textContent = String(body.get('say'))
  said.textContent = 'Sending…'
  form.hidden = true, sent.hidden = false
  try {
    let response = await fetch(form.action, { method: 'POST', body, headers: { accept: 'application/json' }, signal })
    let answer = await response.json().catch(() => null)
    if (!response.ok) throw new Error((answer?.error?.message ?? answer?.message ?? 'Your note was not sent.') + ' Your words are kept; send them again.')
    said.textContent = 'Sent.'
    location.replace(answer.to)
  } catch (error) {
    if (signal.aborted) return
    form.hidden = false, sent.hidden = true
    form.querySelector('[data-note-said]').textContent = error.message
  }
}, { signal })
`

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
  // The corner's note from an app's page (public/edit.js).
  if (q.has('note') && (req.method == 'GET' || req.method == 'HEAD')) {
    return notePage(env, space, q.get('note')!, aboutOf(q.get('about')))
  }
  if (q.has('attachment')) {
    let file = await operatorDoor(env, space, who, 'attachment', {
      id: q.get('attachment'),
      file: Number(q.get('file')),
    }).catch((e) => e?.status == 404 ? null : Promise.reject(e)) as
      | { name: string; mime: string; address: string }
      | null
    if (!file) {
      return new Response('That attachment is missing.', { status: 404 })
    }
    // A picture opens in place, as the conversation draws it, and words as
    // plain text; anything else is saved. None is ever read as a page of
    // yaks.app.
    // Words drawn in place (`&shown`) come as a page of their own in the
    // colors of the conversation around them (@yaks/ui `wordsPage`), read
    // whole to be, so only up to `WORDS`; longer ones stream as plain text.
    let key = attachmentKey(space, file.address)
    let shows = PICTURES.includes(file.mime)
    let reads = textual(file.mime)
    let framing = reads && q.has('shown') &&
      (await env.BLOBS.head(key) ?? { size: Infinity }).size <= WORDS
    let kept = await env.BLOBS.get(key)
    if (!kept) throw new Error('Operator attachment is missing: ' + file.name)
    return new Response(
      framing ? wordsPage(await new Response(kept.body).text()) : kept.body,
      {
        headers: {
          'content-type': shows
            ? file.mime
            : framing
            ? 'text/html; charset=utf-8'
            : reads
            ? 'text/plain; charset=utf-8'
            : 'application/octet-stream',
          'content-disposition': `${
            shows || reads ? 'inline' : 'attachment'
          }; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          'x-content-type-options': 'nosniff',
          'content-security-policy': framing
            ? "sandbox; default-src 'none'; style-src 'unsafe-inline'"
            : "sandbox; default-src 'none'",
          'cache-control': 'private, no-store',
        },
      },
    )
  }
  // A number a contact card in the chat agrees to texts at
  // (operator-contacts.ts); the settings page writes its own through the
  // page graph (@yaks/platform/operator-settings).
  if (q.has('texts') && req.method == 'POST') {
    let form = await req.formData()
    if (!form.has('contact')) {
      return Response.json({ message: 'Not found' }, { status: 404 })
    }
    try {
      return Response.json(
        await operatorDoor(env, space, who, 'contact', {
          id: String(form.get('contact')),
          number: String(form.get('number') ?? ''),
          agreed: form.get('agreed') == 'yes',
          code: String(form.get('code') ?? '').trim(),
        }),
      )
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  // A choice pressed beside a row of their lists (operator-lists.ts), sent on as
  // their own answer; the page it was pressed on is drawn again without it.
  if (q.has('asks') && req.method == 'POST') {
    let form = await req.formData()
    let said = (k: string) => String(form.get(k) ?? '')
    try {
      await answered(
        env,
        who.person ?? '',
        space.eid,
        said('server'),
        said('ask'),
        said('choice'),
      )
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return new Response(`That answer was not taken: ${e.message}`, {
        status: 409,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    return new Response(null, {
      status: 303,
      headers: {
        location: backTo(env, said('back'), chatPath(space.slug)),
      },
    })
  }
  if (q.has('alerts') && req.method == 'POST') {
    let form = await req.formData()
    try {
      let person = who.person ?? ''
      let dir = directoryOf(env.STORE)
      // Not now, said to alerts offered in the conversation.
      if (form.has('declined')) {
        await dir.apply({
          entities: [declinedRow(person, new Date().toISOString())],
        }, vouched(who))
        return Response.json({ declined: await dir.alertsDeclined(person) })
      }
      await dir.apply({
        entities: [alertsRow(person, String(form.get('channel') ?? ''))],
      }, vouched(who))
      return Response.json({ channel: await dir.alerts(person) })
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
  // Of the rows this device still shows notifications of, those the person
  // read or answered since, which it takes away (alerts-browser.ts).
  if (q.has('handled') && req.method == 'POST') {
    let tags = await req.json().catch(() => null)
    if (!Array.isArray(tags)) {
      return Response.json({ message: 'Send the tags shown.' }, { status: 400 })
    }
    return Response.json(
      await operatorDoor(env, space, who, 'updates', { handled: tags }),
    )
  }
  // The room of a chat server the Operator hears in full, chosen by the
  // space's owner on its chat card (`chatCard`), and the page drawn again.
  if (q.has('chat') && req.method == 'POST') {
    let form = await req.formData()
    try {
      if (who.role != 'owner') {
        throw refuse('forbidden', "Only the space's owner chooses this.")
      }
      let { choose } = await import('./chat.ts')
      await choose(
        env,
        who,
        space.eid,
        String(form.get('connection') ?? ''),
        String(form.get('room') ?? '') || null,
      )
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return new Response(`That channel was not saved: ${e.message}`, {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
    return new Response(null, { status: 303, headers: { location: at } })
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
      let { voice, provider, speed } = setupOf(
        env,
        await settingsAt(env, space, who),
      )
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
  // A page loaded before its store's door (operator-api.ts) reads and writes
  // its drafts and archive marks here, until T-165931.
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
  // Approve or Decline on an approval's card (operator-approvals.ts
  // `approvalCard`), pressed by whoever is signed in.
  if (q.has('approval') && req.method == 'POST') {
    return Response.json(
      await operatorDoor(env, space, who, 'approve', await req.json()),
    )
  }
  if (q.has('archive') && req.method == 'POST') {
    return Response.json(
      await operatorDoor(env, space, who, 'archive', await req.json()),
    )
  }
  if (q.has('stop') && req.method == 'POST') {
    let { task } = await req.json() as { task?: string }
    return Response.json(
      await operatorDoor(env, space, who, 'stop', { task }),
    )
  }
  if (req.method == 'POST') {
    // Where their connection places them now, for their own Operator
    // (located.ts), noted beside the answer, never before it.
    if (who.person) {
      let person = who.person
      background(
        import('./located.ts').then(({ connected }) =>
          connected(env, person, req)
        ).catch((e) => caught(e, { request: 'operator located' })),
      )
    }
    let form = new FormData()
    let files = []
    for await (let part of parts(req)) {
      if (part.filename && files.length == COUNT) {
        throw refuse('arguments', `Send up to ${COUNT} files at a time.`)
      }
      if (part.name == 'file' && part.filename) {
        let bytes = await holding({ stream: fromChunks(part.body) }, 0)
        if (bytes instanceof Uint8Array && !bytes.length) continue
        files.push(
          await (await import('./operator-channels.ts')).keepFile(
            env,
            space,
            part.filename,
            part.type || 'application/octet-stream',
            bytes,
          ),
        )
      } else if (!part.filename) {
        let bytes = await gathered(
          part.body,
          1024 * 1024,
          () => refuse('arguments', 'The message is too long.'),
        )
        form.set(part.name, new TextDecoder().decode(bytes))
      }
    }
    let request = String(form.get('request') || crypto.randomUUID())
    // The app open beside the chat, which the words are about, and the page
    // of yaks.app they were written on, which its box names (operator-box.ts `Ask`).
    let app = String(form.get('app') ?? '')
    // The tab of that app in front of them (operator-view.ts `paneOf`).
    let pane = paneOf(
      String(form.get('made') ?? ''),
      String(form.get('preview') ?? ''),
    )
    // From the corner's note (`notePage`), what the app's page gave, and
    // that page, which the words were written beside.
    let context = aboutOf(String(form.get('context') ?? ''))
    let said = String(form.get('page') ?? '')
    let page = new URL(
      said.startsWith(MANAGE + '/') || context && /^https:\/\//.test(said)
        ? said
        : chatPath(space.slug),
      url,
    )
    // Whichever page it is sent from, it goes to the person's conversation.
    let received = await operatorDoor(env, space, who, 'receive', {
      say: String(form.get('say') ?? ''),
      request: {
        channel: 'chat',
        files,
        page: page.href,
        ...SLUG.test(app) ? { app, ...pane ? { pane } : {} } : {},
        ...context ? { context } : {},
        // Sent from the New app screen (desk-pages.ts `asking`).
        ...form.has('new_app') ? { new_app: true } : {},
      },
      options: { id: request },
      ...(form.has('draft')
        ? { draft: JSON.parse(String(form.get('draft'))) }
        : {}),
    })
    if (form.has('draft')) return Response.json(received)
    // The corner's note sent by its script (`NOTE_SENDS`), which goes on to
    // the conversation once its words are in.
    if (req.headers.get('accept')?.includes('application/json')) {
      return Response.json({ request, to: chatPath(space.slug, request) })
    }
    return new Response(null, {
      status: 303,
      headers: { location: chatPath(space.slug, request) },
    })
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
  // One line of a conversation as data, for a fold the page opens of a line
  // it holds as the server drew it (operator-talk-browser.ts `mountTalk`):
  // read from where the page's reads start (`from`), so a line older than the
  // newest lines is there as the page drew it.
  if (q.has('talk') && q.has('line')) {
    let { lines } = await operatorDoor(env, space, who, 'conversation', {
      at,
      open: q.get('talk')!,
      line: q.get('line')!,
      ...q.has('from') ? { from: Number(q.get('from')) } : {},
    }).catch((e) => {
      if (e.status != 404) throw e
      return { lines: null }
    }) as { lines: Lines | null }
    return Response.json({ lines }, {
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  // One conversation read again.
  if (q.has('talk')) {
    let open = q.get('talk')!
    let talked = await conversationOf(env, space, who, at, open, {
      lines: q.has('lines'),
      ...q.has('from') ? { from: Number(q.get('from')) } : {},
      ...Number(q.get('take')) > 0 ? { take: Number(q.get('take')) } : {},
    })
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
      standing: talked.standing,
      ...talked.aside ? { aside: talked.aside } : {},
    }, { headers: { 'cache-control': 'private, no-store' } })
  }
  // The person's lists that were not in when a page was drawn (`talkPage`),
  // each part for its place (`later`), and how many of their rows wait on
  // the person, which the page adds to its bell.
  if (q.has('lists') && req.method == 'GET') {
    let { read } = await listingOf(env, who.person, space.eid)
    let listed = await read()
    let back = backTo(env, q.get('back') ?? '', chatPath(space.slug))
    let part = (waits: boolean) => html(besides(listed, at, back, waits))
    return Response.json({
      waits: part(true),
      other: part(false),
      waiting: waitsOf(listed),
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
    let out = carried(`https://builder${path}`, req)
    out.headers.delete('authorization')
    if (protocolled(req)) out.headers.set('sec-websocket-protocol', PROTOCOL)
    else out.headers.delete('sec-websocket-protocol')
    for (let [h, v] of Object.entries(seated(space, who))) {
      out.headers.set(h, v)
    }
    return out
  })

/**
 * A door of the space's Operator store as @yaks/api answers it, `/apply`,
 * `/query` or `/ws` under the Operator's path, asked by its page as `who`:
 * carried to the space's object with the kernel's vouch on it, as a socket is
 * (`socketTo`), where the store reads to them only what is theirs
 * (operator-api.ts). A write is read whole first, so the door can send it
 * again across a reset. An object still on the code before these doors
 * answers them as missing for a moment after a deploy, which is said as a
 * wait to ask again.
 */
export let storeAnswer = async (
  req: globalThis.Request,
  env: Env,
  space: Space,
  who: Who,
  door: StoreDoor,
): Promise<Response> => {
  let path = '/api/' + door + new URL(req.url).search
  if (door == 'ws') {
    return upgrading(req)
      ? socketTo(env, space, req, who, path)
      : new Response("This is the Operator store's WebSocket.", {
        status: 426,
      })
  }
  let body = req.method == 'POST' ? await req.text() : undefined
  let answer = await builderOf(env, space.eid)(() => {
    let { method, headers } = req
    let out = carried(
      `https://builder${path}`,
      new Request(req.url, { method, headers, body }),
    )
    for (let [h, v] of Object.entries(seated(space, who))) {
      out.headers.set(h, v)
    }
    return out
  })
  if (answer.status != 404) {
    let kept = new Response(answer.body, answer)
    kept.headers.set('cache-control', 'private, no-store')
    return kept
  }
  await answer.body?.cancel()
  return Response.json({
    error: 'Unavailable',
    message: 'Your Operator is starting on new code. Ask again in a moment.',
  }, { status: 503, headers: { 'retry-after': '5' } })
}

/** One conversation, opened by its task or a request: its sessions as they
 * ran (operator-view.ts `talk`), or the request alone while no session has
 * taken it. `everyone` reads any person's, for the platform's admin, each
 * titled by whose it is, `opens` is where its helpers' conversations open,
 * by their id (the chat app's unless the admin's), `lines` answers its lines
 * as data, and `updates` the person's Updates beside it, in the same
 * request. `from` keeps entries past the initial page's oldest sequence, and
 * `take` is how many of its lines it draws, the last 100 without it. An id in
 * its words opens where the reader's own server says (`mentions`, read from
 * their servers unless the caller has them). */
export let conversationOf = async (
  env: Env,
  space: Space,
  who: Who,
  at: string,
  open: string,
  {
    everyone = false,
    opens,
    lines: drawing = false,
    updates = false,
    from,
    mentions,
    take,
  }: {
    everyone?: boolean
    opens?: string
    lines?: boolean
    updates?: boolean
    from?: number
    mentions?: string | null
    take?: number
  } = {},
) => {
  let none = {
    root: '',
    task: '',
    begun: '',
    title: '',
    html: '',
    lines: null,
    now: '',
    standing: '',
  }
  // A Builder on the previous version still returns the full Updates.
  let news = async (read?: UpdateCounts | Updates) => {
    if (!updates) return
    read ??= await updatesOf(env, space, who)
    if ('needs' in read) return read
    return {
      waiting: read.waiting,
      needs: read.updates.filter((u) => u.needs).length,
    }
  }
  if (open == 'new') return { ...none, updates: await news() }
  let opening = mentions === undefined
    ? (await listingOf(env, who.person, space.eid)).mentions
    : mentions
  let {
    root,
    task,
    begun,
    title,
    html,
    lines = null,
    now = '',
    waiting,
    standing,
    aside,
    helper,
    updates: read,
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
      ...updates ? { updates: true, updateCounts: true } : {},
      ...from != null ? { from } : {},
      ...opening ? { mentions: opening } : {},
      ...take ? { take } : {},
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
    standing: string
    aside?: Asided
    helper?: HelperPage
    updates?: UpdateCounts | Updates
  }
  return {
    updates: await news(read),
    root,
    task,
    begun,
    title,
    html: html + conversation(waiting),
    lines,
    now,
    standing,
    aside,
    helper,
  }
}

// The Operator's settings, which the dashboard draws beside its side like
// every other page (pages.ts `desk`), drawn from the rows the browser draws
// it again from (@yaks/platform/operator-settings-view), which the page
// carries for its first paint (`data-view`): what the page's door answers
// of them (reach-door.ts), read here the same way.
export let operatorBody = async (
  env: Env,
  seen: Space,
  who: Who,
  dir = directoryOf(env.STORE),
) => {
  let at = managePath('operator', seen.slug)
  let person = who.person ?? ''
  let [
    space,
    { pa, beyond },
    phone,
    platform,
    alerting,
    texting,
    account,
    chats,
  ] = await Promise.all([
    settingsAt(env, seen, who),
    reachOf(dir, walkTo(seen.slug, seen.eid), person),
    phoneAt(env, seen.sender),
    phoneAt(env),
    personRows(dir, person, ALERTING),
    personRows(dir, person, TEXTING),
    personRows(dir, person, ACCOUNT),
    // A chat platform that cannot be offered leaves the rest of the page.
    who.role == 'owner'
      ? Promise.all([
        import('./chat.ts'),
        chatRows(dir, walkTo(seen.slug, seen.eid)),
      ]).then(([c, rows]) => c.offers(env, seen.eid, rows)).catch(
        (e) => {
          caught(e, { request: 'operator settings chat' })
          return []
        },
      )
      : Promise.resolve([]),
  ])
  let rows = [
    settingsRow(space.eid, wearing(space)),
    ...alerting,
    ...texting,
    ...account,
  ]
  let view: OperatorView = {
    person,
    space: { eid: space.eid, slug: space.slug },
    at,
    connections: managePath('connections', seen.slug),
    operator: space.operator,
    pa,
    beyond: beyond.map((r) => ({
      slug: r.space.slug,
      title: r.space.title,
      role: r.role,
    })),
    address: mailFrom(space.slug, null, env),
    sub: subdomainMail(env, space),
    from: phone?.transport().number,
    call: platform?.caller ? platform.transport().number : undefined,
    offer: offered(env, space),
    key: pushKey(env),
    chats: chats.map(({ platform, bot, user, kept, servers }) => ({
      platform: { title: platform.title },
      bot: { name: bot.name, testing: bot.testing },
      ...user ? { user: { name: user.name, testing: user.testing } } : {},
      kept,
      servers: servers.map((s) => ({
        ...s,
        rooms: s.rooms?.map(({ id, eid, name }) => ({ id, eid, name })) ??
          null,
      })),
    })),
  }
  return html(
    h(
      'div',
      {
        'data-view': 'operator-settings',
        'data-operator-view': JSON.stringify(view),
      },
      operatorSettingsView(view, {
        settings: settingsOf(rows)!,
        alerting: alertingOf(rows)!,
        texting: textingOf(rows),
        email: accountOf(rows)?.email || null,
      }),
      h('script', {
        type: 'application/json',
        'data-page-graph': '',
        dangerouslySetInnerHTML: { __html: drawnRows(person, rows) },
      }),
    ),
  )
}

// The public half of yaks.app's VAPID key, which a browser subscribes with,
// or null when browser notifications are not switched on.
let pushKey = (env: Env) => {
  let vapid = vapidOf(env)
  return vapid ? publicKey(vapid.key) : null
}

/** What the chat app's side holds beside every page of it, read by its door
 * (manage.ts `beside`): every space the person may open (its selector), the
 * apps of this one they may open, what they are called, whether they are
 * the platform's admin (tool.ts `admin`), and how to reach its Operator. */
export type Beside = {
  spaces?: (Picked & { eid: string })[]
  apps?: MarkedApp[]
  name?: string | null
  admin?: boolean
  /** how the person keeps the panes: the side folded to its icons, the
   * aside put away (directory.ts `Panes`) */
  panes?: Panes
  /** every way to reach this Operator (operator-ways.ts `waysOf`) */
  ways?: Ways
}

export { aboutPath }

/** Which apps the page goes to as the Operator works on them, with none
 * open (D-146737): for a newcomer any it works on, since their space holds
 * only what it builds them; for anyone else one it starts while they watch
 * (app_new), never one that was there before (T-140509). Each is a frame's
 * list of them (operator-view.ts `frame`). The page goes there by its
 * address (`?app=`), which alone says what is open beside the chat. */
type Follows = 'worked' | 'started' | null
let following = (newcomer: boolean): Follows => newcomer ? 'worked' : 'started'

// The Operator page installs to a home screen as a web app (D-136811): each
// space's own manifest (`installing`), named for its Operator and opening its
// chat, and the tags a phone reads beside it. The icon is the Operator's own
// tile, the connector's, which is opaque, so iOS paints no black behind it.
// Its scope is the whole origin, so signing in stays in the window.
let ICON = '/connector-512.png'
let whoseOf = (space: Space) =>
  `${space.operator}, ${possessive(space.title || space.slug)} Operator`
let installable = (space: Space) =>
  html([
    h('link', {
      rel: 'manifest',
      href: manifestPath(space.slug),
      crossorigin: 'use-credentials',
    }),
    space.logo ? h('link', { rel: 'icon', href: logoPath(space) }) : null,
    h('link', {
      rel: 'apple-touch-icon',
      href: logoPath(space, 'icon') ?? ICON,
    }),
    h('meta', { name: 'mobile-web-app-capable', content: 'yes' }),
    h('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }),
    h('meta', {
      name: 'apple-mobile-web-app-status-bar-style',
      content: 'black-translucent',
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
    color_scheme_dark: {
      background_color: PLATFORM_DARK_BACKGROUND,
      theme_color: PLATFORM_DARK_BACKGROUND,
    },
    icons: [
      space.logo
        ? { src: logoPath(space, 'icon'), type: 'image/png', sizes: '512x512' }
        : { src: ICON, type: 'image/png', sizes: '512x512' },
    ],
  }, {
    headers: {
      'content-type': 'application/manifest+json',
      'cache-control': 'private, no-cache',
    },
  })
}

// A page of the chat app, in the frame (frame.ts): the side
// (talk-sidebar.ts), and beside it the bar naming the page and whose Operator
// it is, over `main`; at its right the frame's aside, holding what the
// conversation is doing now (`aside`, operator-aside.ts) over the lists that
// do not wait on the person (`column`, talk-beside.ts), where the page has
// them; and the app open beside them all. The side's Updates is the page's one bell: what
// waits on the person there and in their servers' lists, counted once.
/** What a page of the chat app draws (`talkPage`). */
type TalkPage = {
  title: string
  status: number
  // how many Updates wait on the person (updates.ts `updatesOf`)
  waiting: number
  // the person's servers' lists, or null where they were not in when the
  // page was drawn, which its script reads after (`lateScript`)
  listed: Listed[] | null
  current: string[]
  // this page's address, where the side's fold draws it again
  here: string
  // a chat's address without the app open beside it, which its view stands
  // for (`viewOf`)
  chat?: string
  main: Node
  // where the skip link goes, and what it says
  skip: [string, string]
  script?: string
  // the app open beside it, and its canvas (@yaks/platform/app-canvas-view)
  app?: MarkedApp
  canvas?: Node
  canvasSlot?: CanvasSlot
  // what it is doing now at the top of the aside (operator-aside.ts), and
  // the summary the bar's button wears and describes
  aside?: Node
  mark?: Node
  asideDescription?: string
  // whether the lists that do not wait on the person stand beside it
  column?: boolean
  // on a page zoomed in on part of a conversation (a helper's), the way
  // back out, before its title in the bar, which then names it alone
  back?: Node
  // the title as the bar draws it, where it is more than its words
  heading?: Node
}

// A page of the chat app, in the frame (frame.ts): the side
// (talk-sidebar.ts), and beside it the bar naming the page and whose Operator
// it is, over `main`; at its right the frame's aside, holding what the
// conversation is doing now (`aside`, operator-aside.ts) over the lists that
// do not wait on the person (`column`, talk-beside.ts), where the page has
// them; and the app open beside them all. The side's Updates is the page's one bell: what
// waits on the person there and in their servers' lists, counted once.
//
// Each page is one of its page's views and holds the `others` too, hidden,
// each shown in place by a press on the side's link to it
// (@yaks/platform/talk-views): every page the space's Updates and every
// space's, beside what the caller adds. Each view's script is its own and
// stands in it; the aside is the conversation's, standing hidden where
// another view is open; and a helper's way back out stands only while its
// own view shows. The app open beside a chat is its view's, chosen in the
// browser (@yaks/platform/app-canvas-browser).
let talkPage = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  page: TalkPage,
  others: TalkPage[] = [],
) => {
  let at = managePath('operator', space.slug)
  let { listed } = page
  let waiting = page.waiting + (listed ? waitsOf(listed) : 0)
  let views = [page, ...others]
  let held = (here: string) => views.some((v) => v.here == here)
  if (!held(talkPath('updates', space.slug))) {
    views.push(updatesBeside(env, space, who, beside, listed))
  }
  if (!held(allAt(space))) {
    views.push(allBeside(env, space, who, beside))
  }
  let slot = views.find((v) => v.canvasSlot)?.canvasSlot
  // The column stands, hidden, around a slot for lists not in yet, and shows
  // once one of them has something in it.
  let asided = views.find((v) => v.column || v.aside)
  let lists = !asided?.column
    ? []
    : listed
    ? besides(listed, at, asided.here, false)
    : [later('other')]
  let aside = asided && (asided.aside || lists.length) ? asided : undefined
  let shown = viewOf(space, page, page == aside)
  let content = views.map((v) =>
    h(
      'section',
      {
        class: 'Talk_View',
        ...viewAttrs(
          v == page ? shown : viewOf(space, v, v == aside),
          v == page,
        ),
      },
      v.main,
      v.script
        ? h('div', { dangerouslySetInnerHTML: { __html: v.script } })
        : null,
    )
  )
  let own = (kids: Node) => partOf(page.here, kids)
  return shell(
    env,
    `${esc(page.title)} · ${esc(space.operator)}`,
    null,
    page.status,
    html(frame({
      friends: who.person && !who.visit
        ? { person: who.person, apex: apex(env) }
        : undefined,
      side: talkSide(env, space, who, beside, {
        waiting,
        current: page.current,
        app: page.app?.slug,
        here: page.here,
      }),
      back: own(page.back),
      title: page.heading ?? page.title,
      sub: whoseOf(space),
      waiting,
      tools: page.app ? showing(page.app) : null,
      content,
      contentScroll: page.chat ? 'end' : undefined,
      aside: aside
        ? {
          label: 'conversation panel',
          mark: aside.mark,
          description: aside.asideDescription,
          content: [
            aside.aside,
            lists.length ? talkBeside(lists, !!listed) : null,
          ],
          shut: beside.panes?.shut,
          back: page.here,
          hidden: aside != page,
        }
        : undefined,
      beside: [
        page.canvas,
        slot && h('template', { [SLOT]: JSON.stringify(slot) }),
      ],
      class: ['Talk', page.app && 'Talk-app', ...shown.marks]
        .filter(Boolean).join(' '),
      skip: page.skip,
    })) +
      (listed ? '' : lateScript(
        `${at}?${new URLSearchParams({ lists: '1', back: page.here })}`,
      )),
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    FRAMED,
    installable(space) + (page.chat ? chatPreloads(env) : ''),
  )
}

// Every space's Updates, opened from `space`.
let allAt = (space: Space) => `${ALL}?in=${encodeURIComponent(space.slug)}`

// How `page` is shown as one of its page's views (@yaks/platform/talk-views):
// at its address, or a chat's without the app beside it, which is chosen
// apart (@yaks/platform/app-canvas-browser); the side's link it lights; and
// the frame marked where a helper is zoomed in on.
let viewOf = (space: Space, page: TalkPage, aside: boolean): TalkView => {
  let all = page.current.includes('all')
  return {
    here: page.chat ?? page.here,
    link: all
      ? page.here
      : page.current.includes('updates')
      ? talkPath('updates', space.slug)
      : chatPath(space.slug),
    title: page.title,
    page: `${page.title} · ${space.operator} · yaks.app`,
    skip: page.skip,
    aside,
    all,
    marks: page.back ? ['Talk-zoomed'] : [],
  }
}

// `kids` as parts of the frame that stand only while the view at `here`
// shows (@yaks/platform/talk-views `PART`).
let partOf = (here: string, kids: Node) =>
  toChildArray(kids).map((kid) =>
    isValidElement(kid) ? cloneElement(kid, { [PART]: here }) : kid
  )

// What the page says where the lists that wait on the person could not be
// read after it was drawn.
let UNREAD = html(
  h('p', null, 'Your lists could not be read. Open this page again to try.'),
)

// The script of a page drawn before the person's lists were in (`talkPage`):
// it reads them from `from` (`?lists`), puts each part in its slot
// (`later`), shows the column beside the conversation where it now holds
// something, and adds the rows that wait to the bell and the installed
// page's icon.
let lateScript = (from: string) =>
  html(run(`
if (document.querySelector('[data-later]')) fetch(${
    JSON.stringify(from)
  }, { signal }).then((r) => r.ok ? r.json() : null).catch(() => null).then((got) => {
if (signal.aborted) return
for (let slot of document.querySelectorAll('[data-later]')) {
  let made = document.createElement('template')
  made.innerHTML = got ? got[slot.dataset.later] ?? '' : slot.dataset.later == 'waits' ? ${
    JSON.stringify(UNREAD)
  } : ''
  slot.replaceWith(made.content)
}
if (got) {
  let lists = document.querySelector('.Talk_Lists')
  if (lists?.children.length) lists.hidden = false
  for (let badge of document.querySelectorAll('[data-waiting]')) {
    let n = Number(badge.dataset.waiting) + got.waiting
    badge.textContent = n
    badge.hidden = !n
  }
  let offer = document.querySelector('[data-alerts-offer][data-badge]')
  if (offer) navigator.setAppBadge?.(Number(offer.dataset.badge) + got.waiting)?.catch(() => {})
}
})`))

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

// A helper's page is zoomed in from the conversation that started it. Its
// bar is one line: the way back out to that conversation, then the helper's
// title after the pip saying how it stands; the rest of its row (when it
// began or ended, what it came to, its model) is its aside's
// (operator-aside.ts `Self`). The box's Stop stops it while it works, which
// that conversation hears as the person's own (operator.ts `stop`).
let backOut = (parent: HelperPage['parent']) =>
  h(
    Button,
    {
      href: parent.href,
      class: 'Talk_Out',
      mod: 'quiet',
      'aria-label': `Back to ${parentName(parent)}`,
      title: `Back to ${parentName(parent)}`,
    },
    h(Icon, { of: icons['arrow-left'] }),
  )

let helperTitle = (title: string, self?: HelperLine) =>
  self
    ? [
      h('span', { 'data-mark': '' }, h(Mark, { standing: self.standing })),
      ' ',
      title,
    ]
    : title

// The conversation a helper's page zooms out to.
let parentName = (parent: HelperPage['parent']) =>
  parent.asked ? `the helper “${parent.asked}”` : 'your conversation'

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

let hello = (heading: string, said: string, plain?: string[]) =>
  h(
    Empty,
    {
      class: 'Talk_Hello',
      mod: 'welcome',
      'data-canvas-greeting': plain && JSON.stringify(plain),
    },
    h(Empty.Title, { mod: 'welcome' }, heading),
    h('p', null, said),
  )

// Lists not in yet when a page is drawn: a page draws without them.
let LATER = Promise.resolve(null)

// The person's lists that wait on them, or the others, each that holds
// something, drawn for the page `here`, whose choices are sent to `at`.
let besides = (listed: Listed[], at: string, here: string, waits: boolean) =>
  listed.filter((l) => l.waits == waits)
    .map((l) => listOf(l, `${at}?asks=1`, here))
    .filter((node) => node != null)

// Where lists not in yet are put once the page has them (`lateScript`):
// those that wait on the person in their Updates, the others beside the
// conversation. It says nothing while they are read.
let later = (part: 'waits' | 'other') => h('div', { 'data-later': part })

// The person's servers' lists, read from now and never holding a page back:
// `drawn` gives them where they are in by the time it is drawn, or null,
// which the page reads after (`lateScript`). `listing` is how many lists
// there are and where their ids open.
let reading = (env: Env, space: Space, who: Who) => {
  let listing = listingOf(env, who.person, space.eid)
  let read = listing.then((l) => l.size ? l.read() : [])
  return {
    listing,
    drawn: async () => {
      if (!(await listing).size) return []
      let got = await Promise.race([read, LATER])
      // The page reads them again; this read's own failure is told there.
      if (!got) read.catch(() => {})
      return got
    },
  }
}

/**
 * One conversation with the Operator in its chat app, a page of its own
 * (@yaks/platform/routes `chatPath`): the product's side (`side`) with the person's chats
 * in it, newest first, behind the menu; the conversation filling the page,
 * what it is doing now under it; the box to write in at the foot, with Stop
 * while it works; and beside it the person's lists that do not wait on
 * them (talk-beside.ts), whichever conversation is open. `open` is a task, a request no task has
 * taken yet, or `new`, which greets the person by name and over the box
 * offers a few ways to start, the box where it always sits.
 *
 * Beside it, the app the address names (`chosen`, the side's `aboutPath`),
 * of those the person may open, and no other: nothing stored opens one.
 * With none named, the page goes to the app the Operator starts as they
 * watch (`following`). A new chat
 * about an app asks what should change in it, and the words sent say which
 * page and app are open (operator-view.ts `onPage`). With `from`, it draws
 * its entries past that seq too, so a link to an old entry (`#row-<entry>`,
 * updates.ts `chatAt`) finds it on the page.
 */
export let chatPage = async (
  env: Env,
  space: Space,
  who: Who,
  open: string,
  side: Beside | Promise<Beside> = {},
  chosen?: string | null,
  from?: number,
  c: Clock = clock(),
) => {
  let [chat, beside] = await Promise.all([
    chatParts(env, space, who, open, side, chosen, from),
    side,
  ])
  if (chat instanceof Response) return chat
  return c.measure('render', () => talkPage(env, space, who, beside, chat))
}

// What a chat draws, or where its address sends the person: the conversation
// as its page holds it.
let chatParts = async (
  env: Env,
  space: Space,
  who: Who,
  open: string,
  side: Beside | Promise<Beside> = {},
  chosen?: string | null,
  from?: number,
  lists = reading(env, space, who),
): Promise<Response | TalkPage> => {
  let at = managePath('operator', space.slug)
  // The space's address opens the person's one conversation, and a new chat
  // only until they have one (T-141349).
  // Their lists are read with every conversation, at once with it, and
  // never hold it back (`reading`).
  let [talked, newcomer, { mentions }, alerting, declined, beside] =
    await Promise.all([
      lists.listing.then((l) =>
        conversationOf(env, space, who, at, open == 'new' ? '' : open, {
          updates: true,
          mentions: l.mentions ?? null,
          ...from != null && Number.isFinite(from) ? { from } : {},
        })
      ),
      who.person ? directoryOf(env.STORE).newcomer(who.person) : false,
      lists.listing,
      who.person ? directoryOf(env.STORE).alerts(who.person) : null,
      who.person ? directoryOf(env.STORE).alertsDeclined(who.person) : null,
      side,
    ])
  let listed = await lists.drawn()
  let news = talked.updates!
  // Their one conversation, as the store names it: what an empty `open` asks
  // for (operator-host.ts `/operator/conversation`).
  let root = talked.root
  // The person's one conversation is at the space's address, and its own
  // address sends them there, as links to it from before still do.
  if (open == root && talked.title) {
    let home = new URL(chatPath(space.slug), url(env))
    if (chosen) home.searchParams.set('app', chosen)
    if (from != null) home.searchParams.set('from', String(from))
    return new Response(null, {
      status: 303,
      headers: { location: home.pathname + home.search },
    })
  }
  if (open == 'new' && talked.title) open = root
  let fresh = open == 'new'
  let first = beside.name?.trim().split(/\s+/)[0]
  let follows = following(!!newcomer)
  let app = chosen ? beside.apps?.find((a) => a.slug == chosen) : undefined
  // This page's address, which the words written on it name.
  let shown = open == root ? 'new' : open
  let here = app
    ? aboutPath(space.slug, app.slug, shown)
    : chatPath(space.slug, shown)
  let operator = space.operator
  let welcome: [string, string] = [
    `What can I do for you${first ? `, ${first}` : ''}?`,
    `Ask ${operator} to make an app, change one, or find something out. You can send a photo or a document too.`,
  ]
  let greeting = !fresh
    ? hello(
      'This chat is not here',
      `It may have been removed. Your older chats are listed in Manage, with ${operator}’s settings.`,
    )
    : app
    ? hello(
      appQuestion(app),
      `Tell ${operator}, and watch it change beside this chat.`,
      welcome,
    )
    : hello(...welcome, welcome)
  let waysToStart = fresh && h(
    'div',
    { class: 'Talk_Starts', role: 'group', 'aria-label': 'Ways to start' },
    starts(operator, beside.apps),
  )
  // The box, where the page has one (operator-box.ts): on a helper's page
  // the words still go to the person's conversation. Each conversation keeps
  // its own draft.
  let boxed = fresh || !!talked.title
  let chat = chatPath(space.slug, shown)
  let canvasSlot: CanvasSlot | undefined = who.person && boxed
    ? {
      here: chat,
      at: `https://${spaceHost(env, space.slug)}`,
      operator,
      person: who.person,
      space: space.eid,
    }
    : undefined
  let asking: Asking = {
    at,
    here,
    operator,
    ...app ? { app: { slug: app.slug, title: app.title } } : {},
    ...talked.helper ? { to: chatPath(space.slug) } : {},
    inline: fresh,
    base: url(env),
    request: crypto.randomUUID(),
    count: COUNT,
    reads: READ,
  }
  let place = 'operator:' + (talked.begun || open)
  let reach = !talked.helper && !!beside.ways
  let happening = talked.aside ?? { turn: null, helpers: [] }
  let title = fresh ? `Message ${operator}` : talked.title || 'Not here'
  let skip: [string, string] = fresh || talked.title
    ? ['#ask', 'Skip to the message box']
    : ['#content', 'Skip to content']
  return {
    // The chat is the Operator's, an app open beside it or not.
    title,
    ...talked.helper
      ? {
        back: backOut({
          ...talked.helper.parent,
          href: talked.helper.parent.eid == root
            ? chatPath(space.slug)
            : talked.helper.parent.href,
        }),
        heading: helperTitle(talked.title, talked.aside?.self),
      }
      : {},
    status: fresh || talked.title ? 200 : 404,
    waiting: news.waiting,
    current: [shown, talked.task],
    here,
    listed,
    column: true,
    skip,
    main: [
      // The conversation is drawn by the Builder object (operator-view.ts
      // `talk`).
      newcomer ? keepCard(here) : null,
      talked.html ? column(talked.html) : column('', greeting),
      // the one menu every line's time opens
      h(EntryMenu, {}),
      fresh
        ? h('template', { 'data-talk-starts': '' }, app && waysToStart)
        : null,
      !app && waysToStart,
      fresh || talked.title
        ? alertsOffer(
          at,
          who.person ? pushKey(env) : null,
          alerting == 'push',
          waitsOf(listed ?? []) + news.needs,
          !!declined,
        )
        : null,
      boxed
        ? h(
          'div',
          { class: 'Talk_Ask', 'data-ask': '' },
          h(Ask, { asking, place }),
        )
        : null,
    ],
    // What it is doing now and the helpers it set going, at the top of the
    // aside (operator-aside.ts), and below them the ways to reach it
    // (operator-ways.ts), but on a helper's page, which is about the helper;
    // and their summary on the bar's button to it.
    aside: talked.aside || beside.ways
      ? h(Aside, {
        aside: talked.aside ?? { turn: null, helpers: [] },
        now: Date.now(),
        reach: reach && h(Reaching, { space, ways: beside.ways!, here }),
      })
      : undefined,
    mark: [
      h(Icon, { of: icons['panel-right'] }),
      h(Glance, { aside: happening }),
    ],
    asideDescription: glanceOf(happening).label,
    script: chatScript(
      (name) => asset(env, name),
      talked.aside ?? { turn: null, helpers: [] },
      at,
      who,
      space,
      open,
      root,
      boxed ? { asking, place } : null,
      follows,
      talked.standing,
      !!speechOf(env),
      asking.request,
      mentions,
    ),
    chat,
    app,
    canvasSlot,
    canvas: app && who.person
      ? canvasOf(env, space, who.person, beside, app)
      : undefined,
  }
}

// The app beside the chat as its view draws it (@yaks/platform/app-canvas-view):
// its head and live preview from the side's row of it, which the page carries,
// and what it is made of once the page graph's read of it is in.
let canvasOf = (
  env: Env,
  space: Space,
  person: string,
  beside: Beside,
  app: MarkedApp,
) => {
  let view: CanvasRoot = {
    at: `https://${spaceHost(env, space.slug)}`,
    operator: space.operator,
    app,
    person,
    space: space.eid,
  }
  let rows = appRows(person, space.eid, beside.apps ?? [])
  return [
    appCanvas(view, undefined, canvasAttrs(view)),
    h('script', {
      type: 'application/json',
      'data-page-graph': '',
      dangerouslySetInnerHTML: { __html: drawnRows(person, rows) },
    }),
  ]
}

let updateColumn = (space: Space, who: Who) => ({
  class: 'Talk_Column Updates',
  'data-inbox-actions': '',
  'data-inbox-scope': who.person,
  'data-inbox-home': space.slug,
})

/** Updates from the Operator (updates.ts), beside the chat app's side, or
 * with `dismissed` the notices the person dismissed. `opened` says the
 * person opened them, rather than the page being fetched ahead. */
export let updatesPage = async (
  env: Env,
  space: Space,
  who: Who,
  side: Beside | Promise<Beside> = {},
  dismissed = false,
  opened = true,
  c: Clock = clock(),
) => {
  // Opening them reads them, and the count beside them goes with it. The
  // rows of their servers' lists that wait on them are here too, before
  // their Updates.
  let lists = reading(env, space, who)
  let [news, views, , put, friends, chat, beside] = await Promise.all([
    updatesOf(env, space, who, opened && !dismissed),
    Promise.resolve(side).then((beside) => visitsOf(env, beside.apps ?? [])),
    lists.listing,
    dismissed ? dismissedOf(env, space, who) : undefined,
    dismissed ? undefined : friendsHere(env, space, who).catch((e) => {
      caught(e, { request: 'friends here', space: space.slug })
      return undefined
    }),
    dismissed ? undefined : chatBeside(env, space, who, side, lists),
    side,
  ])
  let listed = await lists.drawn()
  if (put) {
    return c.measure('render', () =>
      talkPage(env, space, who, beside, {
        title: `Dismissed updates from ${space.operator}`,
        status: 200,
        waiting: news.updates.filter((u) => u.needs).length,
        listed,
        current: ['updates'],
        here: talkPath('updates', space.slug) + '?dismissed',
        skip: ['#content', 'Skip to content'],
        main: h(
          'div',
          updateColumn(space, who),
          dismissedUpdates(env, space, put, beside.apps),
        ),
      }))
  }
  let here = talkPath('updates', space.slug)
  let at = managePath('operator', space.slug)
  return c.measure('render', () =>
    talkPage(env, space, who, beside, {
      title: 'Updates',
      status: 200,
      waiting: news.updates.filter((u) => u.needs).length,
      listed,
      current: ['updates'],
      here,
      skip: ['#content', 'Skip to content'],
      main: h(
        'div',
        updateColumn(space, who),
        updates(
          env,
          space,
          news,
          listed ? besides(listed, at, here, true) : later('waits'),
          beside.apps,
          views,
          friends,
          who.person ?? '',
        ),
      ),
    }, chat ? [chat] : []))
}

// The space's Updates as a view of a page opened at another of its views:
// their cards drawn in the browser from the tab's page graph (updates.ts
// `updatesLater`), their lists put in their slot with the page's.
let updatesBeside = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  listed: Listed[] | null,
): TalkPage => {
  let at = managePath('operator', space.slug)
  let here = talkPath('updates', space.slug)
  return {
    title: 'Updates',
    status: 200,
    waiting: 0,
    listed,
    current: ['updates'],
    here,
    skip: ['#content', 'Skip to content'],
    main: h(
      'div',
      updateColumn(space, who),
      updatesLater(
        env,
        space,
        listed ? besides(listed, at, here, true) : later('waits'),
        who.person ?? '',
        ownSpace(space, who, beside),
      ),
    ),
  }
}

// Whether `space` is the person's own, which their Updates there say their
// friends on yaks.app now in (friends.ts `friendsHere`): the one they own
// and open first, else the first they own.
let ownSpace = (space: Space, who: Who, beside: Beside) => {
  let owned = (beside.spaces ?? []).filter((s) => s.owner)
  return who.role == 'owner' &&
    (owned.find((s) => s.own) ?? owned[0])?.eid == space.eid
}

// Every space's Updates as a view of a page opened at another of its views:
// their cards drawn in the browser from the tab's page graph (updates.ts
// `allLater`), for each space the side offers.
let allBeside = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
): TalkPage => {
  let here = allAt(space)
  return {
    title: 'All updates',
    status: 200,
    waiting: 0,
    listed: null,
    current: ['all'],
    here,
    skip: ['#content', 'Skip to content'],
    main: h(
      'div',
      updateColumn(space, who),
      allLater(
        env,
        (beside.spaces ?? []).map(({ eid, slug, title, operator }) => ({
          eid,
          slug,
          title,
          operator: operator ?? space.operator,
        })),
        who.person ?? '',
      ),
    ),
  }
}

// The person's one conversation in the space as a view of a page opened at
// another of its views; none where it could not be read, which leaves the
// page as it was.
let chatBeside = async (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside | Promise<Beside>,
  lists?: ReturnType<typeof reading>,
): Promise<TalkPage | undefined> => {
  let chat = await chatParts(
    env,
    space,
    who,
    'new',
    beside,
    undefined,
    undefined,
    lists,
  ).catch((e) => {
    caught(e, { request: 'chat beside', space: space.slug })
    return undefined
  })
  return chat instanceof Response ? undefined : chat
}

/** The person's Updates from every space's Operator together
 * (updates.ts `allUpdates`), beside the chat app's side of `home`, the
 * space they came from. Opening them reads them, in every space, where
 * `opened` says the person did. `apps` are each space's the person may
 * open, by slug. */
export let allUpdatesPage = async (
  env: Env,
  home: Seat,
  seats: Seat[],
  side: Beside | Promise<Beside>,
  apps: Promise<Map<string, Apps>>,
  opened = true,
  c: Clock = clock(),
) => {
  let { space, who } = home
  let lists = reading(env, space, who)
  let [news, shelves, , chat, beside] = await Promise.all([
    updatesAcross(env, seats, { seen: opened }),
    apps,
    lists.listing,
    chatBeside(env, space, who, side, lists),
    side,
  ])
  for (let { space, error } of news.missed) {
    caught(error, { request: 'all updates', space: space.slug })
  }
  let listed = await lists.drawn()
  let here = allAt(space)
  return c.measure('render', () =>
    talkPage(env, space, who, beside, {
      title: 'All updates',
      status: 200,
      waiting: news.updates.filter((u) => u.needs && u.space.eid == space.eid)
        .length,
      listed,
      current: ['all'],
      here,
      skip: ['#content', 'Skip to content'],
      main: h(
        'div',
        updateColumn(space, who),
        allUpdates(
          env,
          news,
          shelves,
          news.missed.map((m) => m.space),
          who.person ?? '',
        ),
      ),
    }, chat ? [chat] : []))
}

/** A space's Matches (@yaks/platform/operator-matches-view), beside the
 * chat app's side: the rounds to pick in, or with `?round=` one round's next
 * pair. The view is drawn from the row the Operator's store answers, which
 * the page carries for the browser to draw again as it moves. */
export let matchesPage = async (
  req: Request,
  env: Env,
  space: Space,
  who: Who,
  beside: Beside = {},
) => {
  let { matchesOf } = await import('./matches.ts')
  let round = new URL(req.url).searchParams.get('round') ?? ''
  let lists = reading(env, space, who)
  let [read, news] = await Promise.all([
    matchesOf(env, space, who, round ? { round } : {}),
    updatesOf(env, space, who),
    lists.listing,
  ])
  let person = who.person ?? ''
  let view: MatchesView = {
    person,
    space: { eid: space.eid, slug: space.slug, operator: space.operator },
    round,
  }
  return talkPage(env, space, who, beside, {
    title: 'Pick between drafts',
    status: 200,
    waiting: news.updates.filter((u) => u.needs).length,
    listed: await lists.drawn(),
    current: ['updates'],
    here: matchesAt(space, round),
    skip: ['#content', 'Skip to content'],
    main: h(
      'div',
      { class: 'Talk_Column Updates' },
      h(
        'div',
        {
          'data-view': 'matches',
          'data-matches-view': JSON.stringify(view),
        },
        matchesView(view, read),
        h('script', {
          type: 'application/json',
          'data-page-graph': '',
          dangerouslySetInnerHTML: {
            __html: drawnRows(person, [matchesRow(space.eid, round, read)]),
          },
        }),
      ),
    ),
  })
}

// The chat app's script: the box mounted over what the server drew
// (operator-box.ts), its words the person's drafts and where they and Stop
// go, talking instead of typing, and the conversation kept current from its
// row in the tab's page graph (@yaks/platform/operator-talk), each step's
// lines drawn from the entries its frame sends (operator-talk.ts) and what it
// says aloud said to a person who talked. `boxOf` is the box, where the page has one; `paid` is whether the
// platform's speech is on, for a browser that has none of its own. Its
// modules are imported at their bytes' addresses (`file`), which a browser
// keeps for good, so opening the page again asks for none of them.
let chatScript = (
  file: (name: string) => string,
  now: Asided,
  at: string,
  who: Who,
  space: Space,
  open: string,
  root: string,
  boxOf: { asking: Asking; place: string } | null,
  follows: Follows,
  standing: string,
  paid: boolean,
  visit: string,
  mentions?: string,
) =>
  `<script type="module" data-operator-chat="${visit}">
import { follow } from '${file('follow.js')}'
import { frames } from '${file('frames.js')}'
import { asideHtml, browserDrafts, covers, dates, glanceHtml, helperHtml, leaving, long, markHtml, menus, mountAsk, mountTalk, operatorAt, ordered, pageDrafts, pageTalk, selfHtml, showing, sleep, turnHtml } from '${
    file('_talk.js')
  }'
import words from '${file('_words.js')}'
import { voice } from '${file('voice.js')}'
// Imports may arrive after a second navigation has already replaced this page,
// and a conversation standing hidden as one of its page's views starts when
// a press first shows it, and runs on while another view shows
// (@yaks/platform/talk-views).
let started = document.querySelector('script[data-operator-chat="${visit}"]:not([hidden] *)')
if (started) {
started.setAttribute('data-started', '')
let signal = leaving(document)
let timers = new Set()
let cancel = (id) => { clearTimeout(id); timers.delete(id) }
let after = (fn, ms) => {
  if (signal.aborted) return
  let id = setTimeout(() => { timers.delete(id); fn() }, ms)
  timers.add(id)
  return id
}
let open = ${JSON.stringify(open)}
let root = ${JSON.stringify(root)}
let chats = ${JSON.stringify(chatPath(space.slug, ''))}
menus(document, signal)
let box = document.querySelector('[data-conversation]')
// An id in a line drawn here opens where the person's server says
// (\`mentions\`), as it does in the lines the page came drawn with.
let mentions = ${JSON.stringify(mentions ?? '')}
// The conversation, mounted over what the server drew (operator-talk.ts): it
// stays at the newest line until the person scrolls up to read, when Newest
// shows and takes them back; earlier lines than the page holds are read when
// they ask for them. Where the page keeps a layer over it (the side's
// \`#menu\`, the app's \`#app\` on a phone) is public/follow.js's.
let content = document.getElementById('content')
follow(globalThis, box, content, signal)
// How long the page waits on its door before giving up and asking again, so
// a request the network holds unanswered fails in seconds.
let WAIT = 10_000
// What the page says goes under its box (\`boxed\`, mounted once its drafts are).
let boxed
let said = (e) => { if (!signal.aborted) boxed?.set({ said: e.message }) }
// The person's drafts in the Operator's store, held in the tab's page graph
// (@yaks/platform/operator-drafts): heard as each change lands, from this
// page or another, and answered again whenever the page graph's socket opens
// again. They are never read on a timer: what is typed here is kept on the
// device and written whether or not a read answered.
// While its socket cannot reach the store, the page says the draft is kept.
let KEPT = 'Your draft is kept on this device until syncing returns.'
let page = pageDrafts('${space.eid}', '${who.person}')
let store = operatorAt(location.origin + '${at}', signal)
let disconnected
let unheard = page.connected((open) => {
  cancel(disconnected)
  if (!open) disconnected = after(() => {
    if (!boxed?.said()) boxed?.set({ said: KEPT })
  }, WAIT)
  else if (boxed?.said() == KEPT) boxed.set({ said: '' })
})
// A draft sent with the words it holds is spent by the same request that
// takes the words in.
let submission
let draftClient = {
  ...page.store,
  apply: async (bundles) => {
    if (!submission || !bundles.some((row) => row.entity.eid == submission.get('request'))) {
      return page.store.apply(bundles).catch(() => { throw new Error('Your draft could not sync. A recovery copy is kept on this device.') })
    }
    let sent = submission; submission = undefined
    sent.set('draft', JSON.stringify(bundles))
    let response = await fetch('${at}', { method: 'POST', body: sent })
    if (!response.ok) {
      let answer = await response.json().catch(() => null)
      let refused = answer?.error?.message ?? answer?.message
      throw new Error((refused ? refused + ' ' : 'Your message was not sent. ') + 'Your words are back in the box; send them again.')
    }
    return response.json()
  },
}
let drafts = browserDrafts(draftClient, '${space.eid}:operator', { by: '${who.person}', report: said, line: page.line, writer: crypto.randomUUID() })
signal.addEventListener('abort', unheard, { once: true })
// The box (operator-box.ts), mounted over what the server drew: what is sent
// goes to this page's door, and Stop to its \`?stop=1\`; Newest, over it, takes
// the reader back to the newest line.
let given = ${script(boxOf)}
let selected = document.querySelector('[data-canvas-view]')?.dataset.canvasView
let selectedApp = selected && JSON.parse(selected).app || undefined
if (given && selectedApp?.slug != given.asking.app?.slug) {
  let { pathname, search } = location
  given.asking = { ...given.asking, here: pathname + search, app: selectedApp }
}
let place = given?.place
boxed = given && mountAsk({
  root: document.querySelector('[data-ask]'),
  ...given,
  drafts,
  onSend: (b) => send(b),
  onStop: (b) => stop(b),
  onNewest: () => talk.newest(),
})
document.addEventListener(${JSON.stringify(CANVAS_CHANGED)}, (e) => {
  boxed?.about(e.detail)
}, { signal })
let form = document.querySelector('#ask')
let taking = 0
let talk = mountTalk({
  box,
  words,
  person: '${who.person}',
  mentions,
  pane: () => content,
  onAway: (away) => boxed?.set({ away }),
  older: (take) => { taking = take; read().catch(said) },
  unfold: async (line) => {
    let start = talk.from()
    let response = await ask('${at}?talk=' + encodeURIComponent(talk.task()) + '&line=' + encodeURIComponent(line) + (start == null ? '' : '&from=' + encodeURIComponent(start)))
    if (!response.ok) throw new Error('A fold of line ' + line + ' could not be fetched: ' + response.status)
    return (await response.json()).lines
  },
})
// The page can be used from here: its box takes words and its lines follow.
// A load's timings read this mark (@yaks/platform/browser-visit).
if (!performance.getEntriesByName('yak-usable').length) performance.mark('yak-usable')
let heading = document.querySelector('[data-title]')
// The conversation's title is its view's (@yaks/platform/talk-views), which
// a press showing it again names the page with, and the bar's while it shows.
let titled = (title) => {
  let view = box.closest('[data-talk-view]')
  if (view) {
    let was = JSON.parse(view.dataset.talkView)
    view.dataset.talkView = JSON.stringify({ ...was, title, page: title + was.page.slice(was.title.length) })
  }
  if (!view?.hidden) heading.textContent = title
}
// The app open beside the chat (T-140509) is drawn again from the page graph
// as the Operator works on it (@yaks/platform/app-canvas-browser), and its
// live preview loaded again when the Operator changes it. With none open, the
// page goes to the one the Operator is making, by its address (D-146737): any
// it works on for a newcomer, else one it starts while they watch
// (\`following\`), each a frame's list.
let here = ${JSON.stringify(space.slug)}
let follows = ${JSON.stringify(follows)}
let canvas = () => document.querySelector('[data-app]')
frames(globalThis, document, signal)
let ours = (apps = []) => apps.filter((c) => !c.space || c.space == here).map((c) => c.app)
let changing = (o) => {
  let app = canvas(), shown = app?.querySelector('[data-frame=live]')
  if (shown && ours(o.changed).includes(app.dataset.app)) shown.src = shown.getAttribute('src')
  if (app) return
  let opening = follows ? ours(o[follows]) : []
  // Another view of the page showing, the person is not watching it work.
  if (opening.length && !box.closest('[hidden]')) {
    let to = new URL(location.href)
    to.searchParams.set('app', opening.at(-1))
    location.assign(to)
  }
}
// Approve or Decline on an approval's card acts in place: the card says what
// came of it at once, and is drawn again as its row now stands.
let APPROVAL = {
  done: 'Approved and done.',
  declined: 'Declined. Nothing was done.',
  failed: 'Approved, but it could not be done.',
  used: 'This was answered already.',
  expired: 'This waited too long. Ask again if you still want it.',
  gone: 'What this was for changed or is gone. Ask again.',
  theirs: 'Only the person it is for can answer this.',
}
document.addEventListener('click', async (event) => {
  let button = event.target.closest?.('[data-approval] [data-act]')
  if (!button) return
  let card = button.closest('[data-approval]')
  let said = card.querySelector('[data-approval-status]')
  let buttons = card.querySelectorAll('[data-act]')
  for (let b of buttons) b.disabled = true
  said.textContent = button.dataset.act == 'approve' ? 'Approving…' : 'Declining…'
  try {
    let response = await fetch('${at}?approval', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approval: card.dataset.approval, digest: card.dataset.digest, act: button.dataset.act }),
    })
    let answer = await response.json()
    if (signal.aborted) return
    if (!response.ok) throw new Error(answer?.message ?? 'That could not be answered. Try again.')
    said.textContent = [APPROVAL[answer.state], (answer.state == 'failed' || answer.state == 'forbidden') && answer.said].filter(Boolean).join(' ')
    for (let b of buttons) b.hidden = true
  } catch (error) {
    if (signal.aborted) return
    said.textContent = error.message
    for (let b of buttons) b.disabled = false
  }
}, { signal })
document.addEventListener('submit', async (event) => {
  let contact = event.target.closest?.('[data-contact-form]')
  if (!contact) return
  event.preventDefault()
  let said = contact.querySelector('[data-contact-status]')
  said.textContent = 'Saving…'
  try {
    let response = await fetch(contact.action, { method: 'POST', body: new FormData(contact) })
    let answer = await response.json()
    if (signal.aborted) return
    if (!response.ok) throw new Error(answer?.message ?? 'Your contact could not be saved. Try again.')
    if (answer.pending) {
      contact.querySelector('[data-contact-code]').hidden = false
      contact.querySelector('[name=code]').focus()
      contact.querySelector('[type=submit]').textContent = 'Confirm number'
      said.textContent = answer.message
      return
    }
    said.textContent = 'Confirmed. Your Operator can text you here.'
    contact.querySelector('[type=submit]').disabled = true
  } catch (error) { if (!signal.aborted) said.textContent = error.message }
}, { signal })
// A read that had no answer in time, or one the platform failed, is asked
// again after a second, then two, four and eight: a deploy is a moment in
// which the edge answers 502 and the Builder restarts, and the page reads past
// it quietly (the reporter holds what it meets meanwhile). Only a read that
// failed through all of them is said.
let ask = async (url) => {
  for (let pause of [1000, 2000, 4000, 8000, null]) {
    signal.throwIfAborted()
    try {
      let response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(WAIT)]) })
      if (response.status < 500 || pause == null) return response
      response.body?.cancel()
    } catch (e) { if (signal.aborted || pause == null) throw e }
    await sleep(pause, signal)
  }
}
// The box is ready to type in.
form?.elements.say.focus()
// An ask another page typed for the person (public/edit.js: \`?say=\`) joins
// what they had typed here, and leaves the address so a reload adds nothing.
let typed = new URL(location.href).searchParams.get('say')
if (form && typed) {
  drafts.ready.then(() => { if (!signal.aborted) drafts.restore(place, typed) })
  let clean = new URL(location.href)
  clean.searchParams.delete('say')
  history.replaceState(history.state, '', clean)
}
let speech = form && voice({ button: form.querySelector('[data-voice]'), form, say: form.elements.say, at: '${at}', paid: ${paid}, said, signal })
let working = () => talk.working()
// The aside (operator-aside.ts), at the top of the pane at the page's right:
// the turn under way and the helpers (\`happening\`), each put in place as a
// frame tells it, shown while either is there, and how long each has lasted
// kept current every second. The bar's button to the pane, where it is not in
// sight, wears their summary, drawn again with each.
let happening = ${script(now)}
let aside = () => document.querySelector('[data-aside]')
let drawn = (html) => {
  let made = document.createElement('template')
  made.innerHTML = html
  return made.content.firstElementChild
}
let shown = () => {
  let a = aside()
  if (!a) return
  let helping = !!a.querySelector('[data-helping]').children.length
  let turn = !!a.querySelector('[data-turn] time')
  a.querySelector('[data-helpers]').hidden = !helping && !turn
  let reach = !!a.querySelector('[data-reach]')
  a.hidden = !helping && !reach && !turn && !happening.self
  for (let glance of document.querySelectorAll('[data-glance]')) {
    let next = drawn(glanceHtml(happening))
    glance.replaceWith(next)
    let open = next.closest('[data-aside-open]')
    open?.setAttribute('aria-description', next.dataset.label)
    open?.setAttribute('title', next.dataset.label)
  }
}
// Work that will take a while is when the page offers an alert for when it
// is done (alerts-browser.ts \`offer\`), once.
let longSaid = false
let lengthy = () => {
  if (longSaid || happening.self || !long(happening, Date.now())) return
  longSaid = true
  document.querySelector('[data-alerts-offer]')?.setAttribute('data-due', '')
  document.dispatchEvent(new Event('yak-long-work'))
}
let turning = (turn) => {
  if (happening.self) return
  happening.turn = turn ?? null
  let at = aside()?.querySelector('[data-turn]')
  if (at) at.replaceWith(drawn(turnHtml(happening.turn)))
  shown()
}
// A helper's row, put in place wherever the page draws it (operator-aside.ts
// \`Work\`): in the Helpers box, where it runs folded away, and in the step
// that started it. On its own page, whose Helpers box lists only the helpers
// it started, it is the aside's own row (\`Self\`), the pip in the bar's
// title and the summary's dot.
let helped = (helper) => {
  let at = '[data-help="' + helper.session + '"]'
  // The Helpers box folds where it runs; a fold pressed open stays open.
  let html = (row) => {
    let fold = !!row?.closest('[data-helping]')
    return helperHtml(helper, Date.now(), fold, !!row?.querySelector('[data-fold]')?.open)
  }
  if (helper.session == talk.task()) {
    happening.self = helper
    document.querySelector('[data-self] [data-help]')?.replaceWith(drawn(selfHtml(helper)))
    let mark = document.querySelector('[data-title] [data-mark]')
    if (mark) mark.innerHTML = markHtml(helper.standing)
    return shown()
  }
  for (let row of document.querySelectorAll(at)) row.replaceWith(drawn(html(row)))
  happening.helpers = ordered([helper, ...happening.helpers.filter((h) => h.session != helper.session)])
  show()
  let list = aside()?.querySelector('[data-helping]')
  if (!list) return
  if (!list.querySelector(at)) list.prepend(drawn(helperHtml(helper, Date.now(), true)))
  shown()
  lengthy()
}
// Every time on the page is the kit's (\`Time\`), said again in the person's
// clock and zone each second, so a duration counts up, and at once after
// anything is drawn here.
let datesBeat = setInterval(() => (dates(document), lengthy()), 1000)
// The yak beside the box shows what the Operator is doing, and once the
// conversation rests, what its helpers are (operator-aside.ts \`showing\`,
// over the helpers the aside lists): a pose he holds while it lasts (mascot.ts
// \`MOVES\`), a loop played once as the work ends, and his waiting otherwise
// (idle.js).
let moves = ${JSON.stringify(MOVES)}
let yak = form?.querySelector('[data-idle]')
let talking = 'idle', last = 'idle'
let show = () => {
  let now = showing(talking, happening.helpers)
  if (!yak || now == last) return
  last = now
  let move = moves[now]
  if (move?.pose) return void (yak.dataset.pose = move.pose)
  delete yak.dataset.pose
  if (move) yak.dispatchEvent(new CustomEvent('idle', { detail: move.loop }))
}
let doing = (now = 'idle') => {
  boxed?.set({ busy: working(), session: talk.task() })
  talking = now
  show()
}
let redrawn = () => doing(talk.doing())
redrawn()
// What the page puts in the box is the person's draft, as if they typed it:
// a way to start's words, for them to finish, and a line quoted from its
// menu after what they had (the kit's menu, which also copies a line and its
// link).
let typing = (text) => {
  drafts.type(place, text)
  boxed.focus(true)
}
document.addEventListener('click', (e) => {
  let start = e.target.closest('[data-say]')
  if (start && boxed) typing(start.dataset.say)
}, { signal })
// The one menu every line's time opens (operator-draw.ts \`EntryMenu\`),
// filled from the time that opened it: the line's id, its words, and the
// entries Hide or Restore changes, which a line of none goes without.
let entry = {}
let actions = document.getElementById('entry-menu')
actions?.addEventListener('menu-open', ({ detail }) => {
  entry = detail.dataset
  for (let part of actions.querySelectorAll('[data-entry-hides]')) part.hidden = !entry.archiveEntries
  let archive = actions.querySelector('[data-entry-archive]')
  archive.disabled = false
  archive.textContent = entry.restore == 'true' ? 'Restore' : 'Hide'
}, { signal })
document.addEventListener('click', async (e) => {
  let action = e.target.closest?.('[data-entry-copy], [data-entry-quote], [data-entry-link]')
  if (!action) return
  let text = entry.entryText ?? ''
  let link = new URL(location.href ?? '${at}', location.origin)
  if (entry.entryId) link.hash = 'row-' + entry.entryId
  try {
    if ('entryQuote' in action.dataset && boxed) {
      let quote = '> [Quoted entry](' + link.href + ')\\n' + text.split('\\n').map((line) => '> ' + line).join('\\n')
      typing([drafts.text(place), quote].filter(Boolean).join('\\n\\n') + '\\n\\n')
    } else await navigator.clipboard.writeText('entryCopy' in action.dataset ? text : link.href)
  } catch (error) { said(error) }
}, { signal })
// Archive and restore change marks, keeping the words on the page and in search.
document.addEventListener('click', async (e) => {
  let button = e.target.closest?.('[data-entry-archive]')
  if (!button || !entry.archiveEntries) return
  button.disabled = true
  try {
    let restore = entry.restore == 'true'
    await store.apply(entry.archiveEntries.split(',').map((eid) => ({ entity: { eid }, archived: restore ? null : {} })))
      .catch(() => { throw new Error('These entries could not be changed. Try again.') })
    await read()
  } catch (error) { if (!signal.aborted) { said(error); button.disabled = false } }
}, { signal })
// Stop, pressed in the box, takes effect on the page at once; the Operator's
// own word follows.
let stop = async (b) => {
  let task = b.entity.eid
  if (!task) return
  let undo = talk.stopped()
  doing('idle')
  turning(null)
  try {
    let response = await fetch('${at}?stop=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task }) })
    if (signal.aborted) return
    if (!response.ok) throw new Error('It could not be stopped. Try again.')
    boxed.set({ said: '' })
  } catch (error) {
    if (signal.aborted) return
    undo()
    redrawn()
    said(error)
  }
}
// The conversation, heard in the tab's page graph while its view shows,
// whose socket says where its person is: whether this tab is in view and
// focused, so their Operator knows to tell them here, notify them, or reach
// them elsewhere (whereabouts.ts). While Updates shows in its place, the tab
// is not on the Operator.
let conversation = pageTalk('${space.eid}', '${who.person}', open == 'new' ? undefined : open, { in: box })
// Where the conversation stood when the page last drew it (operator-host.ts
// \`standingAt\`), until a step is heard; its row says where it stands each
// time the page graph's watch of it is answered whole, and the page reads it
// again only when that moved.
let standing = ${JSON.stringify(standing)}
// One read at a time; a step heard during one reads once more after it
// when what the read answered predates the line the step put in place
// (each step says where its session stands, \`at\`).
let reading, again = false, heard = []
let behind = (got) => again || heard.some((at) => !covers(got.standing, at))
// Keep reading from where this page began, so a growing transcript never
// slides its oldest displayed entries out of the next read.
let from = talk.from()
// Words of theirs the page showed are never taken off it: one a read left
// out stays in its place, and the tracker hears of it, unless a step heard
// during the read came after what it answered, which the next read covers,
// or its entry was removed from the store (operator-remove.ts), which takes
// it off the page too.
let left = async (ids) => {
  let kept = await store.query('.entity.eid=' + ids.join(',')).catch((error) => {
    if (!signal.aborted) globalThis.reportError?.(error)
  })
  if (!kept || signal.aborted) return
  let there = new Set(kept.filter((b) => !b.tombstone).map((b) => b.entity.eid))
  talk.removed(ids.filter((id) => !there.has(id)))
  for (let id of ids) if (there.has(id)) globalThis.reportError?.(new Error('The Operator chat page left out words of the person it had shown: ' + id))
  redrawn()
}
let read = async () => {
  if (signal.aborted || open == 'new') return
  if (reading) return void (again = true)
  reading = (async () => {
    let got
    do {
      again = false, heard = []
      let response = await ask('${at}?talk=' + encodeURIComponent(open) + (from == null ? '' : '&from=' + encodeURIComponent(from)) + (taking ? '&take=' + taking : ''))
      if (!response.ok) throw new Error('This page could not be brought up to date. Your conversation is saved; reload to try again.')
      got = await response.json()
      if (signal.aborted) return
      standing = got.standing
      if (got.html) {
        let missing = talk.read(got.html)
        redrawn()
        if (missing.length && !behind(got)) await left(missing)
        if (signal.aborted) return
      }
      from ??= talk.from()
      if (got.aside && aside()) {
        // The ways to reach the Operator are drawn once, and stay below the helpers.
        let reach = aside().querySelector('[data-reach]')
        happening = got.aside, aside().replaceWith(drawn(asideHtml(happening)))
        if (reach) aside().querySelector('[data-helpers]').after(reach)
        shown(), show()
      }
      if (got.title) titled(got.title)
      dates(document)
    } while (behind(got))
  })()
  try { await reading } finally { reading = undefined }
}
// Each step the Operator takes arrives on the conversation's row as the
// lines it changed, each as the entries it draws, which the conversation
// draws as the server does (operator-talk.ts); a conversation the page has
// not drawn yet (a request just taken up) reads the page again, and another
// one's step is not this page's.
let hear = (o) => {
  changing(o)
  if (!talk.task()) return void read().catch(said)
  if (o.refresh) return void read().catch(said)
  if (talk.task() != o.task) return
  if ('turn' in o) turning(o.turn)
  if (o.helping) helped(o.helping)
  if (o.said) speech?.tell(o.said)
  standing = undefined
  talk.heard(o)
  dates(document)
  if (reading) heard.push(o.at)
  doing(o.doing)
}
// The conversation's row (@yaks/platform/operator-talk): answered whole as
// its watch opens, again after a reconnect (\`opened\`), with where the
// conversation stands; then each step (\`n\` one more; one skipped reads the
// page again), and a reply's words as written so far, drawn as a settled
// reply until the step that wrote it lands.
let answer, stepped = 0, replying = ''
let unhear = conversation.hear((told) => {
  if (told.opened != answer) {
    answer = told.opened
    stepped = told.n
    if (told.standing == null || told.standing !== standing) read().catch(said)
  } else if (told.n > stepped) {
    let skipped = told.n > stepped + 1
    stepped = told.n
    if (told.step) hear(told.step)
    if (skipped) read().catch(said)
  }
  if (!told.typing) return void (replying = '')
  if (told.typing == replying || talk.task() != told.writing) return
  replying = told.typing
  talk.typed(replying)
  doing('writing')
})
// While the page graph's socket is closed the page reads its conversation
// while it works; opening again may follow a deploy, which the page then
// takes at its next link (public/deploy.js).
let live = false, opened = false
let polling = false
let poll = async () => {
  if (signal.aborted || live || polling || !working()) return
  polling = true
  try { await read() } catch (e) { said(e) }
  finally { polling = false; if (working()) after(poll, 2000) }
}
// It says at once whether it is open, which only a later close polls on.
let known = false
let unlive = conversation.connected((open) => {
  live = open
  if (!open) return void (known && poll())
  if (opened) dispatchEvent(new Event('yak-reconnect'))
  opened = true
})
known = true
// Words sent from the box are drawn in the conversation at once, under the
// id the box chose for them (\`talk.sent\`), and go to this page's door with
// the rest of its form, the files held with them, in the request that spends
// their draft, so the draft is spent only once the door has taken them in.
// Words it did not take come off the conversation and are back in the box,
// with their files, and the page says why. Words for the person's
// conversation sent from another page open it once the door has them.
let send = async (b) => {
  let request = b.entity.eid
  submission = new FormData(form)
  submission.set('request', request)
  // The tab of the app beside the chat in front of them, and which preview.
  let made = document.querySelector('input[name=made]:checked')
  let preview = document.querySelector('input[name=preview]:checked')?.value ??
    document.querySelector('[data-frame]')?.dataset.frame
  if (made) submission.set('made', made.value)
  if (preview) submission.set('preview', preview)
  submission.set('say', b.content.body)
  let files = submission.getAll('file').filter((f) => f.name)
  let here = talk.task() == root
  let back = here && talk.sent(request, b.content.body, files.map((f) => f.name))
  if (here) boxed.hold([]), talk.newest()
  boxed.set({ sending: true, said: here ? '' : 'Sending…' })
  try {
    let saved = await drafts.spend(place, [{ entity: { eid: request } }])
    if (signal.aborted) return
    if (!saved) {
      if (back) back(), boxed.hold(files)
      if (!boxed.said() || boxed.said() == 'Sending…') said(new Error('Your message was not sent. Your words are back in the box; send them again.'))
      return
    }
    boxed.hold([])
    boxed.set({ request: crypto.randomUUID(), said: '' })
    if (here) return void (read().catch(said), poll())
    let app = canvas()
    location.assign(chats + request + (app ? '?app=' + encodeURIComponent(app.dataset.app) : ''))
  } catch (error) {
    if (back) back(), boxed.hold(files)
    said(error)
  } finally { if (!signal.aborted) boxed.set({ sending: false }) }
}
signal.addEventListener('abort', () => {
  clearInterval(datesBeat)
  unhear()
  unlive()
  conversation.close()
  for (let id of timers) cancel(id)
  boxed?.close()
  talk.close()
  drafts.close()
}, { once: true })
}
</script>`
