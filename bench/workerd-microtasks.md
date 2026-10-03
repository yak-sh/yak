# Workerd socket microtasks

Workerd drains the queued microtask between hibernation-API WebSocket message
callbacks in this probe. A microtask tick therefore holds one message, including
when ten sockets send to the same Durable Object in a burst.

Run separately from the test suite:

```sh
deno run -A bench/workerd-microtasks.ts workers/yak/node_modules/workerd/bin/workerd
```

The binary is the installed kernel Worker's dependency. A different binary path
can be passed as the first argument, followed by rounds and messages per burst
(defaults: 3 and 1,000). The probe starts raw workerd on an ephemeral loopback
port with an in-memory scratch namespace; it closes its sockets, reaps workerd
and removes its scratch directory even on failure. It never contacts the hosted
platform or the box's graph.

The Durable Object accepts sockets with `state.acceptWebSocket`. Its synchronous
`webSocketMessage` callback queues one microtask for the pending messages; that
microtask reports the tick number, message ids, and total messages held. Every
message id must arrive exactly once. Sockets are established sequentially; then
all messages are sent without awaiting a reply, round-robin across the sockets.

Each round sends a warm burst, hibernates the object with
`workerd:unsafe.evict(stub, { webSockets: 'hibernate' })`, then sends another
burst on the same sockets. This is the runtime hook used by Miniflare's eviction
control. A fresh UUID made only in the constructor must appear in the second
burst, proving a different instance handled messages after hibernation. The
probe fails if eviction fails or the constructor generation stays the same. The
runtime hook
[hibernates the sockets before destroying the
instance](https://github.com/cloudflare/workerd/blob/v1.20260710.1/src/workerd/server/server.c%2B%2B#L1048).

Measured with workerd 2026-07-10, Deno 2.9.1, compatibility date 2025-05-08, and
load average **4.08 / 5.71 / 5.54** (1 / 5 / 15 minutes). All three rounds
agreed:

| Sockets | Instance before burst | Messages per burst | Microtask ticks | Min / max messages per tick |
| ------- | --------------------- | -----------------: | --------------: | --------------------------: |
| 1       | Warm                  |              1,000 |           1,000 |                       1 / 1 |
| 1       | Hibernated            |              1,000 |           1,000 |                       1 / 1 |
| 10      | Warm                  |              1,000 |           1,000 |                       1 / 1 |
| 10      | Hibernated            |              1,000 |           1,000 |                       1 / 1 |

That is 12,000 messages and 12,000 ticks in total, with constructor generation
changes in all six hibernated bursts. These are event counts, not elapsed-time
measurements. Forced hibernation tests message delivery after eviction; it does
not measure when the runtime chooses to hibernate naturally. The bare callback
has no awaited I/O or graph admission. Hosted Cloudflare scheduling and a
callback that yields to I/O are outside this measurement.
