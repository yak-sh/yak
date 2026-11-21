// The relay: a process that can hold UDP, which a Worker cannot, joining a
// Discord voice room for its host and streaming the room's audio both ways
// over a WebSocket the host opened for it, as a phone provider streams a
// call's. It holds no bot token and no model key. The host's own Gateway
// socket joins the room (@yaks/discord `join`) and hands the relay what
// Discord answered: the bot's voice session, its voice server and token, and
// the address to stream to. The relay speaks Discord's voice protocol
// (@discordjs/voice, with @snazzah/davey for its end-to-end encryption) and
// the line @yaks/discord `line` reads, nothing more: who the Operator is,
// what it says and what it costs are the host's.
//
//   POST /join   a Join (./audio.ts), with `authorization: Bearer <KEY>`
//   POST /leave  {server}, the same
//   GET  /       how many rooms it is in
//
// A second join for a server it is in follows Discord to a new voice server
// with the same stream. The room's audio goes out whether or not anyone
// speaks, silence included, so the host can tell a quiet room from a lost
// line. A stream that drops is opened again while the room is held, as the
// host's object restarts under it on every deploy; a room Discord lets go
// of, or that the host's stream refuses, is left, and the stream told it
// stopped.
//
// Run it with `deno run -A packages/discord-voice/relay.ts`, given
// RELAY_KEY, the bearer a join must carry; RELAY_HOSTS, the hosts it streams
// to, comma separated (`yaks.app`); and PORT (8080).
import {
  type AudioPlayer,
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  type DiscordGatewayAdapterLibraryMethods,
  EndBehaviorType,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import OpusScript from 'opusscript'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import {
  FRAME_BYTES,
  frames,
  type Join,
  joined,
  mixed,
  say,
  sent,
  widener,
} from './audio.ts'

/** A room the relay is in, for as long as it holds it. */
type Room = {
  join: Join
  connection: VoiceConnection
  adapter: DiscordGatewayAdapterLibraryMethods
  leave: (why: string) => void
}

// How long Discord may keep a room disconnected, as it does while it moves
// the bot to another voice server, before the relay lets it go.
let MOVED = 5000

// How many of Discord's 20 ms frames go to the host in one message.
let BATCH = 5

// How long a dropped stream waits before it is opened again.
let AGAIN = 1000

let rooms = new Map<string, Room>()

let log = (what: string, more: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), what, ...more }))

// What each speaker said in the last 20 ms, decoded, by account; and their
// decoders, one each, as Opus keeps state between a speaker's frames.
let hearing = (connection: VoiceConnection, told: (user: string) => void) => {
  let heard = new Map<string, ReturnType<typeof frames>>()
  let decoders = new Map<string, OpusScript>()
  let listen = (user: string) => {
    told(user)
    if (heard.has(user)) return
    let queue = frames(FRAME_BYTES)
    heard.set(user, queue)
    let decoder = new OpusScript(48000, 2, OpusScript.Application.VOIP)
    decoders.set(user, decoder)
    let packets = connection.receiver.subscribe(user, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    })
    packets.on('data', (packet: Uint8Array) => {
      try {
        queue.put(new Uint8Array(decoder.decode(packet as never)))
      } catch (error) {
        log('undecoded', { user, error: String(error) })
      }
    })
    packets.on('end', () => {
      heard.delete(user)
      decoders.get(user)?.delete()
      decoders.delete(user)
    })
  }
  connection.receiver.speaking.on('start', listen)
  return {
    /** the next 20 ms of everyone, mixed */
    next: () =>
      mixed(
        [...heard.values()].flatMap((q) => {
          let f = q.take()
          return f ? [f] : []
        }),
      ),
    close: () => {
      connection.receiver.speaking.off('start', listen)
      for (let d of decoders.values()) d.delete()
      decoders.clear()
      heard.clear()
    },
  }
}

