// Measure how many hibernation-API WebSocket messages one queued microtask
// holds in workerd. A scratch Durable Object gives each instance a fresh
// constructor generation, so the evicted run proves it hibernated before its burst.
// Run apart from tests: deno run -A bench/workerd-microtasks.ts <workerd-binary>.

let binary = Deno.args[0] ?? 'workers/yak/node_modules/workerd/bin/workerd'
let rounds = Number(Deno.args[1] ?? 3)
let messages = Number(Deno.args[2] ?? 1000)
if (![rounds, messages].every((n) => Number.isInteger(n) && n > 0)) {
  throw new Error('rounds and messages must be positive integers')
}
let scratch = Deno.makeTempDirSync({ prefix: 'yak-T-64657-microtasks-' })
let worker = `
import unsafe from 'workerd:unsafe';
export default {
  async fetch(request, env) {
    let url = new URL(request.url);
    let stub = env.PROBE.get(env.PROBE.idFromName(url.searchParams.get('name')));
    if (url.pathname === '/evict') {
      await unsafe.evict(stub, { webSockets: 'hibernate' });
      return new Response('hibernated');
    }
    return stub.fetch(request);
  }
};
export class Probe {
  constructor(state) {
    this.state = state;
    this.pending = [];
    this.tick = 0;
    this.generation = crypto.randomUUID();
  }
  fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json({ generation: this.generation });
    }
    let [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(socket, message) {
    this.pending.push({ socket, id: Number(message) });
    if (this.pending.length !== 1) return;
    queueMicrotask(() => {
      let batch = this.pending.splice(0);
      let tick = ++this.tick;
      let groups = new Map();
      for (let entry of batch) {
        let ids = groups.get(entry.socket) ?? [];
        ids.push(entry.id);
        groups.set(entry.socket, ids);
      }
      for (let [socket, ids] of groups) {
        socket.send(JSON.stringify({ generation: this.generation, tick, size: batch.length, ids }));
      }
    });
  }
  webSocketClose(socket, code, reason) { socket.close(code, reason); }
  webSocketError(socket) { socket.close(1011, 'socket error'); }
}
`
Deno.writeTextFileSync(`${scratch}/worker.js`, worker)
Deno.writeTextFileSync(
  `${scratch}/config.capnp`,
  `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "probe", worker = (
    modules = [(name = "worker.js", esModule = embed "worker.js")],
    compatibilityDate = "2025-05-08",
    compatibilityFlags = ["unsafe_module"],
    bindings = [(name = "PROBE", durableObjectNamespace = "Probe")],
    durableObjectNamespaces = [(className = "Probe", uniqueKey = "T-64657-microtasks")],
    durableObjectStorage = (inMemory = void)
  ))],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "probe")]
);
`,
)

let timeout = async <T>(promise: Promise<T>, label: string): Promise<T> => {
  let timer: number | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          30_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

let child: Deno.ChildProcess | undefined
let sockets: WebSocket[] = []
try {
  let version = await new Deno.Command(binary, { args: ['--version'] }).output()
  if (!version.success) {
    throw new Error(new TextDecoder().decode(version.stderr))
  }
  child = new Deno.Command(binary, {
    args: [
      'serve',
      '--experimental',
      '--control-fd=1',
      `${scratch}/config.capnp`,
    ],
    stdout: 'piped',
    stderr: 'inherit',
  }).spawn()
  let reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader()
  let control = ''
  let origin = await timeout(
    (async () => {
      while (true) {
        let { value, done } = await reader.read()
        if (done) throw new Error(`workerd exited before listening: ${control}`)
        control += value
        let newline = control.indexOf('\n')
        if (newline < 0) continue
        let ready = JSON.parse(control.slice(0, newline))
        if (ready.event == 'listen') return `http://127.0.0.1:${ready.port}`
        throw new Error(`unknown workerd control message: ${control}`)
      }
    })(),
    'workerd listen',
  )
  console.log(JSON.stringify({
    workerd: new TextDecoder().decode(version.stdout).trim(),
    deno: Deno.version.deno,
    rounds,
    messages,
    load_average: (await Deno.readTextFile('/proc/loadavg')).trim(),
  }))
  for (let connections of [1, 10]) {
    for (let round = 1; round <= rounds; round++) {
      let name = `${connections}-${round}`
      let url = `${origin}/?name=${name}`
      let batches = new Map<number, number>()
      let seen = new Set<number>()
      let generations = new Set<string>()
      let complete: (() => void) | undefined
      for (let connection = 0; connection < connections; connection++) {
        let socket = new WebSocket(url.replace('http:', 'ws:'))
        socket.onmessage = (event) => {
          let ack = JSON.parse(event.data)
          batches.set(ack.tick, ack.size)
          generations.add(ack.generation)
          for (let id of ack.ids) {
            if (seen.has(id)) throw new Error(`duplicate message ${id}`)
            seen.add(id)
          }
          if (seen.size == messages) complete?.()
        }
        await timeout(
          new Promise<WebSocket>((resolve, reject) => {
            socket.onopen = () => resolve(socket)
            socket.onerror = () => reject(new Error('WebSocket failed'))
          }),
          'WebSocket open',
        )
        sockets.push(socket)
      }
      let initial = await (await fetch(url)).json()
      for (let phase of ['warm', 'hibernated']) {
        if (phase == 'hibernated') {
          // The same runtime hook Miniflare uses waits for active requests,
          // discards the instance and keeps hibernation-API sockets connected.
          let response = await timeout(
            fetch(`${origin}/evict?name=${name}`),
            'Durable Object eviction',
          )
          if (!response.ok) throw new Error(await response.text())
          await response.body?.cancel()
        }
        batches.clear()
        seen.clear()
        generations.clear()
        let done = new Promise<void>((resolve) => complete = resolve)
        for (let i = 0; i < messages; i++) {
          sockets[i % connections].send(String(i))
        }
        await timeout(done, 'burst delivery')
        let instances = [...generations]
        if (instances.length != 1) {
          throw new Error('burst spanned constructor generations')
        }
        if (phase == 'hibernated' && instances[0] == initial.generation) {
          throw new Error('eviction did not hibernate the Durable Object')
        }
        let sizes = [...batches.values()]
        console.log(JSON.stringify({
          connections,
          round,
          phase,
          messages: seen.size,
          ticks: batches.size,
          messages_per_tick: seen.size / batches.size,
          min: Math.min(...sizes),
          max: Math.max(...sizes),
          constructor_generation: instances[0],
          load_average: (await Deno.readTextFile('/proc/loadavg')).trim(),
        }))
      }
      for (let socket of sockets) socket.close(1000)
      sockets = []
    }
  }
  reader.releaseLock()
} finally {
  for (let socket of sockets) socket.close(1000)
  if (child) {
    child.kill('SIGTERM')
    await child.status
  }
  Deno.removeSync(scratch, { recursive: true })
}
