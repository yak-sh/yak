import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { eids, html, linkable, text } from './md.ts'

test('html: markup a body wrote is text, never markup', () => {
  assertEquals(
    html('<script>alert(1)</script>'),
    '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
  )
  assertEquals(html('a & b'), '<p>a &amp; b</p>')
})

test('html: an href is judged by its shape', () => {
  assertStringIncludes(
    html('[sign up](https://books.example/potluck)'),
    '<a href="https://books.example/potluck">sign up</a>',
  )
  assertStringIncludes(
    html('[mail](mailto:ana@books.example)'),
    '<a href="mailto:',
  )
  // A scheme that survives entity decoding, and a relative link a mail client
  // has no base document for: both render as their words.
  assertEquals(html('[x](javascript&colon;alert)'), '<p>x</p>')
  assertEquals(html('[x](javascript:alert)'), '<p>x</p>')
  assertEquals(html('[the list](/list)'), '<p>the list</p>')
  assertEquals(linkable('https://x.example'), true)
  assertEquals(linkable('/list'), false)
})

test('html: the blocks it knows', () => {
  assertEquals(html('# Potluck'), '<h1>Potluck</h1>')
  assertEquals(html('- bread\n- soup'), '<ul><li>bread</li><li>soup</li></ul>')
  assertEquals(html('one\ntwo'), '<p>one<br>two</p>')
  assertEquals(html('one\n\ntwo'), '<p>one</p>\n<p>two</p>')
  assertEquals(
    html('**a** *b* `c`'),
    '<p><strong>a</strong> <em>b</em> <code>c</code></p>',
  )
})

test('text: the words stay, a link keeps its address', () => {
  assertEquals(
    text('Potluck **Friday** — [sign up](https://books.example/p)'),
    'Potluck Friday — sign up (https://books.example/p)',
  )
  assertEquals(text('# Potluck\n\n- bread'), 'Potluck\n\n- bread')
  assertEquals(text('<b>hi</b>'), '<b>hi</b>')
})

test('an underscore inside a word is never emphasis', () => {
  let url = 'https://connect.nango.dev/?session_token=nango_connect_session_a1'
  assertEquals(html(url), `<p>${url}</p>`)
  assertEquals(text(url), url)
  assertEquals(
    html('snake_case and _this_'),
    '<p>snake_case and <em>this</em></p>',
  )
})

test('an eid the sender names reads as its id; code keeps it literal', () => {
  let eid = '711bade7-5f16-468f-a176-0db6c616ff65'
  let names = (e: string) =>
    e == eid ? { id: 'T-453', href: 'https://t.example/T-453' } : undefined
  let body = `${eid.toUpperCase()} and \`${eid}\` in https://x.example/${eid}`
  assertEquals(eids(body), [eid])
  assertEquals(
    text(body, names),
    `T-453 (https://t.example/T-453) and ${eid} in https://x.example/${eid}`,
  )
  assertEquals(
    html(body, names),
    `<p><a href="https://t.example/T-453">T-453</a> and <code>${eid}</code> in https://x.example/${eid}</p>`,
  )
  assertEquals(text(body), body.replaceAll('`', ''))
})

test('a table: its head and rows in both renderings, a pipe in a cell kept', () => {
  let body = '| Bug | Fix |\n|---|---|\n| [a \\| b](https://x.example/a) | 4m |'
  assertEquals(
    html(body),
    '<table style="border-collapse:collapse"><thead><tr>' +
      '<th style="padding:2px 10px 2px 0;text-align:left;vertical-align:top">Bug</th>' +
      '<th style="padding:2px 10px 2px 0;text-align:left;vertical-align:top">Fix</th>' +
      '</tr></thead><tbody><tr>' +
      '<td style="padding:2px 10px 2px 0;text-align:left;vertical-align:top"><a href="https://x.example/a">a | b</a></td>' +
      '<td style="padding:2px 10px 2px 0;text-align:left;vertical-align:top">4m</td>' +
      '</tr></tbody></table>',
  )
  assertEquals(text(body), 'Bug · Fix\na | b (https://x.example/a) · 4m')
})

test('an image on its own line, only from an absolute http(s) address', () => {
  assertEquals(
    html('![Bugs by day](https://x.example/c.png?o=1,2)'),
    '<p><img src="https://x.example/c.png?o=1,2" alt="Bugs by day" style="max-width:100%"></p>',
  )
  assertEquals(
    text('![Bugs by day](https://x.example/c.png)'),
    'Bugs by day (https://x.example/c.png)',
  )
  assertEquals(html('![x](javascript:alert)'), '<p>!x</p>')
})
