import { assertEquals } from '@std/assert'
import { decode, feed, type Key } from './input.ts'

// bytes → the keys they mean. One row per binding worth having.
let table: [string, Key[]][] = [
  ['\x1b[27;2;13~', [{ name: 'enter', shift: true }]],
  ['\x1b[27;3;13~', [{ name: 'enter', alt: true }]],
  ['\x1b[27;5;99~', [{ name: 'char', text: 'c', ctrl: true }]],
  ['hi', [{ name: 'char', text: 'hi' }]],
  ['\r', [{ name: 'enter' }]],
  ['\n', [{ name: 'enter' }]],
  ['\x1b[13;2u', [{ name: 'enter', shift: true }]], // ⇧⏎ — the reason for kitty
  ['\x1b[13;1u', [{ name: 'enter' }]],
  ['\x1b[13;3u', [{ name: 'enter', alt: true }]],
  ['\x1b[27;1u', [{ name: 'escape' }]],
  ['\x1b', [{ name: 'escape' }]],
  ['\x1b[9;2u', [{ name: 'tab', shift: true }]],
  ['\x1b[Z', [{ name: 'tab', shift: true }]],
  ['\t', [{ name: 'tab' }]],
  ['\x7f', [{ name: 'backspace' }]],
  ['\x1b[127;3u', [{ name: 'backspace', alt: true }]],
  ['\x1b\x7f', [{ name: 'backspace', alt: true }]],
  ['\x1b[A', [{ name: 'up' }]],
  ['\x1b[B', [{ name: 'down' }]],
  ['\x1b[C', [{ name: 'right' }]],
  ['\x1b[D', [{ name: 'left' }]],
  ['\x1b[1;5C', [{ name: 'right', ctrl: true }]],
  ['\x1bOD', [{ name: 'left' }]],
  ['\x1b[H', [{ name: 'home' }]],
  ['\x1b[F', [{ name: 'end' }]],
  ['\x1b[1~', [{ name: 'home' }]],
  ['\x1b[4~', [{ name: 'end' }]],
  ['\x1b[3~', [{ name: 'delete' }]],
  ['\x1b[5~', [{ name: 'pageup' }]],
  ['\x1b[6~', [{ name: 'pagedown' }]],
  ['\x03', [{ name: 'char', text: 'c', ctrl: true }]],
  ['\x17', [{ name: 'char', text: 'w', ctrl: true }]],
  ['\x1b[99;5u', [{ name: 'char', text: 'c', ctrl: true }]],
  ['\x1bb', [{ name: 'char', text: 'b', alt: true }]],
  ['\x1b[98;3u', [{ name: 'char', text: 'b', alt: true }]],
  ['\x1b[97;2u', [{ name: 'char', text: 'A', shift: true }]],
  ['\x1b[200~pasted\x1b[201~', [{ name: 'paste', text: 'pasted' }]],
  ['ab\rcd', [{ name: 'char', text: 'ab' }, { name: 'enter' }, {
    name: 'char',
    text: 'cd',
  }]],
  ['\x1b[200~a\nb\x1b[201~!', [{ name: 'paste', text: 'a\nb' }, {
    name: 'char',
    text: '!',
  }]],
]

Deno.test('every binding decodes to one key', () => {
  for (let [bytes, keys] of table) assertEquals(decode(bytes), keys, bytes)
})

Deno.test('a paste split across reads arrives as one key', () => {
  let read = feed()
  assertEquals(read('\x1b[200~one '), [])
  assertEquals(read('two'), [])
  assertEquals(read('three\x1b[201~x'), [
    { name: 'paste', text: 'one twothree' },
    { name: 'char', text: 'x' },
  ])
})

Deno.test('Kitty replies are protocol data, never text, at every chunk boundary', () => {
  for (
    let response of [
      '\x1b_Gi=0;OK\x1b\\',
      '\x1b_Gi=17;EINVAL: unsupported image\x1b\\',
      '\x1bPtmux;\x1b\x1b_Gi=0;OK\x1b\x1b\\\x1b\\',
    ]
  ) {
    for (let split = 0; split <= response.length; split++) {
      let replies: string[] = []
      let read = feed((body) => replies.push(body))
      assertEquals(
        [
          ...read('before' + response.slice(0, split)),
          ...read(response.slice(split) + 'after'),
        ].map((key) => key.name == 'char' ? key.text : key.name).join(''),
        'beforeafter',
      )
      assertEquals(replies.length, 1)
      assertEquals(replies[0].startsWith('Gi='), true)
    }
  }
  assertEquals(decode('\x1b_Gi=0;OK\x1b\\'), [])
})

Deno.test('bare Escape flushes separately and paste remains literal', () => {
  let read = feed()
  assertEquals(read('\x1b'), [])
  assertEquals(read.flush(), [{ name: 'escape' }])
  assertEquals(read.flush(), [])
  assertEquals(read('\x1b_Gi=0;'), [])
  assertEquals(read.flush(), [])
  assertEquals(read('OK\x1b\\'), [])
  let text = '\x1b_Gi=0;OK\x1b\\'
  assertEquals(read('\x1b[200~' + text + '\x1b[201~'), [{
    name: 'paste',
    text,
  }])
})

Deno.test('oversized terminal control replies are discarded with bounded buffering', () => {
  let replies: string[] = []
  let read = feed((body) => replies.push(body))
  assertEquals(read('\x1b_G' + 'x'.repeat(9000)), [])
  assertEquals(read('y'.repeat(9000)), [])
  assertEquals(read('\x1b'), [])
  assertEquals(read('\\safe'), [{ name: 'char', text: 'safe' }])
  assertEquals(replies, [])
})

Deno.test('modified Enter survives every stdin boundary without submitting', () => {
  for (
    let [bytes, key] of [
      ['\x1b[13;2u', { name: 'enter', shift: true }],
      ['\x1b[27;2;13~', { name: 'enter', shift: true }],
      ['\x1b[13;3u', { name: 'enter', alt: true }],
      ['\x1b\r', { name: 'enter', alt: true }],
      ['\x1b\n', { name: 'enter', alt: true }],
      ['\x1bOA', { name: 'up' }],
    ] as const
  ) {
    for (let split = 0; split <= bytes.length; split++) {
      let read = feed()
      assertEquals([
        ...read(bytes.slice(0, split)),
        ...read(bytes.slice(split)),
      ], [key])
    }
    let read = feed()
    assertEquals([...bytes].flatMap((byte) => read(byte)), [key])
  }
})

Deno.test('partial CSI does not expire into keys; plain Enter stays Enter', () => {
  let read = feed()
  assertEquals(read('\x1b[27;2;'), [])
  assertEquals(read.flush(), [])
  assertEquals(read('13~'), [{ name: 'enter', shift: true }])
  assertEquals(read('\r\n'), [{ name: 'enter' }, { name: 'enter' }])
  assertEquals(read('hello'), [{ name: 'char', text: 'hello' }])
})

Deno.test('terminal focus reports survive every chunk boundary and paste stays literal', () => {
  for (
    let [bytes, name] of [['\x1b[I', 'focusin'], [
      '\x1b[O',
      'focusout',
    ]] as const
  ) {
    assertEquals(decode(bytes), [{ name }])
    for (let i = 1; i < bytes.length; i++) {
      let read = feed()
      assertEquals(read(bytes.slice(0, i)), [])
      assertEquals(read(bytes.slice(i)), [{ name }])
    }
  }
  assertEquals(decode('\x1b[200~\x1b[O\x1b[201~'), [{
    name: 'paste',
    text: '\x1b[O',
  }])
})
