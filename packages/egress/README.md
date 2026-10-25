# @yaks/egress

Calls going out with a credential the caller never holds. An app is handed a
sentinel for each connection it uses ([@yaks/connections](../connections)), and
puts it wherever the service wants its key or token: a header, either half of a
Basic credential (`curl -u`, a URL's `user:password@`), the query, the body. The
egress sends the request on with the credential in the sentinel's place,
verbatim.

It serves no route. A host authenticates the caller and hands each call to
`forward`, in-process or from an outbound Worker.

## The verb

`forward(host, {app, level, person}, request)` returns the service's response.
`host` is @yaks/connections' `Ctx` (the graph, which holds every integration,
and its vault, which holds each OAuth client and credential) with `defer`: how
the host puts off work the answer must not wait on, counting the call (below).
It runs that work once the call is answered (a Worker hands it to `waitUntil`)
and reports its failure. `level` is what the host vouches the caller holds on
the app ([@yaks/member](../member)), or `null` for nothing, and `person` is who
the host vouches they are, or `null` for nobody signed in.

Before a sentinel is swapped:

- It must stand for a connected connection the app uses, so one app never spends
  another's. Where the app asks each person to connect their own (`each`), a
  person's connection counts only when that person is calling, so one person
  never spends another's.
- The caller must be allowed to call out through it: @yaks/member's
  `callsOut(anyone, level)`, which holds for a caller with any level on the app,
  or for anyone at all where the app's `uses` link opened the connection to
  `anyone`, as a public widget's key is. A person's own connection is theirs to
  spend whatever they hold on the app. A sentinel points at a credential and is
  not one, so one that leaks into a page is useless to a stranger.
- The request must go over https to a host the connection's integration names,
  and to another port only where the integration names it with one.
- The app's `uses` link must not have made the calls its `cap` allows this month
  (below).

Anything else throws `Refused` (`Capped`, for a link at its cap), and nothing is
sent. A request carrying no sentinel goes out as it came.

A pasted key goes in as it is kept. An access token is refreshed first when it
is about to expire, and when the service refuses it (401) the call is made once
more with a refreshed one. A grant the service refuses marks the connection
`broken` (@yaks/connections `refresh`).

The credential goes only to the host that was checked: a request carrying one
does not follow redirects, so a redirect comes back to the caller, whose next
request is checked again. The body is sent whole, byte for byte, apart from the
swap.

## Counting calls

Every call that goes out with a credential is counted on the `uses` link it went
out through, by the UTC month: `calls{month, count}`, which this package
declares. Once a call is answered the egress writes a `called{month}` event on
each link it used, through the host's `defer`, and the `./graph` facet folds the
event into the link's `calls` inside that write's own transaction, so two calls
at once both count and nobody sends a sum back. A new month starts the count
over, and a count for a month already over arrives too late to count. A call
refused is not counted, and one asked again after a refresh is counted once.

A link's `cap` (@yaks/connections `uses`) is the most calls a month it may make.
At it, the egress throws `Capped`, naming the connection's owner, its
integration and the cap, so a host can say whose limit it is and where to
connect a key of one's own. The count is written after the answer, so calls at
once near the cap may pass it by a few.

```ts
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'
import { calling, counting, egressDoc, spent } from '@yaks/egress'

let vocab = loadVocab([egressDoc])
let g = graph({ storage: ram(vocab), vocab, plugins: [counting()] })
for (let month of ['2026-10', '2026-10', '2026-11']) {
  await g.apply(calling(['link'], month), { trusted: true })
}
let [link] = await g.get(['link'])
equal([spent(link, '2026-10'), spent(link, '2026-11')], [0, 1])
```

## A grant from a trusted host

A **grant** is a credential and the destinations a trusted host authorized for
one call: `{sentinel, value, hosts}`. `grants(ctx, caller, sentinels)`
authorizes the requested sentinels through the caller's app, level and person,
and reads their current credentials, refreshing access tokens when needed. A
grant is lent for one call, so each is counted on its link as it is lent, and a
link at its cap lends none. `granted(grants, request, send?)` forwards using
those grants without reading a graph or vault. A separate executor can obtain
grants from its host at I/O and send a long response directly, keeping the host
outside the response stream. It keeps the grant only while sending; durable
requests carry sentinels, never credential values.

```ts
import { granted } from '@yaks/egress'
import { equal } from '@yaks/testing'

let sentinel = 'yak_sentinel_' + 'A'.repeat(43)
let grants = [{ sentinel, value: 'service-key', hosts: ['api.example'] }]
let sent = ''
await granted(
  grants,
  new Request('https://api.example/', {
    headers: { authorization: `Bearer ${sentinel}` },
  }),
  async (request) => {
    sent = new Request(request).headers.get('authorization')!
    return new Response(null)
  },
)
equal(sent, 'Bearer service-key')
```

Every sentinel found in the request must have a grant allowing its HTTPS
destination, including the port. An ungranted sentinel or refused destination
throws `Refused` before sending. Substitution, body preservation and redirect
handling are the same as `forward`; obtaining and refreshing the grants is the
host's responsibility.
