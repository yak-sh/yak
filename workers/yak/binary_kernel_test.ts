import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { BINARY, binary, decode } from '@yaks/vocab/wire'
import { appKeywords } from './vocab.ts'
import { client, connector, kernel, seed } from './probe.ts'

// A person's app vocabulary, not a platform-owned declaration: both doors
// must decode before admission, and ordinary JSON tags must stay JSON.
test('an app stores binary properties through JSON and raw HTTP bodies without reinterpreting JSON', async () => {
  let k = await kernel()
  let slug = `bytes${crypto.randomUUID().slice(0, 8)}`
  let them = await seed(k, [{ slug, apps: ['documents'] }])
  let agent = connector(k, them.cookie)
  let host = `${slug}.yaks.app`, at = { space: slug, app: 'documents' }
  let files = client(k, host, 'documents', them.cookie)
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
  let vocab = loadVocab(doc)
  let literal = { $bytes: '00ff80', encoding: 'hex' }
  let expected = Uint8Array.of(0, 255, 128)
  let rows = async () => {
    let r = await k.at(host, '/documents/api/query?q=.document', {
      headers: { cookie: them.cookie },
    })
    ok(r.ok, await r.clone().text())
    return decode(vocab, await r.json())
  }
  try {
    await files.put('/index.html', '<h1>Documents</h1>')
    await files.put('/vocab.json', JSON.stringify(doc))
    await agent.tool('app_deploy', at)
    let schema = await k.at(host, '/documents/api/vocab.json', {
      headers: { cookie: them.cookie },
    })
    ok(schema.ok, await schema.clone().text())
    equal(
      loadVocab(await schema.json(), appKeywords).prop('document', 'bytes')
        ?.scalar,
      'binary',
    )
    for (let encoding of ['base64', 'hex', 'raw']) {
      let bytes = encoding == 'raw'
        ? Uint8Array.of(55, 0, 255, 128, 55).subarray(1, 4)
        : { $bytes: encoding == 'hex' ? '00ff80' : 'AP+A', encoding }
      let bundle = [{
        entity: { eid: encoding },
        document: { bytes, value: literal },
      }]
      let r = await k.at(host, '/documents/api/apply', {
        method: 'POST',
        headers: {
          cookie: them.cookie,
          'content-type': encoding == 'raw' ? BINARY : 'application/json',
        },
        body: encoding == 'raw' ? binary(bundle) : JSON.stringify(bundle),
      })
      ok(r.ok, await r.clone().text())
      let applied = decode(vocab, await r.json())
      let written = (Array.isArray(applied) ? applied : applied.entities).find((
        b: { entity: { eid: string } },
      ) => b.entity.eid == encoding)
      equal(written.document.bytes, expected)
      equal(written.document.value, literal)
    }
    let found = await rows()
    equal(found.length, 3)
    for (let b of found) {
      equal(b.document.bytes, expected)
      equal(b.document.value, literal)
    }
    // A malformed envelope is refused before apply, preserving prior values.
    let malformed = binary([{
      entity: { eid: 'raw' },
      document: { bytes: Uint8Array.of(1, 2, 3) },
    }])
    let refused = await k.at(host, '/documents/api/apply', {
      method: 'POST',
      headers: { cookie: them.cookie, 'content-type': BINARY },
      body: malformed.slice(0, malformed.length - 1).buffer as ArrayBuffer,
    })
    equal(refused.status, 400)
    equal(
      (await rows()).find((b: { entity: { eid: string } }) =>
        b.entity.eid == 'raw'
      ).document.bytes,
      expected,
    )
  } finally {
    await agent.tool('app_delete', { ...at, forever: true })
    await agent.tool('space_delete', { space: slug, forever: true })
  }
})
