import type { Bundle } from '@yaks/graph'
import type { Env } from './env.ts'
import { directoryOf, type Space } from './directory.ts'
import { reachOf } from './operator-reach.ts'
import { builderOf, SPACE } from './build.ts'
import { vouched, type Who } from './session.ts'
import { answered } from './meta.ts'
import { esc } from './pages.ts'
import { fileDrop } from './html.ts'
import { managePath } from './route.ts'
import { keepFile, type Request as Intake } from './operator-channels.ts'
import { mailFrom } from './post.ts'
import { parts } from './form.ts'
import { gathered } from './bytes.ts'
import { refuse } from './tool.ts'
import { CONSENT, handed, type Texting, texts } from './operator-texts.ts'
import { CallError } from '@yaks/tools/errors'
import { type Worked, worked } from './operator-view.ts'

let shown = (number: string) =>
  number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')

// Where a person agrees to texts from the operator, or stops them.
export let textsCard = (at: string, consent: Texting | null) =>
  `<form class="Card Form" id="texts" method="post" action="${at}?texts=1">
<h2 class="Card_Title">Text messages</h2>
<p>The operator can text you when it finishes a change, needs an answer from you, or something about your site needs you. You can still use chat and email.</p>${
    consent
      ? `<p>Texts go to <b>${esc(shown(consent.number))}</b>. You agreed on ${
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
<button class="Button" type="submit">Save</button><p role="status" data-texts-status></p></form>`

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

export let conversation = (rows: Bundle[], at = '') =>
  rows.map((row) => {
    let request = row.operator_request as Intake
    let doc = row.doc as { title?: string; body?: string }
    let answer = row.operator_answer as
      | { text?: string; task?: string }
      | undefined
    let failed = row.failed ?? row.bounced
    return `<article class="Card"${
      answer || failed ? '' : ' data-pending'
    }><h2 class="Card_Title">${
      esc(
        request.channel == 'email'
          ? 'Email'
          : request.channel == 'error'
          ? 'An app error'
          : 'You',
      )
    }</h2><p style="white-space:pre-wrap">${esc(doc.body ?? '')}</p>${
      request.files?.length
        ? `<p>${
          request.files.map((f, i) =>
            `<a href="${esc(at)}?attachment=${row.entity.eid}&file=${i}">${
              esc(f.name)
            }</a>`
          ).join(', ')
        }</p>`
        : ''
    }<h3>Operator</h3><p style="white-space:pre-wrap">${
      esc(
        answer?.text ?? (failed
          ? 'Your request is kept, but the Operator could not finish it. Send it again to try once more.'
          : 'Your request is saved. The Operator will start on it soon.'),
      )
    }</p>${
      failed && answer
        ? '<p role="status">The answer could not be sent to you. It is kept here.</p>'
        : ''
    }${
      answer?.task
        ? `<button class="Button Button-quiet" type="button" data-follow="${
          esc(answer.task)
        }">Continue this request</button>`
        : ''
    }</article>`
  }).join('')

// What the Operator page's own requests are answered: an attachment, a texts
// choice, a draft, a request sent and the conversation read again. A plain
// read of the page is none of these; it is the dashboard's to draw, around
// `operatorBody`.
export let operatorAnswer = async (
  req: globalThis.Request,
  env: Env,
  space: Space,
  who: Who,
): Promise<Response | undefined> => {
  let url = new URL(req.url)
  let at = managePath('operator', space.slug)
  if (url.searchParams.has('attachment')) {
    let row = await operatorDoor(env, space, who, 'request', {
      id: url.searchParams.get('attachment'),
    }) as Bundle
    let file = (row.operator_request as Intake).files
      ?.[Number(url.searchParams.get('file'))]
    if (!file) {
      return new Response('That attachment is missing.', { status: 404 })
    }
    let kept = await env.BLOBS.get(file.key)
    if (!kept) throw new Error('Operator attachment is missing: ' + file.name)
    return new Response(await kept.arrayBuffer(), {
      headers: {
        'content-type': file.mime,
        'content-disposition': `attachment; filename*=UTF-8''${
          encodeURIComponent(file.name)
        }`,
        'cache-control': 'private, no-store',
      },
    })
  }
  if (url.searchParams.has('texts') && req.method == 'POST') {
    let form = await req.formData()
    let person = who.person ?? ''
    let dir = directoryOf(env.STORE)
    try {
      await dir.apply({
        entities: texts(
          person,
          form.has('stop') ? '' : String(form.get('number') ?? ''),
          form.get('agreed') == 'yes',
        ),
      }, vouched(who))
      return Response.json(await dir.texting(person))
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return Response.json({ message: e.message }, { status: 400 })
    }
  }
  if (url.searchParams.has('draft')) {
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
  if (req.method == 'POST') {
    let form = new FormData()
    let files = []
    for await (let part of parts(req)) {
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
    let received = await operatorDoor(env, space, who, 'receive', {
      say: String(form.get('say') ?? ''),
      request: {
        channel: 'chat',
        files,
        ...(form.get('task') ? { task: String(form.get('task')) } : {}),
      },
      options: { id: String(form.get('request') || crypto.randomUUID()) },
      ...(form.has('draft')
        ? { draft: JSON.parse(String(form.get('draft'))) }
        : {}),
    })
    if (form.has('draft')) return Response.json(received)
    return new Response(null, { status: 303, headers: { location: at } })
  }
  if (url.searchParams.has('stop') && req.method == 'POST') {
    let { task } = await req.json() as { task?: string }
    return Response.json(
      await operatorDoor(env, space, who, 'stop', { task }),
    )
  }
  if (url.searchParams.has('live')) {
    if ((req.headers.get('upgrade') ?? '').toLowerCase() != 'websocket') {
      return new Response("This is the Operator page's WebSocket.", {
        status: 426,
      })
    }
    return watching(env, space, req, who)
  }
  if (url.searchParams.has('messages')) {
    let open = url.searchParams.get('open')
    let html = open
      ? (await conversationOf(env, space, who, at, open)).html
      : await workOf(env, space, who, at)
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    })
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

// The Operator's work as its page lists it, each linking to its own page.
let workOf = async (env: Env, space: Space, who: Who, at: string) =>
  worked(await operatorDoor(env, space, who, 'work', {}) as Worked[], at)

// One piece of the Operator's work, opened by its task or a request: its
// sessions as they ran (operator-view.ts `talk`), or the request alone while
// no session has taken it.
let conversationOf = async (
  env: Env,
  space: Space,
  who: Who,
  at: string,
  open: string,
) => {
  let { task, html, waiting } = await operatorDoor(
    env,
    space,
    who,
    'conversation',
    { at, open },
  ) as { task: string; html: string; waiting: Bundle[] }
  return { task, html: html + conversation(waiting, at) }
}

// The Operator page's content, which the dashboard draws beside its side like
// every other page (pages.ts `desk`). The page is the Operator's settings:
// what it does and where, a way to ask it for something, the list of what it
// worked on and the texts it may send. Each piece of work opens on a page of
// its own (`open`, a task or a request), with what it did.
export let operatorBody = async (
  env: Env,
  space: Space,
  who: Who,
  open?: string,
) => {
  let at = managePath('operator', space.slug)
  if (open) return workPage(env, space, who, at, open)
  let [list, consent, { pa, beyond }] = await Promise.all([
    workOf(env, space, who, at),
    textingOf(env, space, who),
    reachOf(directoryOf(env.STORE), space, who.person ?? ''),
  ])
  let doing = (role: string) => role == 'viewer' ? 'can look' : 'can change'
  let address = mailFrom(space.slug, null, env)
  return `
<section class="Card"><p>Ask the Operator for a change in your apps, or send it a PDF or a photo. Your space's plan covers its work.</p>${
    pa
      ? '<p>This is your own space, so its Operator can also work in your other spaces, with your role in each.</p>'
      : ''
  }${
    beyond.length
      ? `<p>It also works in ${
        beyond.map((r) =>
          `<a href="${managePath('apps', r.space.slug)}">${
            esc(r.space.title || r.space.slug)
          }</a> (${doing(r.role)})`
        ).join(', ')
      }.</p>`
      : ''
  }<p>Email it from your member address: <a href="mailto:${esc(address)}">${
    esc(address)
  }</a></p></section>
