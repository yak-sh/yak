// The desk's ears: an audio input (the mixer's feed) heard live through
// ./api/speech/listen, each finished turn handed to `heard({text, from, to})`
// in seconds of the recording. The page keeps the audio not yet told, so a
// socket that drops is opened again where it stood (models.md, "Hearing as it
// is spoken"). Answers `{at(), stop()}`: the second the recording reached.
export let listen = async (stream, heard) => {
  let ctx = new AudioContext()
  await ctx.audioWorklet.addModule('./pcm.js')
  let node = new AudioWorkletNode(ctx, 'pcm')
  ctx.createMediaStreamSource(stream).connect(node).connect(ctx.destination)
  let rate = ctx.sampleRate
  let recorded = 0
  let kept = []
  let ws
  let stopped = false
  let seconds = (chunk) => chunk.byteLength / 2 / rate
  let open = (at) => {
    let url = new URL(
      `./api/speech/listen?rate=${rate}&at=${at}`,
      location.href,
    )
    url.protocol = url.protocol.replace('http', 'ws')
    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
      for (let c of kept) if (c.at >= at) ws.send(c.data)
    }
    ws.onmessage = ({ data }) => {
      let m = JSON.parse(data)
      if (m.type == 'turn') {
        heard(m)
        kept = kept.filter((c) => c.at + seconds(c.data) > m.to)
      }
      if (m.type == 'done' || m.type == 'error' && m.code != 'speech_failed') {
        ws.onclose = null
      }
    }
    ws.onclose = () =>
      !stopped && setTimeout(() => open(kept[0]?.at ?? recorded), 1000)
  }
  node.port.onmessage = ({ data }) => {
    kept.push({ at: recorded, data })
    recorded += seconds(data)
    if (ws.readyState == 1) ws.send(data)
  }
  open(0)
  return {
    at: () => recorded,
    stop: () => {
      stopped = true
      ws.close()
      for (let t of stream.getTracks()) t.stop()
      ctx.close()
    },
  }
}
