import type { Bundle } from '@yaks/graph'
import type { Env } from './env.ts'
import { directoryOf, type Space } from './directory.ts'
import { builderOf, SPACE } from './build.ts'
import { vouched, type Who } from './session.ts'
import { answered } from './meta.ts'
import { esc } from './pages.ts'
import { managePath } from './route.ts'
import { keepFile, type Request as Intake } from './operator-channels.ts'
import { mailFrom } from './post.ts'
import { parts } from './form.ts'
import { gathered } from './bytes.ts'
import { refuse } from './tool.ts'
import { CONSENT } from './operator-texts.ts'

type Consent = { number: string; at: string }

let shown = (number: string) =>
  number.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3')

// Where a person agrees to texts from the operator, or stops them.
export let textsCard = (at: string, consent: Consent | null) =>
  `<form class="Card Form" id="texts" method="post" action="${at}&texts=1">
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

export let conversation = (rows: Bundle[], at = '') =>
  rows.map((row) => {
    let request = row.operator_request as Intake
    let doc = row.doc as { title?: string; body?: string }
    let answer = row.operator_answer as
      | { text?: string; task?: string }
      | undefined
    let failed = (row.failed ?? row.bounced) as { reason?: string } | undefined
    return `<article class="Card"${
      answer || failed ? '' : ' data-pending'
    }><h2 class="Card_Title">${
      esc(request.channel == 'email' ? 'Email' : 'You')
    }</h2><p style="white-space:pre-wrap">${esc(doc.body ?? '')}</p>${
      request.files?.length
        ? `<p>${
          request.files.map((f, i) =>
            `<a href="${esc(at)}&attachment=${row.entity.eid}&file=${i}">${
              esc(f.name)
            }</a>`
          ).join(', ')
        }</p>`
        : ''
    }<h3>Operator</h3><p style="white-space:pre-wrap">${
      esc(
        answer?.text ?? (failed
          ? `Your request is kept, but the operator could not finish: ${
            failed.reason ?? 'work was interrupted'
          }. Continue the request to try again.`
          : 'Your request is saved. The operator is working on it.'),
      )
    }</p>${
      failed && answer
        ? `<p role="status">${
          esc(
            failed.reason ??
              'The answer could not be delivered. It is kept here.',
          )
        }</p>`
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
    try {
      let consent = await operatorDoor(env, space, who, 'texts', {
        number: form.has('stop') ? '' : String(form.get('number') ?? ''),
        agreed: form.get('agreed') == 'yes',
      }) as Consent | null
      return Response.json(consent)
    } catch (e) {
      let status = (e as { status?: number }).status ?? 500
      if (status >= 500) throw e
      return Response.json({ message: (e as Error).message }, { status })
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
  if (url.searchParams.has('messages')) {
    let rows = await operatorDoor(env, space, who, 'messages', {}) as Bundle[]
    return new Response(conversation(rows, at), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'private, no-store',
      },
    })
  }
}

// The Operator page's content, which the dashboard draws beside its side like
// every other page (pages.ts `desk`).
export let operatorBody = async (env: Env, space: Space, who: Who) => {
  let at = managePath('operator', space.slug)
  let [rows, consent, seats] = await Promise.all([
    operatorDoor(env, space, who, 'messages', {}) as Promise<Bundle[]>,
    operatorDoor(env, space, who, 'texts', {}) as Promise<Consent | null>,
    who.person ? directoryOf(env.STORE).seats(who.person, 'owner') : [],
  ])
  let pa = seats.some((s) => s.own && s.space.eid == space.eid)
  return `
<section class="Card"><p>Ask for a change in your apps, or send a PDF or a photo. Your space's plan covers the operator's model use.</p>${
    pa
      ? '<p>This is your own space, so its operator is your personal assistant: it can also work in your other spaces, with your role in each.</p>'
      : ''
  }<p>Email from your member address: <a href="mailto:${
    esc(mailFrom(space.slug, null, env))
  }">${esc(mailFrom(space.slug, null, env))}</a></p></section>
<div data-conversation aria-live="polite">${conversation(rows, at)}</div>
<form class="Card Form" id="ask" method="post" action="${at}" enctype="multipart/form-data">
<input type="hidden" name="request" value="${crypto.randomUUID()}"><input type="hidden" name="task" value="">
<p data-continuing hidden>Continuing a request. <button type="button" class="Button Button-quiet" data-new>Start a new request</button></p>
<label class="Form_Field">What would you like done?<textarea class="Field" name="say"></textarea></label>
<label class="Form_Field">Documents or photos<input class="Field" type="file" name="file" multiple></label>
<button class="Button" type="submit">Send</button><p role="status" data-send-status></p></form>
${textsCard(at, consent)}
<script type="module">
import { browserDrafts } from '/_draft.js'
let box = document.querySelector('[data-conversation]')
let form = document.querySelector('#ask')
let texts = document.querySelector('#texts')
texts.addEventListener('submit', async (e) => {
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
let status = document.querySelector('[data-send-status]')
let draftAt = '${at}&draft=1'
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
drafts.bind(form.elements.say, 'operator')
document.addEventListener('click', (e) => {
  let follow = e.target.closest('[data-follow]')
  if (follow) { form.elements.task.value = follow.dataset.follow; document.querySelector('[data-continuing]').hidden = false; form.elements.say.focus() }
  if (e.target.closest('[data-new]')) { form.elements.task.value = ''; document.querySelector('[data-continuing]').hidden = true }
})
let read = async () => {
  let response = await fetch('${at}&messages=1')
  if (!response.ok) throw new Error('Could not read the operator. Your request is saved; reload to try again.')
  box.innerHTML = await response.text()
}
let waiting = false
let poll = async () => {
  if (waiting || !box.querySelector('[data-pending]')) return
  waiting = true
  try { await read() } catch (e) { status.textContent = e.message }
  finally { waiting = false; if (box.querySelector('[data-pending]')) setTimeout(poll, 2000) }
}
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  let button = form.querySelector('[type=submit]')
  button.disabled = true
  status.textContent = 'Saving your request…'
  try {
    submission = new FormData(form)
    let saved = await drafts.spend('operator', [{ entity: { eid: form.elements.request.value } }])
    if (!saved) throw new Error('Your request could not be confirmed. Your words are kept; try sending again.')
    form.elements.file.value = ''; form.elements.request.value = crypto.randomUUID()
    status.textContent = 'Your request is saved.'
    await read(); poll()
  } catch (error) { status.textContent = error.message }
  finally { button.disabled = false }
})
poll()
</script>`
}
