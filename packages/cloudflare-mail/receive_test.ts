// The Cloudflare receiving adapter yields the same neutral mail boundary.
import { equal, test } from '@yaks/testing'
import { received, vouched } from './receive.ts'

for (
  let [header, verified] of [
    [null, undefined],
    ['mx.cloudflare.net; dkim=pass header.d=other.example', true],
    ['mx.cloudflare.net; dkim=fail', false],
    ['sender.example; dkim=pass', false],
    [
      'mx.cloudflare.net; dkim=fail, sender.example; dkim=pass',
      false,
    ],
    [
      'mx.cloudflare.net; dkim=fail, mx.cloudflare.net; dkim=pass',
      false,
    ],
    [
      'mx.cloudflare.net; spf=pass, sender.example; dkim=pass',
      false,
    ],
    ['mx.cloudflare.net; dkim=fail; dkim=pass header.d=other.example', true],
  ] as const
) {
  test(`Email Routing DKIM verdict: ${header ?? 'absent'}`, async () => {
    let headers = new Headers()
    if (header != null) headers.set('Authentication-Results', header)
    let mail = await received({
      from: 'bounce@example.com',
      to: 'one@books.example',
      headers,
      raw: new Response('From: Ann <ann@example.com>\r\n\r\nHello.').body!,
    })
    equal(mail.verified, verified)
    equal(mail.vouched, false)
  })
}

test('Email Routing decodes the author and subject without losing transport headers', async () => {
  let raw =
    'From: Ann <ann@example.com>\r\nTo: one@books.example\r\nSubject: =?UTF-8?B?VGh1cnNkYXk=?=\r\nMessage-ID: <incoming@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAt seven.'
  let mail = await received({
    from: 'bounce@example.com',
    to: 'one@books.example',
    headers: new Headers({ 'Authentication-Results': 'mx.example; dkim=pass' }),
    raw: new Response(raw).body!,
  })
  equal(new TextDecoder().decode(mail.sources?.[0].bytes), raw)
  equal(mail.name, 'Ann')
  equal(mail.from, 'bounce@example.com')
  equal(mail.headers.get('from'), 'ann@example.com')
  equal(mail.headers.get('subject'), 'Thursday')
  equal(mail.headers.get('authentication-results'), 'mx.example; dkim=pass')
  equal(mail.text.trim(), 'At seven.')
  equal(mail.attachments, [])
})

test("a letter is vouched for only by Email Routing's DMARC pass aligned with its From", () => {
  equal(
    vouched(
      'mx.cloudflare.net; dmarc=pass header.from=example.com; dkim=pass',
      'clerk@example.com',
    ),
    true,
  )
  for (
    let header of [
      null,
      'mx.cloudflare.net; dkim=pass header.d=evil.com',
      'evil.com; dmarc=pass header.from=example.com',
      'mx.cloudflare.net; dmarc=fail header.from=example.com, mx.cloudflare.net; dmarc=pass header.from=example.com',
      'mx.cloudflare.net; dmarc=pass header.from=evil.com',
    ]
  ) equal(vouched(header, 'clerk@example.com'), false)
})
