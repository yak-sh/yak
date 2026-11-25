// A stand-in for OBS Studio's WebSocket server (v5) with the obs-ptz plugin
// and one camera: it asks for a password, keeps scenes and a program scene,
// and keeps the camera's preset and zoom, so the desk can be tried with no
// OBS and no camera. Run it alone for a hand check of the page on this
// computer: `deno run --allow-net apps/stream-desk/mock_obs.ts` serves
// ws://localhost:4455 with the password "desk".
import { secret } from './obs.js'

// A PNG of one colour, made here so no picture is kept in git: what the
// mock answers for a still of a scene.
let crcs = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
let crc = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (let b of bytes) c = crcs[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
let chunk = (type: string, data: Uint8Array) => {
  let out = new Uint8Array(12 + data.length)
  let view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
  return out
}
let deflate = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  )
export let png = async (w: number, h: number, [r, g, b]: number[]) => {
  let head = new Uint8Array(13)
  let view = new DataView(head.buffer)
  view.setUint32(0, w)
  view.setUint32(4, h)
  head.set([8, 2, 0, 0, 0], 8)
  let rows = new Uint8Array(h * (1 + w * 3))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rows.set([r, g, b], y * (1 + w * 3) + 1 + x * 3)
  }
  let parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array()),
  ]
  let bytes = new Uint8Array(await new Blob(parts).arrayBuffer())
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}
let COLOURS = [[40, 70, 160], [170, 120, 60], [60, 140, 80], [120, 60, 120]]

export type Camera = { preset: string | null; zoom: number; moves: number[] }

let refuse = (code: number, comment: string) => ({
  result: false,
  code,
  comment,
})

/** Serves a mock OBS on `port` (0 picks one). `state` is what it shows;
 * `asked` lists every request type it was sent, in order. */
export let mockObs = (
  {
    password = 'desk',
    scenes = ['Projector', 'Camera', 'PIP'],
    port = 0,
  } = {},
) => {
  let state = {
    program: scenes[0],
    camera: { preset: null, zoom: 0, moves: [] } as Camera,
  }
  let asked: string[] = []
  let heard = new Set<{ socket: WebSocket; hears: number }>()
  let emit = (eventType: string, eventData: unknown, category: number) => {
    for (let { socket, hears } of heard) {
      if (hears & category) {
        socket.send(
          JSON.stringify({
            op: 5,
            d: { eventType, eventIntent: category, eventData },
          }),
        )
      }
    }
  }
  let ptz = (type: string, data: Record<string, unknown>) => {
    if (data.device != 'selected') return refuse(600, 'No such PTZ device.')
    if (type == 'ptz_preset_recall') state.camera.preset = String(data.id)
    else if (type == 'ptz_move') {
      let zoom = Number(data.zoom ?? 0)
      state.camera.moves.push(zoom)
      state.camera.zoom += zoom
    } else return refuse(204, `Unknown obs-ptz request ${type}.`)
    return { result: true, code: 100 }
  }
  let answer = async (type: string, data: Record<string, unknown>) => {
    if (type == 'GetSourceScreenshot') {
      let name = String(data.sourceName)
      let at = scenes.indexOf(name)
      if (at < 0) {
        return {
          status: refuse(
            600,
            `No source was found by the name of \`${name}\`.`,
          ),
        }
      }
      let w = Number(data.imageWidth ?? 64)
      return {
        status: { result: true, code: 100 },
        data: {
          imageData: await png(w, Math.round(w * 9 / 16), COLOURS[at % 4]),
        },
      }
    }
    if (type == 'GetSceneList') {
      return {
        status: { result: true, code: 100 },
        data: {
          currentProgramSceneName: state.program,
          scenes: scenes.toReversed().map((sceneName, i) => ({
            sceneName,
            sceneIndex: i,
          })),
        },
      }
    }
    if (type == 'SetCurrentProgramScene') {
      let name = String(data.sceneName)
      if (!scenes.includes(name)) {
        return {
          status: refuse(
            600,
            `No source was found by the name of \`${name}\`.`,
          ),
        }
      }
      state.program = name
      emit('CurrentProgramSceneChanged', { sceneName: name }, 1 << 2)
      return { status: { result: true, code: 100 } }
    }
    if (type == 'CallVendorRequest') {
      if (data.vendorName != 'obs-ptz') {
        return { status: refuse(604, 'No such vendor.') }
      }
      let inner = data.requestData as Record<string, unknown>
      return {
        status: ptz(String(data.requestType), inner ?? {}),
        data: {
          vendorName: 'obs-ptz',
          requestType: data.requestType,
          responseData: {},
        },
      }
    }
    return { status: refuse(204, `Unknown request ${type}.`) }
  }
  let server = Deno.serve({ port, onListen: () => {} }, (req) => {
    let { socket, response } = Deno.upgradeWebSocket(req)
    let auth = {
      challenge: btoa(crypto.randomUUID()),
      salt: btoa(crypto.randomUUID()),
    }
    let me = { socket, hears: 0 }
    socket.onopen = () =>
      socket.send(JSON.stringify({
        op: 0,
        d: {
          obsStudioVersion: '32.0.0',
          obsWebSocketVersion: '5.6.0',
          rpcVersion: 1,
          authentication: auth,
        },
      }))
    socket.onmessage = async ({ data }) => {
      let { op, d } = JSON.parse(data)
      if (op == 1) {
        if (d.authentication != await secret(password, auth)) {
          return socket.close(4009, 'Authentication failed.')
        }
        me.hears = d.eventSubscriptions ?? 0
        heard.add(me)
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }))
      } else if (op == 6) {
        asked.push(
          d.requestType == 'CallVendorRequest'
            ? d.requestData.requestType
            : d.requestType,
        )
        let { status, data } = await answer(d.requestType, d.requestData ?? {})
        socket.send(JSON.stringify({
          op: 7,
          d: {
            requestType: d.requestType,
            requestId: d.requestId,
            requestStatus: status,
            ...data ? { responseData: data } : {},
          },
        }))
      }
    }
    socket.onclose = () => heard.delete(me)
    return response
  })
  return {
    url: `ws://localhost:${server.addr.port}`,
    state,
    asked,
    /** Switches the scene as someone at OBS itself would. */
    cut: (name: string) => {
      state.program = name
      emit('CurrentProgramSceneChanged', { sceneName: name }, 1 << 2)
    },
    [Symbol.asyncDispose]: async () => {
      for (let { socket } of heard) socket.close()
      await server.shutdown()
    },
  }
}

if (import.meta.main) {
  let obs = mockObs({ port: 4455 })
  console.log(`A mock OBS at ${obs.url}, password "desk".`)
}