${askForm(at, '', 'What would you like done?')}
<div data-work aria-live="polite">${list}</div>
${textsCard(at, consent)}
${script(at, who, space, '')}`
}

// One piece of work on its page: what was asked, what the Operator did and
// what it is doing now, and a way to add to it.
let workPage = async (
  env: Env,
  space: Space,
  who: Who,
  at: string,
  open: string,
) => {
  let { task, html } = await conversationOf(env, space, who, at, open)
  return `
<p><a href="${at}">Back to the Operator</a></p>
<div data-conversation aria-live="polite">${
    html ||
    '<section class="Empty"><h2>This request is not here</h2><p>It may have been removed. Your other requests are on the Operator page.</p></section>'
  }</div>
${task ? askForm(at, task, 'Anything to add?') : ''}
${script(at, who, space, open)}`
}

let askForm = (at: string, task: string, label: string) =>
  `<form class="Card Form" id="ask" method="post" action="${at}" enctype="multipart/form-data">
<input type="hidden" name="request" value="${crypto.randomUUID()}"><input type="hidden" name="task" value="${
    esc(task)
  }">
<label class="Form_Field">${label}<textarea class="Field" name="say"></textarea></label>
<div class="Form_Field"><span class="Form_Label">Documents or photos</span>${
    fileDrop({ name: 'file', label: 'Documents or photos', multiple: true })
  }</div>
<button class="Button" type="submit">Send</button><p role="status" data-send-status></p></form>`

// The page's script: the durable draft and sending, the texts choice, and
// the work kept current from the Builder object's socket. On the list each
// step reads the list again; on a piece of work's page its own steps are put
// in place by id.
let script = (at: string, who: Who, space: Space, open: string) =>
  `<script type="module">
