// Bytes cross the actual HTTP and websocket doors without stealing the meaning
// of an ordinary JSON object which happens to look like the binary tag.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { BINARY, binary, decode } from '@yaks/vocab/wire'
import { api } from './route.ts'
import { attach } from './socket.ts'
import { subscriptions } from './subs.ts'
import { fake, req } from './testing.ts'

let vocab = loadVocab({
  $defs: {
    payload: {
      component: true,
      properties: {
        data: { type: 'string', contentEncoding: 'base64' },
        json: { type: 'object' },
      },
    },
    motion: {
      component: true,
      sync: 'peers',
      durable: 'connection',
      properties: { data: { type: 'string', contentEncoding: 'base64' } },
    },
  },
})
let make = () => graph({ vocab, storage: ram(vocab) })
let streamed = make()
let expected = new Uint8Array([0, 255, 128])
let tag = { $bytes: '00ff80', encoding: 'hex' }

for (let data of ['AP+A', { $bytes: 'AP+A', encoding: 'base64' }, tag]) {
  let http = make()
  test(`HTTP binary apply/query roundtrip ${JSON.stringify(data)}`, async () => {
    let handler = api({ graph: http })
    let res = await handler(req('/apply', {
      method: 'POST',
      body: JSON.stringify([{
        entity: { eid: 'p' },
        payload: { data, json: tag },
      }]),
    }))
    equal(res.status, 200)
    let applied = decode(vocab, await res.json())
    equal(applied[0].payload.data, expected)
    equal(applied[0].payload.json, tag)
    let rows = await http.read('.payload')
    equal(rows[0].payload, { data: expected, json: tag })
    res = await handler(req('/query?q=.payload'))
    let raw = await res.json()
    equal(raw[0].payload.data, { $bytes: 'AP+A', encoding: 'base64' })
    equal(decode(vocab, raw)[0].payload, { data: expected, json: tag })
  })
}

test('NDJSON apply emits binary values and preserves literal JSON tags', async () => {
  let response = await api({ graph: streamed })(req('/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body: JSON.stringify(
      [{ entity: { eid: 'p' }, payload: { data: tag, json: tag } }][0],
    ) + '\n',
  }))
  let row = JSON.parse((await response.text()).trim())
  equal(row.payload.data, { $bytes: 'AP+A', encoding: 'base64' })
  equal(row.payload.json, tag)
})

let socketFixture = async () => {
  let g = make()
  await g.apply([{
    entity: { eid: 'p' },
    payload: { data: expected, json: tag },
  }])
  let subs = subscriptions(g)
  let reader = fake(), writer = fake()
  let due: (() => void)[] = []
  attach(subs, reader, (fn) => due.push(fn))
  attach(subs, writer, (fn) => due.push(fn))
  let subscribe = JSON.stringify({ id: 's', subscribe: '.payload&?motion' })
  let close = () => {
    reader.emit('close')
    writer.emit('close')
  }
  return { subs, reader, writer, due, subscribe, close }
}

let subscribing = await socketFixture()
test('socket subscription sends bytes and leaves JSON tags as objects', () => {
  let { reader, subscribe, close } = subscribing
  try {
    reader.emit('message', subscribe)
    equal(reader.sent[0].bundles?.[0].payload, {
      data: { $bytes: 'AP+A', encoding: 'base64' },
      json: tag,
    })
  } finally {
    close()
  }
})

for (let data of [tag, { $bytes: 'AP+A', encoding: 'base64' }]) {
  let { subs, reader, writer, due, subscribe, close } = await socketFixture()
  reader.emit('message', subscribe)
  reader.taken()
  let message = JSON.stringify({
    relay: [{ entity: { eid: 'p' }, motion: { data } }],
  })
  test(`socket relay accepts ${data.encoding} and subscription sends bytes`, async () => {
    try {
      writer.emit('message', message)
      await subs.check()
      while (due.length) due.shift()!()
      let frame = reader.taken().findLast((f) => f.relay?.length)
      equal(frame?.relay?.[0].motion, {
        data: { $bytes: 'AP+A', encoding: 'base64' },
      })
    } finally {
      close()
    }
  })
}

let rawHttp = make()
test('HTTP raw binary body lands bytes and rejects invalid references before apply', async () => {
  let handler = api({ graph: rawHttp })
  let res = await handler(req('/apply', {
    method: 'POST',
    headers: { 'content-type': BINARY },
    body: binary([{
      entity: { eid: 'raw' },
      payload: { data: expected, json: { $bytes: 0, length: 3 } },
    }]),
  }))
  equal(res.status, 200)
  equal((await rawHttp.read('.payload'))[0].payload, {
    data: expected,
    json: { $bytes: 0, length: 3 },
  })
  res = await handler(req('/apply', {
    method: 'POST',
    headers: { 'content-type': BINARY },
    body: binary([{
      entity: { eid: 'bad' },
      payload: { data: { $bytes: 100, length: 1 } },
    }]),
  }))
  equal(res.status, 400)
  equal(await rawHttp.get(['bad']), [])
})

let rawSocketGraph = make()
let rawSubs = subscriptions(rawSocketGraph)
let rawSocket = fake()
attach(rawSubs, rawSocket)
test('socket binary ArrayBuffer relay decodes raw bytes and refuses invalid references', async () => {
  let subs = rawSubs, socket = rawSocket
  socket.emit(
    'message',
    binary({ relay: [{ entity: { eid: 'raw' }, motion: { data: expected } }] })
      .buffer,
  )
  await subs.check()
  equal((await subs.read('.motion'))[0].motion, { data: expected })
  socket.emit(
    'message',
    binary({
      id: 'bad',
      relay: [{
        entity: { eid: 'bad' },
        motion: { data: { $bytes: 9, length: 1 } },
      }],
    }).buffer,
  )
  equal(socket.sent.at(-1)?.refused?.error, 'Refused')
  equal(await subs.snapshot('.entity.eid=bad&.motion'), [])
  socket.emit('close')
})
