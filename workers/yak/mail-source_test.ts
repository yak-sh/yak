// Preserved inbound originals use a private namespace, outside published files.
import { equal, test, throws } from '@yaks/testing'
import { memoryBucket } from '../../packages/blob/testing.ts'
import { type Capture, captured } from '@yaks/mail'
import type { Incoming } from '@yaks/host/senders'
import type { Env } from './env.ts'
import { keepMail } from './mail-source.ts'

let mail: Incoming = {
  from: 'relay@example.com',
  to: 'Space.App@yaks.app',
  headers: new Headers(),
  text: 'hello',
  html: '<p>hello</p>',
  attachments: [{
    name: 'original.bin',
    type: 'application/x-unknown',
    bytes: new Uint8Array([0, 255]),
  }],
}

test('original mail and unsupported attachments remain recoverable without public files', async () => {
  let { bucket: BLOBS } = memoryBucket()
  let env = { BLOBS } as Env
  let key = await keepMail(env, mail)
  equal(key.startsWith('mail-source/space.app%40yaks.app/'), true)
  equal(await keepMail(env, mail), key)
  let saved = new TextDecoder().decode(
    await (await BLOBS.get(key))!.arrayBuffer(),
  )
  let source = JSON.parse(saved) as Capture
  equal(source.html, mail.html)
  equal(captured(source.attachments), mail.attachments)
})

test('a source storage failure rejects intake instead of acknowledging lost data', async () => {
  let { bucket: BLOBS } = memoryBucket()
  BLOBS.put = () => Promise.reject(new Error('unavailable'))
  await throws(() => keepMail({ BLOBS } as Env, mail), 'unavailable')
})

let { arrives, fresh, rfc822 } = await import('./probe.ts')
let sources = memoryBucket()
let k = await fresh({}, (env) => {
  env.BLOBS = sources.bucket as Env['BLOBS']
})
let raw = rfc822({
  'Content-Type': 'text/html',
  'X-Unselected': 'original',
}, '<p>Original HTML</p>')

test('the email door preserves the complete source even when its mailbox refuses it', async () => {
  try {
    let reply = await arrives(k, {
      from: 'sender@example.com',
      to: 'absent@yaks.app',
      raw,
    })
    equal(reply.status, 400)
    let [key] = [...sources.held.keys()]
    equal(key.startsWith('mail-source/absent%40yaks.app/'), true)
    let saved = JSON.parse(
      new TextDecoder().decode(sources.held.get(key)),
    ) as Capture
    equal(new TextDecoder().decode(captured(saved.sources)[0].bytes), raw)
    equal(saved.html?.trim(), '<p>Original HTML</p>')
  } finally {
    await k.stop()
  }
})
