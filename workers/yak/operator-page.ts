import type { Bundle } from '@yaks/graph'
import type { Env } from './env.ts'
import { directoryOf, type Reach, type Space } from './directory.ts'
import { reachOf } from './operator-reach.ts'
import { builderOf, SPACE } from './build-door.ts'
import { vouched, type Who } from './session.ts'
import { answered } from './meta.ts'
import { esc, type Picked, shell, spaceChoice } from './pages.ts'
import { url } from './host.ts'
import { chatPath, logoPath, managePath } from './route.ts'
import {
  keepFile,
  type Request as Intake,
  rootOf,
} from './operator-channels.ts'
import { mailFrom } from './post.ts'
import { parts } from './form.ts'
import { gathered } from './bytes.ts'
import { refuse } from './tool.ts'
import {
  CONSENT,
  handed,
  REPLIES,
  tell,
  type Texting,
  texts,
} from './operator-texts.ts'
import { given } from './operator-name.ts'
import { CallError } from '@yaks/tools/errors'
import {
  attached,
  PICTURES,
  reply,
  sidebar,
  talks,
  trouble,
  type Worked,
} from './operator-view.ts'
import { DOCUMENTS } from './documents.ts'
import { settings } from './phone-providers.ts'

// What the message box takes: up to COUNT files at a time, each up to SIZE
// (keepFile's ceiling), and the kinds the Operator reads (operator-channels.ts
// `fileText`, and Claude's own); a file of another kind is kept with the
// message, and the box says the Operator can't read it.
let COUNT = 10
let SIZE = 16 * 1000 * 1000
let READ = ['image/*', 'text/*', ...DOCUMENTS.map((d) => '.' + d)].join(',')

let shown = (number: string) =>
  number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')

// Where a person agrees to texts from the operator, or stops them. `from` is
// the number the Operator texts from (`settings(env, space.sender).number`),
// read from configuration, so the card names it with no call to the provider.
export let textsCard = (
  at: string,
  consent: Texting | null,
  from?: string,
) =>
  `<form class="Card Form" id="texts" method="post" action="${at}?texts=1">
<h2 class="Card_Title">Text messages</h2>
<p>Text your Operator about anything, and it answers by text. It also texts you when it finishes a change, needs an answer from you, or something about your space needs you, and apps you build can text you reminders. You can still use chat and email.</p>${
    consent
      ? `<p>Texts go to <b>${
        esc(shown(consent.number))
      }</b>; to text your Operator, ${
        from
          ? `text <a href="sms:${esc(from)}">${esc(shown(from))}</a>`
          : 'reply to the number your welcome text came from'
      }. You agreed on ${
        esc(new Date(consent.at).toLocaleDateString('en-US', {
          dateStyle: 'long',
          timeZone: 'UTC',
        }))
      }. <button class="Button Button-quiet" type="submit" name="stop" value="1">Stop texts</button></p>`
      : ''
  }
<label class="Form_Field">${
    consent ? 'Change your mobile number' : 'Mobile number'
  }<input class="Field" type="tel" name="number" autocomplete="tel" inputmode="tel" placeholder="269-555-0142"></label>
<label class="Choice" style="align-items:flex-start"><input type="checkbox" name="agreed" value="yes"><span>${
    esc(CONSENT).replace(
      /https:\/\/yaks\.app\/(terms|privacy)/g,
      '<a href="/$1">yaks.app/$1</a>',
    )
  }</span></label>
<p>Agreeing is not required to use yaks.app.</p>
<button class="Button" type="submit">Save</button><p role="status" data-status></p></form>`

// Where a space's people change what its Operator is called.
export let nameCard = (at: string, name: string) =>
  `<form class="Card Form" id="name" method="post" action="${at}?name=1">
<h2 class="Card_Title">Name</h2>
<p>What this Operator goes by. It introduces itself by this name and signs its letters with it.</p>
<label class="Form_Field">Name<input class="Field" name="name" value="${
    esc(name)
  }" maxlength="40" required autocomplete="off"></label>
<button class="Button" type="submit">Save</button><p role="status" data-status></p></form>`

