// The Cloudflare receiving adapter yields the same neutral mail boundary.
import { equal, test } from '@yaks/testing'
import { received } from './receive.ts'

test('Email Routing decodes the author and subject without losing transport headers', async () => {
  let raw =
    'From: Ann <ann@example.com>\r\nTo: one@books.example\r\nSubject: =?UTF-8?B?VGh1cnNkYXk=?=\r\nMessage-ID: <incoming@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAt seven.'
  let mail = await received({
    from: 'bounce@example.com',
    to: 'one@books.example',
    headers: new Headers({ 'Authentication-Results': 'mx.example; dkim=pass' }),
    raw: new Response(raw).body!,
  })
  equal(mail.name, 'Ann')
  equal(mail.from, 'bounce@example.com')
  equal(mail.headers.get('from'), 'ann@example.com')
  equal(mail.headers.get('subject'), 'Thursday')
  equal(mail.headers.get('authentication-results'), 'mx.example; dkim=pass')
  equal(mail.text.trim(), 'At seven.')
  equal(mail.attachments, [])
})
