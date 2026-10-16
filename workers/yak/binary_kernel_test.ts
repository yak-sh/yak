/// <reference lib="deno.ns" />
// App binary admission through the store's binary normalization and HTTP
// handler, without deployment or kernel startup in the measured cases.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { api, refuse } from '@yaks/api'
import { loadVocab } from '@yaks/vocab'
import { BINARY, binary, decode } from '@yaks/vocab/wire'
import { appKeywords } from './vocab.ts'
import { binaryRequest, isBinaryApply } from './binary.ts'

let doc = {
  $defs: {
    document: {
      component: true,
      type: 'object',
      properties: {
        bytes: { type: 'string', contentEncoding: 'base64' },
        value: { type: 'object' },
      },
    },
  },
}
let vocab = loadVocab(doc, appKeywords)
let literal = { $bytes: '00ff80', encoding: 'hex' }
let expected = Uint8Array.of(0, 255, 128)
let fixture = () => {
  let g = graph({ vocab, storage: ram(vocab) })
  let handler = api({ graph: g })
  // The store normalizes binary requests before its JSON admission handler;
  // refusals at either boundary use the same HTTP error mapping.
  let send = async (request: Request) => {
    try {
      return await handler(
        isBinaryApply(request) ? await binaryRequest(request, vocab) : request,
      )
    } catch (error) {
      return refuse(error)
    }
  }
  return { g, send }
}
let request = (body: BodyInit, raw = false) =>
  new Request('http://app/apply', {
    method: 'POST',
    headers: {
      'content-type': raw ? `${BINARY}; charset=utf-8` : 'application/json',
    },
    body,
  })

let schema = fixture()
let schemaRequest = new Request('http://app/vocab')
test('an app HTTP vocabulary retains its declared binary property', async () => {
  let response = await schema.send(schemaRequest)
  equal(response.status, 200)
  equal(
    loadVocab((await response.json()).docs, appKeywords).prop(
      'document',
      'bytes',
    )
      ?.scalar,
    'binary',
  )
})

for (let encoding of ['base64', 'hex', 'raw']) {
  let { send } = fixture()
  let bytes = encoding == 'raw'
    ? Uint8Array.of(55, 0, 255, 128, 55).subarray(1, 4)
    : { $bytes: encoding == 'hex' ? '00ff80' : 'AP+A', encoding }
  let bundle = [{
    entity: { eid: encoding },
    document: { bytes, value: literal },
  }]
  let apply = request(
    encoding == 'raw' ? binary(bundle) : JSON.stringify(bundle),
    encoding == 'raw',
  )
  let query = new Request('http://app/query?q=.document')
  test(`an app admits ${encoding} bytes through HTTP without reinterpreting JSON`, async () => {
    let response = await send(apply)
    equal(response.status, 200)
    let applied = decode(vocab, await response.json())
    equal(applied[0].document, { bytes: expected, value: literal })
    let found = await send(query)
    equal(found.status, 200)
    equal(decode(vocab, await found.json()), [{
      entity: { eid: encoding },
      document: { bytes: expected, value: literal },
    }])
  })
}

let malformed = fixture()
await malformed.g.apply([{
  entity: { eid: 'raw' },
  document: { bytes: expected, value: literal },
}])
let truncated = binary([{
  entity: { eid: 'raw' },
  document: { bytes: Uint8Array.of(1, 2, 3) },
}])
let badRequest = request(truncated.slice(0, truncated.length - 1), true)
test('an app refuses a truncated binary HTTP body before changing stored bytes', async () => {
  let response = await malformed.send(badRequest)
  equal(response.status, 400)
  equal((await malformed.g.get(['raw']))[0].document, {
    bytes: expected,
    value: literal,
  })
})
