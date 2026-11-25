// A stand-in for OBS Studio's WebSocket server (v5) with the obs-ptz plugin
// and one camera: it asks for a password, keeps scenes and a program scene,
// and keeps the camera's preset and zoom, so the desk can be tried with no
// OBS and no camera. Run it alone for a hand check of the page on this
// computer: `deno run --allow-net apps/stream-desk/mock_obs.ts` serves
// ws://localhost:4455 with the password "desk".
import { secret } from './obs.js'

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
  let answer = (type: string, data: Record<string, unknown>) => {
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
        let { status, data } = answer(d.requestType, d.requestData ?? {})
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