import { browserDrafts } from '/_draft.js'
let open = ${JSON.stringify(open)}
let box = document.querySelector(open ? '[data-conversation]' : '[data-work]')
let form = document.querySelector('#ask')
let texts = document.querySelector('#texts')
texts?.addEventListener('submit', async (e) => {
  e.preventDefault()
  let said = texts.querySelector('[data-texts-status]')
  let body = new FormData(texts)
  if (e.submitter?.name == 'stop') body.set('stop', '1')
  said.textContent = 'Saving…'
  try {
    let response = await fetch(texts.action, { method: 'POST', body })
    let answer = await response.json().catch(() => null)
    if (!response.ok) throw new Error(answer?.message ?? 'Your choice could not be saved. Try again.')
    location.reload()
  } catch (error) { said.textContent = error.message }
})
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
if (form) drafts.bind(form.elements.say, 'operator')
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-follow]')) form?.elements.say.focus()
  let stop = e.target.closest('[data-stop]')
  if (stop) {
    stop.disabled = true
    status.textContent = 'Stopping…'
    fetch('${at}?stop=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: stop.dataset.stop }) })
      .then((r) => { if (!r.ok) throw new Error('It could not be stopped. Try again.'); status.textContent = 'Stopped.' })
      .catch((error) => { status.textContent = error.message })
      .finally(() => { stop.disabled = false })
  }
})
// One read at a time; a step heard during one reads once more after it.
let reading, again = false
let read = async () => {
  if (reading) return void (again = true)
  reading = (async () => {
    do {
      again = false
      let response = await fetch('${at}?messages=1' + (open ? '&open=' + encodeURIComponent(open) : ''))
      if (!response.ok) throw new Error('This page could not be brought up to date. Your requests are saved; reload to try again.')
      let html = await response.text()
      if (html) box.innerHTML = html
    } while (again)
  })()
  try { await reading } finally { reading = undefined }
}
let said = (e) => { status.textContent = e.message }
// On a piece of work's page, each step the Operator takes arrives on the
// socket as the lines it changed, put in place by id; a task the page has not
// drawn yet (a request just taken up) reads the page again.
let live = false
let hear = (frame) => {
  let o = frame.operator
  if (!o) return
  if (!open) return void (o.typing || read().catch(said))
  let card = box.querySelector('[data-task]')
  if (!card) return void read().catch(said)
  if (card.dataset.task != o.task) return
  // A reply as it is written, until the step that wrote it lands.
  let typing = card.querySelector('[data-typing]')
  if (o.typing) {
    if (!typing) {
      typing = document.createElement('p')
      typing.className = 'Chat_Bubble Chat_Bubble-them'
      typing.dataset.typing = ''
      card.querySelector('[data-rows]').append(typing)
    }
    typing.textContent += o.typing
    return
  }
  typing?.remove()
  for (let row of o.rows) {
    let at = document.getElementById('row-' + row.id)
    if (!at) {
      at = document.createElement('div')
      at.id = 'row-' + row.id
      card.querySelector('[data-rows]').append(at)
    }
    if (at.dataset.html == row.html) continue
    let open = at.querySelector('details')?.open
    at.innerHTML = row.html
    at.dataset.html = row.html
    if (open) at.querySelector('details').open = true
  }
  card.querySelector('[data-now]').textContent = o.now
  card.toggleAttribute('data-pending', !!o.now)
}
let listen = () => {
  let socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '${at}?live=1')
  socket.onopen = () => { live = true; read().catch(said) }
  socket.onmessage = (e) => { try { hear(JSON.parse(e.data)) } catch (error) { said(error) } }
  socket.onclose = () => { live = false; poll(); setTimeout(listen, 3000) }
}
let polling = false
let poll = async () => {
  if (live || polling || !box.querySelector('[data-pending]')) return
  polling = true
  try { await read() } catch (e) { said(e) }
  finally { polling = false; if (box.querySelector('[data-pending]')) setTimeout(poll, 2000) }
}
form?.addEventListener('submit', async (e) => {
  e.preventDefault()
  let button = form.querySelector('[type=submit]')
  button.disabled = true
  status.textContent = 'Saving your request…'
  try {
    submission = new FormData(form)
    let request = form.elements.request.value
    let saved = await drafts.spend('operator', [{ entity: { eid: request } }])
    if (!saved) throw new Error('Your request could not be confirmed. Your words are kept; try sending again.')
    form.elements.file.value = ''; form.elements.file.dispatchEvent(new Event('change', { bubbles: true })); form.elements.request.value = crypto.randomUUID()
    status.textContent = 'Your request is saved.'
    // A new request opens on its own page, where its work appears.
    if (!open) return void location.assign('${at}?open=' + request)
    await read(); poll()
  } catch (error) { said(error) }
  finally { button.disabled = false }
})
listen()
</script>`