// What the host says, played into the room: a resource begun when audio
// comes to a player at rest, which ends when what was given has played.
// Audio waits while the room's connection is not `ready`, as a greeting
// said before it is would be lost, and plays once `resume` says it is.
// Marks are echoed once what came before them should have played.
let speaking = (
  player: AudioPlayer,
  echo: (mark: string) => void,
  ready: () => boolean,
) => {
  let queue = frames(FRAME_BYTES)
  let widen = widener()
  let ends = 0
  let marks: ReturnType<typeof setTimeout>[] = []
  let start = () => {
    if (!ready() || player.state.status != AudioPlayerStatus.Idle) return
    // What was given plays to its end, the last of it padded to a frame;
    // the sample the widener holds back waits for the next words.
    let source = Readable.from((async function* () {
      while (true) {
        let f = queue.take() ?? queue.drain()
        if (!f) return
        yield f
      }
    })())
    player.play(createAudioResource(source, { inputType: StreamType.Raw }))
  }
  return {
    play: (audio: Uint8Array) => {
      let wide = widen(audio)
      queue.put(wide)
      let now = Date.now()
      ends = Math.max(ends, now) + wide.length / (48 * 4)
      start()
    },
    /** the room is ready: what waited plays */
    resume: () => {
      ends = Date.now() + queue.length() / (48 * 4)
      start()
    },
    clear: () => {
      queue.clear()
      widen.flush()
      ends = Date.now()
      player.stop(true)
      for (let m of marks.splice(0)) clearTimeout(m)
    },
    mark: (name: string) => {
      let t = setTimeout(() => echo(name), Math.max(0, ends - Date.now()))
      marks.push(t)
    },
    close: () => {
      for (let m of marks.splice(0)) clearTimeout(m)
      player.stop(true)
    },
  }
}

// The host's stream for a room: opened, and opened again when it drops while
// the room is held. Frames for it wait while it is closed.
let streaming = (
  join: Join,
  heard: (data: string) => void,
  refused: () => void,
  held: () => boolean,
) => {
  let socket: WebSocket | undefined
  let open = () => {
    let ws = new WebSocket(join.stream)
    socket = ws
    ws.onopen = () => ws.send(say.start(`${join.server}:${join.room}`))
    ws.onmessage = (event) => heard(String(event.data))
    ws.onclose = (event) => {
      if (socket != ws) return
      socket = undefined
      if (!held()) return
      // The host's door answers a ticket it will not take with a refusal,
      // which a WebSocket sees as a close before it opened (code 1006, or 0
      // in Deno).
      if (!opened) return refused()
      log('stream dropped', { server: join.server, code: event.code })
      setTimeout(() => held() && open(), AGAIN)
    }
    let opened = false
    ws.addEventListener('open', () => opened = true)
  }
  open()
  return {
    send: (frame: string) => {
      if (socket?.readyState == WebSocket.OPEN) socket.send(frame)
    },
    close: () => {
      let s = socket
      socket = undefined
      if (s?.readyState == WebSocket.OPEN) s.send(say.stop())
      s?.close(1000)
    },
  }
}

/** Join the room `join` names, or follow Discord to the voice server it
 * names for a room the relay is in. */
