// OBS Studio's WebSocket server, version 5
// (https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md):
// connect, answer its challenge, send requests and hear events. The camera is
// reached through the same socket, by the obs-ptz plugin's vendor requests
// (https://github.com/glikely/obs-ptz/blob/main/docs/ptz-device-api.md).

let OP = {
  hello: 0,
  identify: 1,
  identified: 2,
  event: 5,
  request: 6,
  answer: 7,
}

/** The event categories the desk hears: scenes, and vendors (obs-ptz). */
export let HEARS = (1 << 2) | (1 << 9)

let sha = async (text) =>
  btoa(String.fromCharCode(
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
    ),
  ))

/** The answer to OBS's challenge: base64(sha256(base64(sha256(password +
 * salt)) + challenge)). */
export let secret = async (password, { salt, challenge }) =>
  sha(await sha(password + salt) + challenge)

/** Connects to OBS at `url` and resolves once it has identified us, to
 * `{call, on, close, closed}`. `call(type, data)` resolves to the request's
 * responseData and rejects with OBS's comment; `on(fn)` hears each event as
 * `fn(type, data)`; `closed` resolves with the reason the socket closed. */
export let connect = (url, password = '', hears = HEARS) =>
  new Promise((resolve, reject) => {
    let socket = new WebSocket(url)
    let waiting = new Map()
    let heard = new Set()
    let n = 0
    let send = (op, d) => socket.send(JSON.stringify({ op, d }))
    let ended
    let obs = {
      call: (requestType, requestData = {}) =>
        new Promise((ok, fail) => {
          let requestId = String(++n)
          waiting.set(requestId, { ok, fail })
          send(OP.request, { requestType, requestId, requestData })
        }),
      on: (fn) => heard.add(fn),
      close: () => socket.close(),
      closed: new Promise((done) => ended = done),
    }
    socket.onmessage = async ({ data }) => {
      let { op, d } = JSON.parse(data)
      if (op == OP.hello) {
        send(OP.identify, {
          rpcVersion: 1,
          eventSubscriptions: hears,
          ...d.authentication
            ? { authentication: await secret(password, d.authentication) }
            : {},
        })
      } else if (op == OP.identified) resolve(obs)
      else if (op == OP.event) {
        for (let fn of heard) fn(d.eventType, d.eventData ?? {})
      } else if (op == OP.answer) {
        let asked = waiting.get(d.requestId)
        waiting.delete(d.requestId)
        let { result, code, comment } = d.requestStatus
        if (result) asked?.ok(d.responseData ?? {})
        else asked?.fail(new Error(comment ?? `OBS refused (${code})`))
      }
    }
    socket.onclose = ({ code, reason }) => {
      let why = new Error(
        code == 4009
          ? 'OBS refused the password'
          : reason || `OBS closed the connection (${code})`,
      )
      reject(why)
      for (let { fail } of waiting.values()) fail(why)
      waiting.clear()
      ended(why.message)
    }
  })

/** An obs-ptz request to the camera selected in OBS's PTZ dock. */
export let ptz = (requestType, data = {}) => [
  'CallVendorRequest',
  {
    vendorName: 'obs-ptz',
    requestType,
    requestData: { device: 'selected', ...data },
  },
]
