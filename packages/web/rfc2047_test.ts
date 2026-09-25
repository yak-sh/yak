// The encoded-word decoder, table-tested: Q and B, folds, fallbacks.
import { unmime } from './rfc2047.ts'
let { assertEquals } = await import('@std/assert')

let cases: [string, string, string][] = [
  [
    'plain text untouched',
    'Fleet digest — mail is live',
    'Fleet digest — mail is live',
  ],
  ['Q basic', '=?UTF-8?Q?caf=C3=A9?=', 'café'],
  ['Q underscore is space', '=?UTF-8?Q?a_b?=', 'a b'],
  ['Q case-insensitive markers', '=?utf-8?q?=E2=80=94?=', '—'],
  ['B basic', '=?UTF-8?B?Y2Fmw6k=?=', 'café'],
  ['B latin1 charset', '=?ISO-8859-1?B?Y2Fm6Q==?=', 'café'],
  ['Q latin1 charset', '=?iso-8859-1?Q?caf=E9?=', 'café'],
  [
    'adjacent words join without the separating space',
    '=?UTF-8?Q?ab?= =?UTF-8?Q?cd?=',
    'abcd',
  ],
  [
    'folded continuation (newline + indent) joins too',
    '=?UTF-8?Q?ab?=\r\n =?UTF-8?Q?cd?=',
    'abcd',
  ],
  [
    'space between word and plain text is kept',
    '=?UTF-8?Q?Re=3A?= hello',
    'Re: hello',
  ],
  [
    'unknown charset degrades to the raw token',
    '=?X-KLINGON?Q?ab?=',
    '=?X-KLINGON?Q?ab?=',
  ],
  [
    'bad base64 degrades to the raw token',
    '=?UTF-8?B?%%%?=',
    '=?UTF-8?B?%%%?=',
  ],
  [
    'invalid utf-8 bytes degrade to the raw token',
    '=?UTF-8?Q?=FF=FE?=',
    '=?UTF-8?Q?=FF=FE?=',
  ],
  [
    'charset language tag (RFC 2231) is stripped',
    '=?UTF-8*en?Q?caf=C3=A9?=',
    'café',
  ],
  [
    'live specimen: E-4388, two folded Q words',
    '=?UTF-8?Q?Re=3A_=5BPrintBound=5D_digest=3A_picture=2Dbook_pipeline_built?= =?UTF-8?Q?_=E2=80=94_not_live_yet_=28image=2Dmoderation_legal_gate=29?=',
    'Re: [PrintBound] digest: picture-book pipeline built — not live yet (image-moderation legal gate)',
  ],
]

Deno.test('unmime: the RFC 2047 display table', () => {
  for (let [name, input, want] of cases) assertEquals(unmime(input), want, name)
})
