// Images and documents in the Operator's chat app: put into the box by
// picking, pasting or dropping, each a preview to take back; sent through
// the page to an Operator on Claude, which is shown a picture and a PDF as
// they are; and drawn in the person's message.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { type Item, ModelError, type Request as Ask } from '@yaks/model'
import { conversation } from '@yaks/anthropic'
import { READS } from '@yaks/anthropic/reads'
import { addressOf } from '@yaks/blob'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorService } from './operator-testing.ts'
import { chatPage, operatorAnswer } from './operator-page.ts'
import { onPage } from './operator-view.ts'

let p = platform('operator-files')
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await directoryOf(p.env.STORE).apply({
  entities: [
    { entity: { eid: person }, person: {} },
    {
      entity: { eid },
      space: { slug: 'clerk', store: 'clerk' },
      doc: { title: 'Township' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let space = (await directoryOf(p.env.STORE).at(eid))!
let who = { person, role: 'owner' as const, space: eid }

// Claude, faked where the Operator asks it.
let asks: Ask[] = []
let price = { input: 1, output: 0 }
let service = operatorService(p.env, who, {
  name: 'claude-sonnet-5-5',
  price,
  model: Object.assign((req: Ask) => {
    asks.push(req)
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items: [{ kind: 'assistant', text: 'The flyer says Thursday.' } as Item],
      usage: { input_tokens: 10, output_tokens: 0 },
    })
  }, {
    info: (name: string) => Promise.resolve({ name, price, context: 200_000 }),
    reads: READS,
  }),
})
p.env.BUILDER = service.binding

let png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
)
let pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF')
let [pngId, pdfId] = await Promise.all([png, pdf].map(addressOf))
let request = crypto.randomUUID()
let form = new FormData()
form.set('request', request)
form.set('say', 'When is the meeting?')
form.append('file', new Blob([png], { type: 'image/png' }), 'flyer.png')
// A browser can name a PDF's type as nothing at all.
form.append('file', new Blob([pdf]), 'agenda.pdf')
let at = 'https://yaks.app/manage/clerk/operator'
let sent = (await operatorAnswer(
  new Request(at, { method: 'POST', body: form }),
  p.env,
  space,
  who,
))!
await service.drain()
let [ask] = asks
let media = ask.items.filter((i) => 'bytes' in i) as Extract<
  Item,
  { bytes: Uint8Array }
>[]

test('a picture and a PDF sent from the page reach Claude as they are', () => {
  assertEquals(sent.status, 303)
  assertEquals(
    media.map((i) => [i.kind, i.mediaType, i.label]),
    [
      ['image', 'image/png', `Attached: flyer.png (attachment ${pngId})`],
      [
        'document',
        'application/pdf',
        `Attached: agenda.pdf (attachment ${pdfId})`,
      ],
    ],
  )
  assertEquals(media.map((i) => i.bytes.length), [png.length, pdf.length])
  // Neither is read through extraction first: its words are the person's.
  assertEquals(JSON.stringify(ask.items).includes('Attached documents'), false)
  // The words say the page they were written on: the chat, where a box
  // drawn before it named its page sent them.
  assertEquals(
    JSON.stringify(ask.items).includes(
      onPage('https://yaks.app/manage/clerk') + 'When is the meeting?',
    ),
    true,
  )
  let source = (type: string) =>
    conversation(ask).flatMap((m) => m.content).flatMap((b) =>
      b.type == type && 'source' in b ? [b.source] : []
    )[0]
  assertEquals(source('image'), {
    type: 'base64',
    media_type: 'image/png',
    data: btoa(String.fromCharCode(...png)),
  })
  assertEquals(source('document')?.media_type, 'application/pdf')
})

let { document } = parseHTML(
  await (await chatPage(p.env, space, who, request)).text(),
)
test('the files show in the message they were sent with, a picture as itself', () => {
  let message = document.querySelector('.Talk_Said > div:has(.Talk_You)')!
  assertEquals(
    message.querySelector('.Talk_You')?.textContent,
    'When is the meeting?',
  )
  let picture = message.querySelector('.Talk_Picture img')!
  assertEquals(picture.getAttribute('alt'), 'flyer.png')
  assertEquals(
    picture.getAttribute('src'),
    `?attachment=${request}&file=0`,
  )
  assertEquals(
    [...message.querySelectorAll('.Talk_File')].map((a) => a.textContent),
    ['PDFagenda.pdf'],
  )
  // Not listed a second time under the conversation.
  assertEquals(document.querySelector('.Talk_Thread > .Talk_Files'), null)
})

let opened = (await operatorAnswer(
  new Request(`${at}/${request}?attachment=${request}&file=0`),
  p.env,
  space,
  who,
))!
let saved = (await operatorAnswer(
  new Request(`${at}?attachment=${request}&file=1`),
  p.env,
  space,
  who,
))!
test('a sent picture opens in place, and a document is saved', async () => {
  assertEquals(opened.headers.get('content-type'), 'image/png')
  assertStringIncludes(opened.headers.get('content-disposition')!, 'inline')
  assertEquals(new Uint8Array(await opened.arrayBuffer()), png)
  assertEquals(
    saved.headers.get('content-type'),
    'application/octet-stream',
  )
  assertStringIncludes(saved.headers.get('content-disposition')!, 'attachment')
  await saved.body?.cancel()
})

// The box on a new conversation, with the shell's drop script running in it.
let code = await Deno.readTextFile(new URL('./public/drop.js', import.meta.url))
let fresh = await (await chatPage(p.env, space, who, 'new')).text()
let box = () => {
  let html = fresh
  let { document, window } = parseHTML(html)
  class Held {
    list: File[] = []
    items = { add: (f: File) => this.list.push(f) }
    get files() {
      return this.list
    }
  }
  new Function(
    'document',
    'addEventListener',
    'DataTransfer',
    'Event',
    'URL',
    code,
  )(
    document,
    document.addEventListener.bind(document),
    Held,
    window.Event,
    { createObjectURL: (f: File) => 'blob:' + f.name, revokeObjectURL() {} },
  )
  let input = document.querySelector('#ask .Drop_File') as HTMLInputElement
  let files: File[] = []
  Object.defineProperties(input, {
    files: { get: () => files, set: (v) => files = v },
    multiple: { get: () => input.hasAttribute('multiple') },
  })
  let field = document.querySelector('[name=say]')!
  let event = (type: string, extra: Record<string, unknown>) => {
    let e = new window.Event(type, { bubbles: true, cancelable: true })
    Object.assign(e, extra)
    return e
  }
  return {
    pick: (...list: File[]) => {
      files = list
      input.dispatchEvent(event('change', {}))
    },
    paste: (...list: File[]) =>
      field.dispatchEvent(event('paste', { clipboardData: { files: list } })),
    drop: (...list: File[]) =>
      field.dispatchEvent(
        event('drop', { dataTransfer: { types: ['Files'], files: list } }),
      ),
    remove: (i: number) =>
      (document.querySelectorAll('.Drop_Item button')[i] as HTMLElement)
        .click(),
    sending: () => files.map((f) => f.name),
    shown: () =>
      [...document.querySelectorAll('#ask .Drop_Item')].map((li) =>
        [
          li.querySelector('img')?.getAttribute('src') ??
            li.querySelector('.Drop_Kind')?.textContent,
          li.querySelector('.Drop_Name')?.textContent,
          li.querySelector('.Drop_Note') ? 'unread' : '',
        ].filter(Boolean).join(' ')
      ),
    said: () => document.querySelector('#ask .Drop_Said')?.textContent,
  }
}
let file = (name: string, type: string, size = 3) =>
  Object.defineProperty(new File(['abc'], name, { type }), 'size', {
    value: size,
  })

test('files picked, pasted and dropped join the box, each a preview to take back', () => {
  let b = box()
  b.pick(file('flyer.png', 'image/png'))
  b.paste(file('image.png', 'image/png'))
  b.drop(
    file('agenda.pdf', 'application/pdf'),
    file('site.zip', 'application/zip'),
  )
  assertEquals(b.shown(), [
    'blob:flyer.png flyer.png',
    'blob:image.png image.png',
    'PDF agenda.pdf',
    'ZIP site.zip unread',
  ])
  assertEquals(b.sending(), [
    'flyer.png',
    'image.png',
    'agenda.pdf',
    'site.zip',
  ])
  b.remove(1)
  assertEquals(b.sending(), ['flyer.png', 'agenda.pdf', 'site.zip'])
  // Sent, the box lets go of them.
  b.pick()
  assertEquals(b.shown(), [])
})

test('a file over the size the box takes is left out, and the box says so', () => {
  let b = box()
  b.pick(
    file('scan.tiff', 'image/tiff', 16_000_001),
    file('note.txt', 'text/plain'),
  )
  assertEquals(b.sending(), ['note.txt'])
  assertEquals(b.said(), 'scan.tiff is larger than 16 MB, so it was left out.')
})

// A model choice applies to file admission as well as the generated answer.
let { operating } = await import('./operator.ts')
let { operatorMemory } = await import('./operator-testing.ts')
let { keepFile } = await import('./operator-channels.ts')
let { drain } = await import('./operator-store.ts')
let store = operatorMemory()
let nativeAsks: Ask[] = []
let docxType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
let nativeModel = Object.assign((req: Ask) => {
  nativeAsks.push(req)
  return Promise.resolve({
    id: crypto.randomUUID(),
    model: req.model,
    items: [{ kind: 'assistant', text: 'Read the file.' } as Item],
    usage: { input_tokens: 10, output_tokens: 0 },
  })
}, {
  info: (name: string) =>
    Promise.resolve(
      ['files', 'text-only'].includes(name)
        ? { name, price, context: 200_000, output: 2048 }
        : undefined,
    ),
  reads: (name: string): Record<string, number> =>
    name == 'files' ? { [docxType]: 1024, 'text/plain': 1024 } : {},
})
let operator = operating(store, p.env, {
  directory: () => directoryOf(p.env.STORE),
  name: 'files',
  model: nativeModel,
  providers: { openai: nativeModel },
  price,
})
let docxBytes = new TextEncoder().encode(
  'A document handled natively does not need conversion.',
)
let docx = await keepFile(p.env, space, 'minutes.docx', docxType, docxBytes)
let textBytes = new TextEncoder().encode(
  'Project selection follows the current model.',
)
let note = await keepFile(p.env, space, 'note.txt', 'text/plain', textBytes)
await operator.ask(who, space, { say: 'Keep these files.' }, {
  files: [docx, note],
})
await drain(store)
let fileRun = await operator.run(who, space, {
  provider: 'openai',
  model: 'files',
  say: 'Read the document.',
  attachments: [docx.key.split('/').at(-1)],
})
let fileAsk = nativeAsks.at(-1)!
let noteRun = await operator.run(who, space, {
  provider: 'openai',
  model: 'files',
  say: 'Keep this note.',
  attachments: [note.key.split('/').at(-1)],
})
let textRun = await operator.run(who, space, {
  task: noteRun.task,
  provider: 'openai',
  model: 'text-only',
  say: 'Read the earlier note.',
})
let textAsk = nativeAsks.at(-1)!

test('a run on another provider sends its DOCX as a document with its original filename', async () => {
  assertEquals(fileRun.status, 'settled', fileRun.text)
  let document = fileAsk.items.find((i) => i.kind == 'document')!
  assertEquals(document, {
    kind: 'document',
    filename: 'minutes.docx',
    mediaType: docxType,
    label: `Attached: minutes.docx (attachment ${docx.key.split('/').at(-1)})`,
    bytes: docxBytes,
  })
  assertEquals(fileRun.model, 'files')
  let [input] = await store.g.read(
    `.entry.session=${fileRun.session}&.using&.order=entry.seq&.limit=1`,
  )
  let [provider] = await store.g.get([
    String((input.using as { provider: string }).provider),
  ])
  assertEquals(provider.provider, { name: 'openai' })
})

test('a later turn whose selected model cannot read an earlier file receives its extracted text', () => {
  assertEquals(textRun.status, 'settled', textRun.text)
  assertEquals(textRun.model, 'text-only')
  assertEquals(
    textAsk.items.some((i) => i.kind == 'document' || i.kind == 'image'),
    false,
  )
  assertStringIncludes(
    JSON.stringify(textAsk.items),
    new TextDecoder().decode(textBytes),
  )
})

test('a run refuses unavailable providers, unlisted models and another persons attachment', async () => {
  await assertRejects(
    () =>
      operator.run(who, space, {
        provider: 'missing',
        model: 'files',
        say: 'Read it.',
      }),
    Error,
    'no available missing provider',
  )
  await assertRejects(
    () =>
      operator.run(who, space, {
        provider: 'openai',
        model: 'missing',
        say: 'Read it.',
      }),
    Error,
    'does not list model missing',
  )
  await assertRejects(
    () =>
      operator.run({ person: crypto.randomUUID() }, space, {
        provider: 'openai',
        model: 'files',
        say: 'Read it.',
        attachments: [docx.key.split('/').at(-1)],
      }),
    Error,
    'attachment is missing',
  )
})

let permission = new ModelError(
  'auth',
  '401 Missing permissions: api.model.read',
  undefined,
  {
    body: JSON.stringify({
      error: { message: 'Missing permissions: api.model.read' },
    }),
  },
)
let unavailable = operatorService(p.env, who, {
  directory: () => directoryOf(p.env.STORE),
  name: 'files',
  model: nativeModel,
  providers: {
    openai: Object.assign((request: Ask) => nativeModel(request), {
      info: () => Promise.reject(permission),
    }),
  },
  price,
})

test('a provider catalogue permission failure reaches the run HTTP caller with its diagnosis', async () => {
  let response = await unavailable.binding.get(space.eid).fetch(
    new Request('https://builder/operator/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-space-eid': space.eid,
        'x-yak-person': person,
      },
      body: JSON.stringify({
        provider: 'openai',
        model: 'files',
        say: 'Read it.',
      }),
    }),
  )
  assertEquals(response.status, 503)
  assertEquals(await response.json(), {
    message:
      'openai model catalogue failed (auth): 401 Missing permissions: api.model.read',
  })
})
