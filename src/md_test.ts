// The markdown door's contract — the behaviors the app leans on. If a
// re-vendored marked or a config change breaks one, this says so.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { md, mdAbs } from './md.ts'

Deno.test('md: paragraphs are <p>, not a wall of <br>', () => {
  assertEquals(md('one\n\ntwo').trim(), '<p>one</p>\n<p>two</p>')
})

Deno.test('md: a single newline is a line break (breaks: true)', () => {
  assertStringIncludes(md('one\ntwo'), '<br')
})

Deno.test('md: intra-word underscores stay literal', () => {
  assertStringIncludes(md('foo_bar and bar_baz'), 'foo_bar and bar_baz')
  assertEquals(md('a _point_ made').trim(), '<p>a <em>point</em> made</p>')
})

Deno.test('md: gfm tables render', () => {
  let html = md('| a | b |\n| - | - |\n| 1 | 2 |')
  assertStringIncludes(html, '<table>')
  assertStringIncludes(html, '<td>1</td>')
})

Deno.test('md: fenced code with blank lines survives whole', () => {
  let html = md('```\none\n\ntwo\n```')
  assertStringIncludes(html, '<pre><code>one\n\ntwo')
})

Deno.test('md: a bare id auto-links with data-ref', () => {
  assertStringIncludes(
    md('see T-123 for the plan'),
    '<a href="/T-123" data-ref="T-123">T-123</a>',
  )
  assertStringIncludes(md('N-9 and P-19'), 'data-ref="N-9"')
})

Deno.test('md: a written link aims at an id', () => {
  assertStringIncludes(
    md('[my task idea](T-123)'),
    '<a href="/T-123" data-ref="T-123">my task idea</a>',
  )
  // a real url keeps marked's own anchor, untouched
  assertStringIncludes(md('[x](https://y.z)'), 'href="https://y.z"')
})

Deno.test('md: ids in code stay literal; mid-word letters stay words', () => {
  assertEquals(md('`T-123`').includes('data-ref'), false)
  assertEquals(md('```\nT-123\n```').includes('data-ref'), false)
  assertEquals(md('UTF-8 and SHA-256').includes('data-ref'), false)
  // an unknown prefix is not a reference
  assertEquals(md('X-123').includes('data-ref'), false)
})

Deno.test('md: a code-span commit links through its project repo', () => {
  let html = md('landed as `46dcd3f`', 'https://github.com/acme/widget')
  assertStringIncludes(
    html,
    '<a href="https://github.com/acme/widget/commit/46dcd3f"><code>46dcd3f</code></a>',
  )
  assertEquals(md('`46dcd3f`').includes('<a '), false)
  assertEquals(
    md('decafed', 'https://github.com/acme/widget').includes('<a '),
    false,
  )
  assertEquals(
    md('`123abc`', 'https://github.com/acme/widget').includes('<a '),
    false,
  )
})

Deno.test('md: a repo setting cannot inject an attribute', () => {
  let html = md('`46dcd3f`', 'javascript:alert(1)" autofocus="')
  assertEquals(html.includes('<a '), false)
})

// mdAbs is the same door for a reader with no base document: a mail
// client resolves the canvas's `/T-123` as `http:///T-123` (T-12558).
Deno.test('mdAbs: ids link to the public door, without data-ref', () => {
  assertStringIncludes(
    mdAbs('see T-123 for the plan'),
    '<a href="https://tasks.yak.sh/T-123">T-123</a>',
  )
  assertStringIncludes(
    mdAbs('[my task idea](T-123)'),
    '<a href="https://tasks.yak.sh/T-123">my task idea</a>',
  )
  assertEquals(mdAbs('T-123').includes('data-ref'), false)
  assertEquals(mdAbs('T-123').includes('href="/'), false)
})

Deno.test('mdAbs: everything else renders as the canvas does', () => {
  assertStringIncludes(mdAbs('[x](https://y.z)'), 'href="https://y.z"')
  assertEquals(mdAbs('`T-123`').includes('tasks.yak.sh'), false)
  assertEquals(mdAbs('```\nT-123\n```').includes('tasks.yak.sh'), false)
  assertEquals(mdAbs('UTF-8 and SHA-256').includes('tasks.yak.sh'), false)
  let cell = mdAbs('| a |\n| - |\n| T-123 |')
  assertStringIncludes(cell, '<td><a href="https://tasks.yak.sh/T-123">')
  assertEquals(mdAbs('one\n\ntwo').trim(), md('one\n\ntwo').trim())
  assertStringIncludes(
    mdAbs('`46dcd3f`', 'https://github.com/acme/widget'),
    'href="https://github.com/acme/widget/commit/46dcd3f"',
  )
})

