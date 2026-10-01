// The skill codec is a value boundary: these tests exercise frontmatter
// normalization, opaque instructions and refusal without a graph or harness.

import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { Refused } from '@yaks/graph'
import { frontmatter, parseSkill, renderSkill } from './skill-text.ts'

let text = (fields = '', body = '') =>
  `---\nname: review\ndescription: Review a change\n${fields}---\n${body}`

let roundtrip = (source: string, title = 'review') => {
  let bundle = parseSkill(source, title)
  assertEquals(parseSkill(renderSkill(bundle), title), bundle)
  return bundle
}

test('a skill owns its name and description in doc, its instructions in content', () => {
  let bundle = roundtrip(text('', '# Review\n\nCheck the change.\n'))
  assertEquals(bundle, {
    doc: { title: 'review', body: 'Review a change' },
    content: { body: '# Review\n\nCheck the change.\n' },
    skill: {
      invoke: 'both',
      arguments: [],
      paths: [],
      fork: false,
      options: {},
    },
  })
  assertEquals(frontmatter(bundle), {
    name: 'review',
    description: 'Review a change',
  })
})

test('an omitted name uses the folder and folded descriptions are YAML values', () => {
  let bundle = roundtrip(
    '---\ndescription: >\n  Review the change\n  before landing.\n---\n',
  )
  assertEquals(bundle.doc, {
    title: 'review',
    body: 'Review the change before landing.\n',
  })
})

test('invocation flags normalize to the three modes without losing restrictions', () => {
  for (
    let [flags, invoke] of [
      ['', 'both'],
      ['disable-model-invocation: false\nuser-invocable: true\n', 'both'],
      ['disable-model-invocation: true\n', 'user'],
      ['user-invocable: false\n', 'model'],
      ['disable-model-invocation: YES\nuser-invocable: 1\n', 'user'],
      ['disable-model-invocation: OFF\nuser-invocable: No\n', 'model'],
    ]
  ) {
    let bundle = roundtrip(text(flags))
    assertEquals(bundle.skill.invoke, invoke)
    assertEquals(bundle.skill.options, {})
  }
  assertThrows(() =>
    parseSkill(
      text('disable-model-invocation: true\nuser-invocable: false\n'),
      'review',
    )
  )
})

test('arguments and path globs accept strings and YAML lists', () => {
  for (
    let fields of [
      'arguments: issue branch\npaths: "src/**, packages/**"\n',
      'arguments: [issue, branch]\npaths:\n  - src/**\n  - packages/**\n',
    ]
  ) {
    let bundle = roundtrip(text(fields))
    assertEquals(bundle.skill.arguments, ['issue', 'branch'])
    assertEquals(bundle.skill.paths, ['src/**', 'packages/**'])
    assertEquals(frontmatter(bundle).arguments, ['issue', 'branch'])
    assertEquals(frontmatter(bundle).paths, ['src/**', 'packages/**'])
  }
  let bundle = roundtrip(text('paths: ["src/{a,b}/**", "!generated/**"]\n'))
  assertEquals(bundle.skill.paths, ['src/{a,b}/**', '!generated/**'])
})

test('fork maps to skill while other context and unknown fields survive untouched', () => {
  let fields = `context: fork
agent: Explore
argument-hint: "[issue]"
allowed-tools: [Read, "Bash(git diff *)"]
model: inherit
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: echo hook
metadata:
  active: true
  nested: [null, 42, {key: value}]
license: Apache-2.0
future-field: {mode: "not interpreted"}
`
  let bundle = roundtrip(text(fields))
  assertEquals(bundle.skill.fork, true)
  assertEquals(bundle.skill.options, {
    agent: 'Explore',
    'argument-hint': '[issue]',
    'allowed-tools': ['Read', 'Bash(git diff *)'],
    model: 'inherit',
    hooks: {
      PreToolUse: [{
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo hook' }],
      }],
    },
    metadata: { active: true, nested: [null, 42, { key: 'value' }] },
    license: 'Apache-2.0',
    'future-field': { mode: 'not interpreted' },
  })
  assertEquals(frontmatter(bundle).context, 'fork')
  for (let context of ['inline', 'future-mode', '[one, two]', 'null']) {
    let other = roundtrip(text(`context: ${context}\n`))
    assertEquals(other.skill.fork, false)
    assertEquals(frontmatter(other).context, other.skill.options.context)
  }
})

test('the body is exact, including line endings, delimiters and inert expansions', () => {
  for (
    let body of [
      '',
      'no final newline',
      '\n\n leading and trailing spaces \t\n\n',
      '# Title\r\n\r\ntext\r\n',
      '---\nthis is body YAML, not another header\n---\n',
      '!`echo injection`\n@./missing-file\n$ARGUMENTS $0 $issue\n' +
      '${CLAUDE_PROJECT_DIR} ${CLAUDE_SESSION_ID}\n',
      'Unicode: 日本語 🦊\n\u0000',
    ]
  ) {
    for (let newline of ['\n', '\r\n']) {
      let header = text().replaceAll('\n', newline)
      assertEquals(roundtrip(header + body).content.body, body)
    }
  }
  assertEquals(roundtrip(text().slice(0, -1)).content.body, '')
})

