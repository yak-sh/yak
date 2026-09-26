// A page's own sound, played so the browser's echo canceller hears it.
//
// Chrome cancels what a media element plays from the microphone, and not what
// Web Audio plays: a page that places voices in space with Web Audio sends
// each listener's loudspeakers back into their microphone, and every speaker
// hears themselves a moment later. Played through an <audio> element it is
// cancelled, but an element fed straight from a MediaStreamDestination is not
// either; one fed from a remote WebRTC track is. So the loop is two
// RTCPeerConnections inside the page: Web Audio's mix goes into one, comes out
// of the other as a remote track, and plays through an <audio>.
//
// The mix stays stereo, since a voice placed in space is nothing without its
// left and right: Opus is asked for two channels at a bitrate for music, not
// for a voice. The loop adds some 40 ms (a 16 ms jitter buffer and a 20 ms
// Opus frame, measured in Chrome 150), so a page routes through it only while
// a microphone is open.

/** A loop: connect sound `into` it and it plays through an <audio> element
 * once `ready`; `stop` ends it. */
export type Loop = { into: AudioNode; ready: Promise<void>; stop: () => void }

// Opus in both directions as two channels, at up to 256 kbit/s.
let stereo = (d: RTCSessionDescriptionInit): RTCSessionDescriptionInit => {
  let sdp = d.sdp ?? ''
  let pt = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)?.[1]
  if (!pt) return d
  return {
    type: d.type,
    sdp: sdp.replace(
      new RegExp(`a=fmtp:${pt} (.*)`),
      (_, params) =>
        `a=fmtp:${pt} ${params};stereo=1;sprop-stereo=1;maxaveragebitrate=256000`,
    ),
  }
}

/** A loop for Web Audio on `ctx` that the echo canceller hears. It is
 * `ready` once the two ends have met and the element plays, a moment after it
 * is made; until then, and if it never is, sound connected into it is not
 * heard, so a page moves its mix over once it is. */
export let loopback = (ctx: AudioContext): Loop => {
  let into = ctx.createMediaStreamDestination()
  let send = new RTCPeerConnection()
  let hear = new RTCPeerConnection()
  let out = new Audio()
  send.onicecandidate = (e) => e.candidate && hear.addIceCandidate(e.candidate)
  hear.onicecandidate = (e) => e.candidate && send.addIceCandidate(e.candidate)
  let track = new Promise<MediaStreamTrack>((ok) =>
    hear.ontrack = (e) => ok(e.track)
  )
  send.addTrack(into.stream.getAudioTracks()[0], into.stream)
  let ready = (async () => {
    let offer = await send.createOffer()
    await send.setLocalDescription(offer)
    await hear.setRemoteDescription(stereo(offer))
    let answer = stereo(await hear.createAnswer())
    await hear.setLocalDescription(answer)
    await send.setRemoteDescription(answer)
    out.srcObject = new MediaStream([await track])
    await out.play()
  })()
  return {
    into,
    ready,
    stop: () => {
      out.pause()
      out.srcObject = null
      send.close()
      hear.close()
      into.disconnect()
    },
  }
}