export let enter = (join: Join) => {
  let had = rooms.get(join.server)
  if (had) {
    had.join = join
    had.adapter.onVoiceStateUpdate(stateOf(join) as never)
    had.adapter.onVoiceServerUpdate(serverOf(join) as never)
    log('moved', { server: join.server, room: join.room })
    return
  }
  let adapter!: DiscordGatewayAdapterLibraryMethods
  let connection = joinVoiceChannel({
    guildId: join.server,
    channelId: join.room,
    selfDeaf: false,
    selfMute: false,
    // The host's Gateway joined the room; the relay only connects.
    adapterCreator: (methods) => {
      adapter = methods
      return { sendPayload: () => true, destroy: () => {} }
    },
  })
  let left = false
  let held = () => !left && rooms.get(join.server) == room
  let player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  })
  connection.subscribe(player)
  player.on('stateChange', (was, now) => {
    if (was.status != now.status) {
      log('player', { server: join.server, status: now.status })
    }
  })
  player.on(
    'error',
    (error) =>
      log('player error', { server: join.server, error: String(error) }),
  )
  let stream = streaming(
    join,
    (data) => {
      let f = sent(data)
      if ('audio' in f) out.play(f.audio)
      else if ('clear' in f) out.clear()
      else if ('mark' in f) out.mark(f.mark)
    },
    () => room.leave('the host refused its stream'),
    held,
  )
  let out = speaking(
    player,
    (name) => stream.send(say.mark(name)),
    () => connection.state.status == VoiceConnectionStatus.Ready,
  )
  let ears = hearing(connection, (user) => stream.send(say.speaking(user)))
  // The room's audio, every 20 ms, sent BATCH frames at a time.
  let batch: Uint8Array[] = []
  let ticking = setInterval(() => {
    batch.push(ears.next())
    if (batch.length < BATCH) return
    let all = new Uint8Array(batch.reduce((n, b) => n + b.length, 0))
    let at = 0
    for (let b of batch.splice(0)) {
      all.set(b, at)
      at += b.length
    }
    stream.send(say.media(all))
  }, 20)
  let moving: ReturnType<typeof setTimeout> | undefined
  connection.on('stateChange', (_, now) => {
    log('voice', { server: join.server, status: now.status })
    if (now.status == VoiceConnectionStatus.Disconnected) {
      moving ??= setTimeout(() => room.leave('Discord let it go'), MOVED)
    } else if (now.status == VoiceConnectionStatus.Ready) {
      clearTimeout(moving)
      moving = undefined
      out.resume()
    } else if (now.status == VoiceConnectionStatus.Destroyed) {
      room.leave('its connection ended')
    }
  })
  connection.on(
    'error',
    (error) =>
      log('voice error', { server: join.server, error: String(error) }),
  )
  let room: Room = {
    join,
    connection,
    adapter,
    leave: (why) => {
      if (left) return
      left = true
      log('left', { server: join.server, why })
      clearInterval(ticking)
      clearTimeout(moving)
      ears.close()
      out.close()
      stream.close()
      if (rooms.get(join.server) == room) rooms.delete(join.server)
      if (connection.state.status != VoiceConnectionStatus.Destroyed) {
        connection.destroy(false)
      }
    },
  }
  rooms.set(join.server, room)
  adapter.onVoiceStateUpdate(stateOf(join) as never)
  adapter.onVoiceServerUpdate(serverOf(join) as never)
  log('joined', { server: join.server, room: join.room })
}

// What Discord told the host's Gateway, as @discordjs/voice reads it.
let stateOf = (join: Join) => ({
  guild_id: join.server,
  channel_id: join.room,
  user_id: join.me,
  session_id: join.session,
  deaf: false,
  mute: false,
  self_deaf: false,
  self_mute: false,
  self_video: false,
  suppress: false,
  request_to_speak_timestamp: null,
})
let serverOf = (join: Join) => ({
  guild_id: join.server,
  token: join.token,
  endpoint: join.endpoint,
})

/** Leave the room the relay is in on `server`, if any. */
export let leave = (server: string) =>
  rooms.get(server)?.leave('the host asked')

let read = (req: import('node:http').IncomingMessage) =>
  new Promise<unknown>((resolve) => {
    let body = ''
    req.on('data', (c) => body += c)
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch {
        resolve(undefined)
      }
    })
  })

/** Serve joins on `port` for whoever carries `key`, streaming only to
 * `hosts`. */
export let serve = (o: { key: string; hosts: string[]; port: number }) =>
  createServer(async (req, res) => {
    let answer = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method == 'GET' && req.url == '/') {
      return answer(200, { rooms: rooms.size })
    }
    if (req.headers.authorization != `Bearer ${o.key}`) {
      return answer(401, { error: 'This relay does not know you.' })
    }
    let body = await read(req)
    if (req.method == 'POST' && req.url == '/join') {
      let join = joined(body, o.hosts)
      if (typeof join == 'string') return answer(400, { error: join })
      enter(join)
      return answer(200, { joined: join.room })
    }
    if (req.method == 'POST' && req.url == '/leave') {
      let server = String((body as { server?: string })?.server ?? '')
      leave(server)
      return answer(200, { left: server })
    }
    answer(404, { error: 'There is nothing here.' })
  }).listen(o.port, () => log('listening', { port: o.port }))

if (import.meta.main) {
  let key = Deno.env.get('RELAY_KEY')
  if (!key) throw new Error('RELAY_KEY is not set')
  serve({
    key,
    hosts: (Deno.env.get('RELAY_HOSTS') ?? 'yaks.app').split(',').map((h) =>
      h.trim()
    ),
    port: Number(Deno.env.get('PORT') ?? 8080),
  })
}
