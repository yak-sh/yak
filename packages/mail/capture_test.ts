// A capture keeps original bytes alongside the delivery's readable projection.
import { equal, test } from '@yaks/testing'
import { capture, captured } from './capture.ts'

test('a delivery capture survives JSON with HTML and unsupported attachments intact', () => {
  let attachments = [{
    name: 'unreadable.bin',
    type: 'application/x-unknown',
    bytes: new Uint8Array([0, 255, 42]),
  }]
  let sources = [{
    name: 'message.eml',
    type: 'message/rfc822',
    bytes: new TextEncoder().encode('X-Original: kept\r\n\r\n'),
  }]
  let saved = JSON.parse(JSON.stringify(capture({
    from: 'bounce@example.com',
    to: 'reader@example.com',
    headers: new Headers({ 'X-Sender': 'original' }),
    text: 'Hello',
    html: '<p>Hello</p>',
    attachments,
    sources,
  })))
  equal(captured(saved.attachments), attachments)
  equal(captured(saved.sources), sources)
  equal(saved.html, '<p>Hello</p>')
  equal(saved.headers, [['x-sender', 'original']])
  equal([saved.from, saved.to], ['bounce@example.com', 'reader@example.com'])
})
