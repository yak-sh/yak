// Command Markdown paints structure while untrusted text and links stay inert.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { commandBody } from './command-body.ts'

test('a command result paints Markdown without executing markup', () => {
  let { document } = parseHTML('<html><body></body></html>')
  let previous = globalThis.document
  globalThis.document = document
  try {
    let body = commandBody(
      '#### Result 1\n\n**name**: `Ada`\n\n' +
        '<script>alert(1)</script>\n\n[bad](javascript:alert(1)) ' +
        '[good](https://yaks.app) ![remote](https://example.com/a.png)',
    )
    document.body.append(body)
    assertEquals(body.querySelector('h4')?.textContent, 'Result 1')
    assertEquals(body.querySelector('strong')?.textContent, 'name')
    assertEquals(body.querySelector('code')?.textContent, 'Ada')
    assertEquals(body.querySelector('script'), null)
    assertEquals(body.querySelector('img'), null)
    assert(body.textContent.includes('<script>alert(1)</script>'))
    assertEquals(
      [...body.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      [null, 'https://yaks.app', 'https://example.com/a.png'],
    )
  } finally {
    globalThis.document = previous
  }
})
