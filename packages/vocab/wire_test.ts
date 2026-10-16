// The wire's reserved bytes tag belongs only to binary properties. Header
// references have meaning only in a binary envelope, never in ordinary JSON.
import { equal, test, throws } from '@yaks/testing'
import { loadVocab } from './mod.ts'
import { binary, decode, stringify, unpack } from './wire.ts'

let vocab = loadVocab({
  $defs: {
    payload: {
      component: true,
      properties: {
        data: { type: 'string', contentEncoding: 'base64' },
        json: { type: 'object' },
      },
    },
  },
})
let entity = { eid: 'p' }
let data = new Uint8Array([0, 255, 128])
let literal = { $bytes: 0, length: 3 }

test('binary envelopes preserve raw payloads and literal offset tags in JSON properties', () => {
  let input = [{ entity, payload: { data, json: literal } }]
  let packet = unpack(binary(input))
  equal(decode(vocab, packet.value, packet.payload), input)
  equal(decode(vocab, JSON.parse(stringify(input))), input)
})

test('JSON only decodes declared binary property values, not nested tags or guards', () => {
  let tag = { $bytes: '00ff80', encoding: 'hex' }
  let input = {
    entity,
    payload: { data: tag, json: { nested: tag } },
    $was: { payload: { data: '00ff80' } },
  }
  equal<unknown>(decode(vocab, input), {
    ...input,
    payload: { data, json: input.payload.json },
  })
  equal(decode(vocab, [{ entity, unknown: { data: tag } }]), [{
    entity,
    unknown: { data: tag },
  }])
  equal(decode(vocab, { entity, payload: { json: tag } }).payload.json, tag)
  equal(
    decode(vocab, { entity, payload: { json: literal } }).payload.json,
    literal,
  )
})

test('binary strings accept canonical padded/unpadded base64 and empty bytes', async () => {
  for (let encoded of ['AA', 'AA==', '']) {
    equal<unknown>(
      decode(vocab, { entity, payload: { data: encoded } }).payload.data,
      encoded ? new Uint8Array([0]) : new Uint8Array(),
    )
  }
  for (let encoded of ['AB==', 'AB', 'A', 'AA=', ' A A ', '%%']) {
    await throws(() => decode(vocab, { entity, payload: { data: encoded } }))
  }
})

test('binary envelopes refuse truncated headers, invalid JSON/UTF8 and invalid byte bounds', async () => {
  for (
    let raw of [
      new Uint8Array(0),
      new Uint8Array([0, 0, 0, 8]),
      new Uint8Array([0, 0, 0, 1, 255]),
    ]
  ) {
    await throws(() => unpack(raw))
  }
  for (
    let ref of [
      { $bytes: -1, length: 1 },
      { $bytes: 0, length: 4 },
      { $bytes: 0.1, length: 1 },
      { $bytes: 0, length: -1 },
      { $bytes: 4, length: 0 },
    ]
  ) {
    await throws(() => decode(vocab, { entity, payload: { data: ref } }, data))
  }
})