export let operatorDoor = async (
  env: Env,
  space: Space,
  who: Who,
  path: string,
  args: unknown,
) => {
  let response = await builderOf(env, space.eid)(() =>
    new Request(`https://builder/operator/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SPACE]: space.eid,
        ...vouched(who),
      },
      body: JSON.stringify(args),
    })
  )
  if (!response.ok) throw await answered(response)
  return response.json()
}

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
  rows.map((row) => {
    let request = row.operator_request as Intake
    let doc = row.doc as { title?: string; body?: string }
    let answer = row.operator_answer as { text?: string } | undefined
    let failed = row.failed ?? row.bounced
    let files = request.files ?? []
    return `<div class="Talk_Thread"${
      answer || failed ? '' : ' data-pending'
    }><div class="Talk_Said"><div>${
      doc.body ? `<p class="Talk_You">${esc(doc.body)}</p>` : ''
    }${attached(row.entity.eid, files)}</div>${
      answer?.text ? reply(answer.text) : failed
        ? trouble(
          'Your request is kept, but the Operator could not finish it. Send it again to try once more.',
          failed,
        )
        : '<p class="Talk_Note">Your request is saved. The Operator will start on it soon.</p>'
    }${
      failed && answer
        ? trouble(
          'The answer could not be sent to you. It is kept here.',
          failed,
        )
        : ''
    }</div></div>`
  }).join('')

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
  if (q.has('name') && req.method == 'POST') {
    let form = await req.formData()
    try {
      let named = await directoryOf(env.STORE).christen(
        space,
        given(String(form.get('name') ?? '')),
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
    // Whichever page it is sent from, it goes to the person's conversation.
    let received = await operatorDoor(env, space, who, 'receive', {
      say: String(form.get('say') ?? ''),
      request: { channel: 'chat', files },
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
    if ((req.headers.get('upgrade') ?? '').toLowerCase() != 'websocket') {
      return new Response("This is the Operator page's WebSocket.", {
        status: 426,
      })
    }
    return watching(env, space, req, who)
  }
  // One conversation read again, with the list beside it.
  if (q.has('talk')) {
    let open = q.get('talk')!
    let [talked, items] = await Promise.all([
      conversationOf(env, space, who, at, open),
      workOf(env, space, who),
    ])
    if (!talked.title) {
      return Response.json({ message: 'That conversation is missing.' }, {
        status: 404,
      })
    }
    return Response.json({
      title: talked.title,
      task: talked.task,
      html: talked.html,
      side: sidebar(items, space.slug, [open, talked.task]),
    }, { headers: { 'cache-control': 'private, no-store' } })
  }
}

// The page's socket, carried to the Builder object with the kernel's vouch
// on it and nothing of the client's (build.ts `joining`, the same way).
let watching = (env: Env, space: Space, req: globalThis.Request, who: Who) =>
  builderOf(env, space.eid)(() => {
    let out = new Request('https://builder/operator/ws', req)
    for (let [h] of [...out.headers]) {
      if (h.startsWith('x-yak-')) out.headers.delete(h)
    }
    out.headers.set(SPACE, space.eid)
    for (let [h, v] of Object.entries(vouched(who))) out.headers.set(h, v)
    return out
  })

/** The Operator's work, newest first. */
export let workOf = async (env: Env, space: Space, who: Who) =>
  await operatorDoor(env, space, who, 'work', {}) as Worked[]

// One conversation, opened by its task or a request: its sessions as they
// ran (operator-view.ts `talk`), or the request alone while no session has
// taken it.
let conversationOf = async (
  env: Env,
  space: Space,
  who: Who,
  at: string,
  open: string,
) => {
  if (open == 'new') return { task: '', begun: '', title: '', html: '' }
  let { task, begun, title, html, waiting } = await operatorDoor(
    env,
    space,
    who,
    'conversation',
    { at, open },
  ).catch((e) => {
    if (e.status != 404) throw e
    return { task: '', begun: '', title: '', html: '', waiting: [] }
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
  let [consent, { pa, beyond }] = await Promise.all([
    textingOf(env, space, who),
    reachOf(directoryOf(env.STORE), space, who.person ?? ''),
  ])
  let address = mailFrom(space.slug, null, env)
  return `
<section class="Card"><p>${esc(space.operator)} is this space’s Operator. Ask ${
    esc(space.operator)
  } for a change in your apps, or send a PDF or a photo. Your space's plan covers its work.</p>${
    pa
      ? '<p>This is your own space, so its Operator can also work in your other spaces, with your role in each.</p>'
      : ''
  }${elsewhere(beyond, pa)}<p>You can also email ${
    esc(space.operator)
  } from any mail app: write to <a href="mailto:${esc(address)}">${
    esc(address)
  }</a> with what you want changed, and attach a PDF or a photo if you have one. Send it from the email address you sign in with; ${
    esc(space.operator)
  } answers by email.</p></section>
${talks(space.slug)}
${nameCard(at, space.operator)}
${textsCard(at, consent, settings(env, space.sender).number)}
${settingsScript}`
}

// Where else the Operator works and what it may do there, one sentence for
// all of it: the spaces it changes things in, then those it only looks at.
// Each space's owner sets that on its People page (pages.ts `operating`); on
// a person's own space it follows their role in each.
export let elsewhere = (beyond: Reach[], pa: boolean) => {
  if (!beyond.length) return ''
  let named = (rs: Reach[]) =>
    LIST.format(
      rs.map((r) =>
        `<a href="${managePath('home', r.space.slug)}">${
          esc(r.space.title || r.space.slug)
        }</a>`
      ),
    )
  let changes = named(beyond.filter((r) => r.role != 'viewer'))
  let looks = named(beyond.filter((r) => r.role == 'viewer'))
  let said = changes && looks
    ? `It can also change things in ${changes}, and look at ${looks} without changing anything.`
    : changes
    ? `It can also work in ${changes}, and change things there.`
    : `It can also look at ${looks}, but not change anything there.`
  return `<p>${said}${
    pa ? '' : ' Each space’s owner chooses this on its People page.'
  }</p>`
}

let LIST = new Intl.ListFormat('en', { type: 'conjunction' })

// The settings page's script: the name and the texts choice.
let settingsScript = `<script type="module">
for (let form of document.querySelectorAll('#texts, #name')) {
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

/**
 * One conversation with the Operator in its chat app, a page of its own
 * (route.ts `chatPath`): the conversations down the side, newest first, with
 * a way to start one; the conversation filling the page, what it is doing
 * now under it; and the box to write in at the foot, with Stop while it
 * works. `open` is a task, a request no task has taken yet, or `new`. Whose
 * Operator it is heads the side, the title and the greeting, and the side's
 * space selector over `spaces` opens another space's Operator.
 */
export let chatPage = async (
  env: Env,
  space: Space,
  who: Who,
  open: string,
  spaces: Picked[] = [],
) => {
  let at = managePath('operator', space.slug)
  let [talked, items] = await Promise.all([
    conversationOf(env, space, who, at, open),
    workOf(env, space, who),
  ])
  let fresh = open == 'new'
  let title = fresh ? `Message ${space.operator}` : talked.title || 'Not here'
  let named = space.title || space.slug
  let whose = `${space.operator}, ${named}’s Operator`
  let here = spaces.find((s) => s.slug == space.slug) ?? {
    slug: space.slug,
    title: space.title,
    owner: true,
    own: false,
    operator: space.operator,
    logo: logoPath(space),
  }
  return shell(
    env,
    `${esc(title)} · ${esc(space.operator)}`,
    null,
    fresh || talked.title ? 200 : 404,
    `<a class="Desk_Skip" href="#ask">Skip to the message box</a>
<div class="Talk">
<aside class="Talk_Side" id="menu" aria-label="Conversations">
<div class="Talk_Top"><a class="Talk_Brand" href="${
      url(env, managePath('home', space.slug))
    }"><img src="${
      url(env, '/yak.webp')
    }" width="28" height="28" alt="">Operator</a><a class="Button Button-quiet Talk_Close" href="#">✕ Close</a></div>
<div class="Talk_Whose"><p class="Talk_Of">The Operator of</p>${
      spaceChoice(
        here,
        spaces.some((s) => s.slug == space.slug) ? spaces : [here, ...spaces],
        (s) => chatPath(s.slug),
        '',
        (s) => s.operator ?? '',
      )
    }</div>
<a class="Button Talk_New" href="${chatPath(space.slug)}">+ Message ${
      esc(space.operator)
    }</a>
<nav class="Talk_Nav" aria-label="Your conversations" data-side>${
      sidebar(items, space.slug, [open, talked.task])
    }</nav>
<div class="Talk_Foot"><a href="${
      managePath('home', space.slug)
    }">Dashboard</a><a href="${at}">Operator settings</a></div>
</aside>
<div class="Talk_Main">
<header class="Talk_Bar"><a class="Button Button-quiet Talk_Menu" href="#menu" aria-label="Conversations">☰</a><div class="Talk_Heads"><h1 class="Talk_Head" data-title>${
      esc(title)
    }</h1><p class="Talk_Who">${esc(whose)}</p></div></header>
<div class="Talk_Column" data-conversation aria-live="polite">${
      talked.html ||
      (fresh
        ? `<div class="Talk_Hello"><h2>What would you like done in ${
          esc(named)
        }?</h2><p>You’re talking to ${esc(whose)}. Ask ${
          esc(space.operator)
        } for a change in the space’s apps, or send a document or a photo.</p></div>`
        : '<div class="Talk_Hello"><h2>This conversation is not here</h2><p>It may have been removed. Your other conversations are listed beside this one.</p></div>')
    }</div>
${fresh || talked.title ? composer(at) : ''}
</div>
</div>
${chatScript(at, who, space, open, talked.begun || open)}`,
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    'Talk_Page',
  )
}

// The box a person writes in, at the foot of the conversation: their words,
// the files going with them along its top (a gathering drop part,
// public/drop.js: picked, pasted or dropped anywhere on the box, each a
// preview or a chip to take back), Send, and Stop while the Operator works.
let composer = (at: string) =>
  `<form class="Talk_Box" id="ask" method="post" action="${at}" enctype="multipart/form-data">
<input type="hidden" name="request" value="${crypto.randomUUID()}">
<div class="Talk_Write Drop Drop-gather"><ul class="Drop_Chosen" aria-label="Files to send" aria-live="polite"></ul><textarea class="Field Talk_Field" name="say" placeholder="Message the Operator" aria-label="Message the Operator"></textarea>
<div class="Talk_Tools"><label class="Talk_Attach" title="Add images or documents, or paste or drop them here">＋ Add files<input class="Drop_File" type="file" name="file" multiple data-count="${COUNT}" data-size="${SIZE}" data-reads="${READ}" data-unread="The Operator can't read this kind of file. It is kept with your message."></label><p class="Drop_Said" role="status"></p><button class="Button Button-quiet Talk_Stop" type="button" data-stop>Stop</button><button class="Button Talk_Send" type="submit">Send</button></div></div>
<p class="Talk_Status" role="status" data-send-status></p></form>`

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
let open = ${JSON.stringify(open)}
let root = ${JSON.stringify(rootOf(space.eid, who.person ?? ''))}
let chats = ${JSON.stringify(chatPath(space.slug, ''))}
let box = document.querySelector('[data-conversation]')
let side = document.querySelector('[data-side]')
let heading = document.querySelector('[data-title]')
let form = document.querySelector('#ask')
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
  subscribe: (_q, hear) => {
    let stopped = false
    let timer
    let read = async () => {
      try { let response = await fetch(draftAt); if (response.ok && !stopped) hear((await response.json()).bundles) }
      catch (e) { status.textContent = 'Your draft is kept on this device until syncing returns.' }
      if (!stopped) timer = setTimeout(read, 2000)
    }
    read()
    return () => { stopped = true; clearTimeout(timer) }
  }
}
let drafts = browserDrafts(draftClient, '${space.eid}:operator', { by: '${who.person}', report: (e) => { status.textContent = e.message } })
// Each conversation keeps its own draft, and the box is ready to type in.
let place = ${JSON.stringify('operator:' + talk)}
if (form) { drafts.bind(form.elements.say, place); form.elements.say.focus() }
let said = (e) => { status.textContent = e.message }
let thread = () => box.querySelector('[data-task]')
let working = () => !!box.querySelector('[data-pending]')
// The yak beside what it is doing now takes the pose the words call for
// (mascot.ts), each of its files swapped for the same pose's.
let pose = (card, name) => {
  let yak = card.querySelector('[data-pose]')
  if (!yak || yak.dataset.pose == name) return
  for (let [el, at] of [[yak.querySelector('source'), 'srcset'], [yak.querySelector('img'), 'src']]) {
    el.setAttribute(at, el.getAttribute(at).replace('/' + yak.dataset.pose, '/' + name))
  }
  yak.dataset.pose = name
}
// The page follows the conversation down as it grows, unless the person has
// scrolled up to read.
let near = () => !globalThis.innerHeight || globalThis.innerHeight + globalThis.scrollY >= document.body.scrollHeight - 120
let follow = (was) => { if (was) globalThis.scrollTo?.(0, document.body.scrollHeight) }
// Enter sends, Shift+Enter starts a new line.
form?.elements.say.addEventListener('keydown', (e) => {
  if (e.key == 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit?.() }
})
// Stop takes effect on the page at once; the Operator's own word follows.
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-stop]')) return
  let card = thread()
  if (!card) return
  card.removeAttribute('data-pending')
  card.querySelector('[data-now]').textContent = 'Stopped.'
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
      if (got.html) redraw(box, got.html)
      side.innerHTML = got.side
      if (got.title) heading.textContent = got.title
      follow(was)
    } while (again)
  })()
  try { await reading } finally { reading = undefined }
}
let others
let list = () => {
  clearTimeout(others)
  others = setTimeout(async () => {
    let response = await fetch('${at}?talk=' + encodeURIComponent(open))
    if (response.ok) side.innerHTML = (await response.json()).side
  }, 500)
}
// Each step the Operator takes arrives on the socket as the lines it changed,
// put in place by id; a conversation the page has not drawn yet (a request
// just taken up) reads the page again, and another one's step reads the list.
let live = false
let hear = (frame) => {
  let o = frame.operator
  if (!o) return
  let card = thread()
  if (!card) return void read().catch(said)
  if (card.dataset.task != o.task) return void (o.typing || list())
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
    pose(card, 'typing')
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
  if (o.pose) pose(card, o.pose)
  card.toggleAttribute('data-pending', !!o.now)
  follow(was)
}
let listen = () => {
  let socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '${at}?live=1')
  socket.onopen = () => { live = true; read().catch(said) }
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
    if (thread()?.dataset.task != root) return void location.assign(chats + request)
    await read(); poll()
  } catch (error) { said(error) }
  finally { button.disabled = false }
})
follow(true)
listen()
</script>`