test('malformed, missing and non-object frontmatter is refused', () => {
  for (
    let source of [
      'no frontmatter',
      '\n' + text(),
      '---\nname: review\ndescription: unclosed',
      '---\n[]\n---\n',
      '---\nplain scalar\n---\n',
      '---\nnull\n---\n',
      '---\n---\n',
      text('broken: [\n'),
      text('name: duplicate\n'),
      text('unsafe: !!js/function "function() {}"\n'),
    ]
  ) assertThrows(() => parseSkill(source, 'review'))
})

test('name mismatches, empty descriptions and dangerous folder names are refused', () => {
  assertThrows(() => parseSkill(text(), 'different'))
  for (let value of ['""', '"   "', 'null', 'false', '[description]']) {
    assertThrows(() =>
      parseSkill(`---\nname: review\ndescription: ${value}\n---\n`, 'review')
    )
  }
  assertThrows(() => parseSkill('---\nname: review\n---\n', 'review'))
  for (
    let name of [
      '',
      '.',
      '..',
      '../review',
      '/review',
      'a/b',
      'a\\b',
      'a\0b',
      'a\nb',
      'a:b',
      'a b',
      '-option',
      '.hidden',
    ]
  ) {
    assertThrows(() => parseSkill(text(), name))
    let bundle = parseSkill(text(), 'review')
    bundle.doc.title = name
    assertThrows(() => renderSkill(bundle))
  }
})

test('malformed mapped fields are refused rather than silently granting invocation', () => {
  for (
    let fields of [
      'arguments: [good, 1]\n',
      'arguments: {key: value}\n',
      'paths: [false]\n',
      'paths: 4\n',
      'user-invocable: typo\n',
      'disable-model-invocation: null\n',
      'disable-model-invocation: []\n',
      'disable-model-invocation: [true]\n',
    ]
  ) assertThrows(() => parseSkill(text(fields), 'review'))
})

test('canonical fields win over stale options, without mutating the bundle', () => {
  let bundle = parseSkill(text('context: inline\nmodel: inherit\n'), 'review')
  bundle.skill.invoke = 'user'
  bundle.skill.fork = true
  Object.assign(bundle.skill.options, {
    name: 'stale',
    description: 'stale',
    arguments: ['stale'],
    paths: ['stale'],
    'disable-model-invocation': false,
    'user-invocable': false,
  })
  let before = structuredClone(bundle)
  assertEquals(frontmatter(bundle), {
    name: 'review',
    description: 'Review a change',
    context: 'fork',
    model: 'inherit',
    'disable-model-invocation': true,
  })
  renderSkill(bundle)
  assertEquals(bundle, before)
})

test('rendering validates entity fields at its boundary', () => {
  let bundle = parseSkill(text(), 'review')
  for (
    let skill of [
      { invoke: 'neither' },
      { invoke: ['user'] },
      { invoke: null },
      { arguments: 'issue branch' },
      { paths: [1] },
      { fork: 'yes' },
      { options: [] },
      { options: null },
    ]
  ) assertThrows(() => renderSkill({ ...bundle, skill }))
  assertThrows(() => renderSkill({ ...bundle, content: { body: 4 } }))
  assertThrows(() => renderSkill({ ...bundle, doc: { title: 'review' } }))
})

test('authored syntax and metadata errors are typed refusals', () => {
  for (
    let source of [
      '---\nname: review\ndescription: [unfinished\n---\n',
      '---\nname: review\nname: duplicate\ndescription: Review\n---\n',
      '---\nname: review\ndescription: []\n---\n',
      text('user-invocable: sometimes\n'),
      text('arguments: [3]\n'),
      'No frontmatter',
    ]
  ) assertThrows(() => parseSkill(source, 'review'), Refused)
  assertThrows(() => parseSkill(text(), '../review'), Refused)
  let bundle = parseSkill(text(), 'review')
  assertThrows(
    () => frontmatter({ ...bundle, skill: { invoke: 'neither' } }),
    Refused,
  )
  assertThrows(
    () => frontmatter({ ...bundle, doc: { title: 'review', body: '' } }),
    Refused,
  )
  assertThrows(() => renderSkill({ ...bundle, content: { body: 4 } }), Refused)
})

test('unexpected metadata access failures are not converted to refusals', () => {
  let unexpected = new Error('unexpected metadata access')
  let bundle = parseSkill(text(), 'review')
  let skill = {
    get invoke(): string {
      throw unexpected
    },
  }
  let caught = assertThrows(() => frontmatter({ ...bundle, skill }))
  assertEquals(caught, unexpected)
  assertEquals(caught instanceof Refused, false)
})
