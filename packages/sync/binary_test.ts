// A native-byte intent survives the outbox snapshot and JSON exchange; socket
// replies are interpreted through the client's vocabulary, not a JSON reviver.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { binary, decode, stringify } from '@yaks/vocab/wire'
import { exchange } from './outbound.ts'
import { durableOutbox } from './outbox.ts'
import { type Frame, wire } from './socket.ts'
import { pair } from './testing.ts'

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
let g = graph({ vocab, storage: ram(vocab) })
let data = new Uint8Array([0, 255, 128])
let tag = { $bytes: '00ff80', encoding: 'hex' }
let rows = [{ entity: { eid: 'p' }, payload: { data, json: tag } }]

test('outbox freezes native bytes and exchange sends/receives binary properties', async () => {
  let outbox = durableOutbox({
    scope: 'bytes',
    send: async (_key, sent: typeof rows) => {
      equal(sent[0].payload.data, data)
      let response = await exchange([], {
        graph: g,
        url: 'http://bytes.test',
        held: true,
        sent,
        report: (error) => {
          throw error
        },
        fetch: async (request) => {
          let raw = await request.json()
          equal(raw[0].payload.data, { $bytes: 'AP+A', encoding: 'base64' })
          equal(decode(vocab, raw), rows)
          return new Response(stringify(rows))
        },
      })
      equal(response.applied?.[0].payload, rows[0].payload)
      return response
    },
  })
  await outbox.submit(rows)
  equal((await g.read('.payload'))[0].payload, rows[0].payload)
  outbox.close()
})

test('socket lands batched binary rows and leaves JSON tags literal', () => {
  let socket = pair()
  let seen: Frame[] = []
  let w = wire({
    vocab,
    url: 'http://bytes.test',
    connect: () => socket.client,
    land: (frame) => {
      seen.push(frame)
    },
    report: (error) => {
      throw error
    },
  })
  w.subscribe('.payload', 's')
  socket.client.emit('open')
  for (let encoded of ['AP+A', { $bytes: '00ff80', encoding: 'hex' }]) {
    socket.server.send(JSON.stringify({
      frames: [{
        id: 's',
        bundles: [{
          entity: { eid: 'p' },
          payload: { data: encoded, json: tag },
        }],
      }],
      ack: 'bytes',
    }))
    equal(seen.at(-1)?.bundles?.[0].payload, rows[0].payload)
  }
  w.close()
})

test('socket accepts raw binary ArrayBuffer and Blob replies in arrival order', async () => {
  let sockets = pair(), seen: Frame[] = []
  let done: () => void = () => {}
  let landed = new Promise<void>((resolve) => {
    done = resolve
  })
  let w = wire({
    vocab,
    url: 'http://bytes.test',
    connect: () => sockets.client,
    land: (frame) => {
      seen.push(frame)
      if (seen.length == 3) done()
    },
    report: (error) => {
      throw error
    },
  })
  w.subscribe('.payload', 's')
  sockets.client.emit('open')
  let packed = binary({ id: 's', bundles: rows })
  sockets.client.emit('message', packed.buffer)
  sockets.client.emit('message', new Blob([packed]))
  sockets.client.emit('message', stringify({ id: 's', bundles: rows }))
  await landed
  equal(seen.map((f) => f.bundles?.[0].payload), [
    rows[0].payload,
    rows[0].payload,
    rows[0].payload,
  ])
  w.close()
})