// The canvas anchor is what nav.tsx's delegated listeners bind to — a
// table cell renders it exactly like prose does.
Deno.test('md: an id in a table cell keeps the canvas anchor', () => {
  assertStringIncludes(
    md('| a |\n| - |\n| T-123 |'),
    '<td><a href="/T-123" data-ref="T-123">T-123</a></td>',
  )
})

// A body can come from anyone who mails the fleet, and this string goes
// to innerHTML on an origin that owns /apply and /ws. Nothing a body
// writes may become markup — through either door (T-12814).
let doors = { md, mdAbs }

for (let [door, render] of Object.entries(doors)) {
  Deno.test(`${door}: html written in a body renders as text`, () => {
    for (
      let payload of [
        '<script>alert(1)</script>',
        '<img src=x onerror="alert(1)">',
        '<svg/onload=alert(1)>',
        '<iframe src="x"></iframe>',
        '<style>body{display:none}</style>',
        '<a href="https://y.z">x</a>',
        '<div onclick="alert(1)">x</div>',
        '<!-- <img src=x onerror=alert(1)> -->',
      ]
    ) {
      let html = render(`before ${payload} after`)
      assertEquals(html.includes('<script'), false, payload)
      assertEquals(
        /<(?:img|svg|iframe|style|a|div)\b/.test(html),
        false,
        payload,
      )
      assertStringIncludes(html, '&lt;')
    }
  })

  Deno.test(`${door}: a url that could carry a scheme never becomes an href`, () => {
    for (
      let payload of [
        '[x](javascript:alert(1))',
        '[x](JaVaScRiPt:alert(1))',
        '[x](  javascript:alert(1)  )',
        '[x](data:text/html,<script>alert(1)</script>)',
        '[x](&#106;avascript:alert(1))',
        '[x](javascript&colon;alert(1))',
        '<javascript:alert(1)>',
        '![x](javascript:alert(1))',
        '[a]: javascript:alert(1)\n\n[x][a]',
      ]
    ) {
      let html = render(payload)
      assertEquals(html.includes('href='), false, payload)
      assertEquals(html.includes('src='), false, payload)
    }
  })

  // The words survive the refusal — a reader still sees what was written.
  Deno.test(`${door}: a refused link keeps its text and its markup`, () => {
    assertStringIncludes(
      render('[a **bold** trap](javascript:alert(1))'),
      '<strong>bold</strong>',
    )
  })

  // Everything a url can legitimately be still links.
  Deno.test(`${door}: ordinary urls still link`, () => {
    for (
      let [payload, href] of [
        ['[x](https://y.z/a?b=c#d)', 'https://y.z/a?b=c#d'],
        ['[x](http://y.z)', 'http://y.z'],
        ['[x](mailto:a@b.c)', 'mailto:a@b.c'],
        ['[x](tel:+15551234)', 'tel:+15551234'],
        ['[x](./notes.md)', './notes.md'],
        ['[x](#top)', '#top'],
        ['[x](docs)', 'docs'],
        ['<a@b.c>', 'mailto:a@b.c'],
        ['see https://y.z here', 'https://y.z'],
        ['see www.y.z here', 'http://www.y.z'],
      ] as [string, string][]
    ) {
      assertStringIncludes(render(payload), `href="${href}"`, payload)
    }
    assertStringIncludes(
      render('![alt](https://y.z/i.png)'),
      'src="https://y.z/i.png"',
    )
  })

  // The door's OWN output is not content: our anchors and marked's own
  // escaping of code, titles and lang all still stand.
  Deno.test(`${door}: what we generate is untouched`, () => {
    assertStringIncludes(render('T-123'), 'href=')
    assertStringIncludes(render('| a |\n| - |\n| 1 |'), '<table>')
    assertStringIncludes(render('- [ ] todo'), 'type="checkbox"')
    assertStringIncludes(
      render('`<b>x</b>`'),
      '<code>&lt;b&gt;x&lt;/b&gt;</code>',
    )
    assertStringIncludes(
      render('```js\n<script>x</script>\n```'),
      '<pre><code class="language-js">&lt;script&gt;',
    )
    // marked escapes a link title; a body cannot break out of it
    assertStringIncludes(
      render('[x](https://y.z "a\\" onmouseover=alert(1) b=")'),
      'title="a&quot; onmouseover=alert(1) b="',
    )
  })
}
