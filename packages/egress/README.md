# @yaks/egress

Calls going out with a credential the caller never holds. An app is handed a
sentinel for each connection it uses ([@yaks/connections](../connections)), and
puts it wherever the service wants its key or token: a header, the query, the
body. The egress sends the request on with the credential in the sentinel's
place, verbatim.

It serves no route. A host authenticates the caller and hands each call to
`forward`, in-process or from an outbound Worker.

## The verb

`forward(ctx, {app, level, person}, request)` returns the service's response.
`ctx` is @yaks/connections' `Ctx`: the graph, which holds every integration, and
its vault, which holds each OAuth client and credential. `level` is what the
host vouches the caller holds on the app ([@yaks/member](../member)), or `null`
for nothing, and `person` is who the host vouches they are, or `null` for nobody
signed in.

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

Anything else throws `Refused`, and nothing is sent. A request carrying no
sentinel goes out as it came.

A pasted key goes in as it is kept. An access token is refreshed first when it
is about to expire, and when the service refuses it (401) the call is made once
more with a refreshed one. A grant the service refuses marks the connection
`broken` (@yaks/connections `refresh`).

The credential goes only to the host that was checked: a request carrying one
does not follow redirects, so a redirect comes back to the caller, whose next
request is checked again. The body is sent whole, byte for byte, apart from the
swap.
