# @yaks/tunnel

`@yaks/tunnel` gives a hosted space a tunnel to a machine without opening a port
on it. The space's apps reach the paths the machine opens to them, on its own
server, and nothing else on that machine or its network.

Three Cloudflare resources make the tunnel:

- a **Cloudflare Tunnel**, the machine's own outbound connection. `cloudflared`
  runs on the machine with the tunnel's token and dials Cloudflare, so the
  machine needs no public address and no open port.
- a **Workers VPC Service**, one host and port behind that tunnel: the machine's
  server. A Worker bound to it reaches exactly that service, whatever URL it
  fetches.
- a **gateway**, the one Worker bound to that service. It lives in the hosting
  platform's dispatch namespace, so only the platform calls it, and it marks
  every request it passes on with `x-yak-tunnel`, over whatever the request
  said. An app never holds the binding: it asks the platform, and the platform
  decides.

On the machine, the server's **filter** answers a marked request only at the
paths the machine opened to the tunnel, and refuses the rest (403) before any
route sees them. A marked request is also never one of the machine's own
callers: it writes as the persona the machine names for the tunnel, and is
offered only the tools the machine lists. A request without the mark did not
come through the tunnel, and all of this leaves it alone.

The platform also says who is asking, in `x-yak-caller`: its own word for the
kind of caller, set on every request it hands the gateway and taken off whatever
a caller sent. The machine opens a path, a tool or a persona to every request
through the tunnel, or only to the callers it names
([Who is asking](#who-is-asking)).

```sh
deno add jsr:@yaks/tunnel
```

Entry points:

- `@yaks/tunnel`: the account calls (`connect`, `disconnect`, `tunnels`,
  `services`, `gateways`), the tunnel's two ends (`GATEWAY`, `HEADER`, `CALLER`,
  `filter`, `opens`, `offered`, `named`) and the vocabulary.
- `@yaks/tunnel/routes`: what a machine's server puts in front of its routes:
  the filter over the paths its config opens, who a request through the tunnel
  writes as, and the tools it is offered.
- `@yaks/tunnel/service`: the connector, which keeps `cloudflared` running for
  as long as its role runs.
- `@yaks/tunnel/vocab`: the `tunnel` component alone.

## Making a tunnel

```ts ignore
import { connect, disconnect, gateways } from '@yaks/tunnel'

let api = { account: ACCOUNT_ID, token: API_TOKEN }
let uploader = { account: ACCOUNT_ID, token: WORKERS_TOKEN }
let { tunnel, service, token } = await connect(api, 'my-box', { port: 5173 })
await gateways(uploader, 'my-namespace').put('tunnel-ada', service)
// ... later
await gateways(uploader, 'my-namespace').remove('tunnel-ada')
await disconnect(api, { tunnel, service })
```

`connect` makes the tunnel, then the service behind it on `127.0.0.1` at the
port given (the machine's server), or at `host` when the server listens
elsewhere on the machine's network. If the service cannot be made, the tunnel is
removed again, so a failure leaves nothing in the account. `disconnect` removes
both; a resource that is already gone is not an error.

`gateways(api, namespace).put(name, service)` uploads the gateway in front of
the service into a Workers for Platforms dispatch namespace; putting it again
replaces it. The platform reaches it with its dispatch binding
(`env.DISPATCH.get(name)`) once it has decided an app may reach the machine.

`tunnels(api).rotate(id)` gives the tunnel a new secret and answers its new
token. A connector already running keeps its connection until it restarts; a
connector holding the old token cannot open a new one.

The API token the tunnel and service calls are made with needs **Cloudflare
Tunnel Write** and the **Connectivity Directory Admin** role. The one a gateway
is uploaded with needs **Workers Scripts Edit** and **Connectivity Directory
Bind**. An account holds at most 1,000 VPC Services.

## The token is a credential

Whoever holds a tunnel's token can run the tunnel. `connect` and `rotate` hand
it to their caller and never log or keep it; the caller puts it in a vault. On
the machine, the connector passes it to `cloudflared` in the environment
(`TUNNEL_TOKEN`), never on the command line, so no process listing shows it.

## The machine's end

A config names the paths the tunnel opens, and the tunnel's token as a secret
read from the vault:

```json
{
  "plugins": [
    {
      "use": "@yaks/tunnel",
      "with": {
        "token": { "secret": "TUNNEL_TOKEN" },
        "routes": ["/mail/inbound"]
      }
    }
  ]
}
```

`routes` are URLPattern pathnames (`/mail/inbound`, `/hooks/*`), and none opens
nothing: `/apply` and `/query` stay closed to the tunnel unless the machine's
owner lists them. The filter is the `web` role's, so it stands in front of every
route of the process that serves HTTP.

### Who is asking

`routes`, `tools` and `persona` at the top of the config are what every request
through the tunnel gets, and any app built in the space can send one. What only
one kind of caller gets goes under `callers`, by the platform's word for it:

```json
{
  "use": "@yaks/tunnel",
  "with": {
    "routes": ["/mail/inbound"],
    "callers": {
      "operator": {
        "routes": ["/mcp", "/model/step"],
        "tools": ["task_list", "task_update", "graph_query"],
        "persona": "N-153900"
      }
    }
  }
}
```

yaks.app says one of three words:

| `x-yak-caller` | who is asking                                                            |
| -------------- | ------------------------------------------------------------------------ |
| `app`          | an app's own worker, built in the tunnel's space                         |
| `operator`     | the Operator of the space's owner, in a conversation or a run of its own |
| `connector`    | the owner's own assistant, signed in to yaks.app, calling `command`      |

A caller named under `callers` is answered at its paths and everyone's, is
offered its tools and everyone's, and writes as its own persona, or everyone's
where it names none. A request saying no word, or one the config names nothing
for, gets what everyone does. So a path that reads the machine's graph or spends
its owner's subscription belongs under `callers`, never at the top.

### Tools through the tunnel

A hosted assistant uses the machine's tools by opening `/mcp` (@yaks/mcp) and
saying which tools the tunnel offers and who its callers are:

```json
{
  "use": "@yaks/tunnel",
  "with": {
    "callers": {
      "operator": {
        "routes": ["/mcp"],
        "tools": ["task_list", "task_update", "graph_query"],
        "persona": "N-153900"
      }
    }
  }
}
```

- `tools` are the only tools a request through the tunnel is listed or may call,
  by name, and none offers nothing. A call to any other is answered as a call to
  a tool that does not exist. The hosted side can narrow this list and cannot
  widen it. A hosted model reads mail and web pages that strangers wrote, so
  leave off any tool that starts an agent or runs a command.
- `persona` is the persona every request through the tunnel writes as (`by`),
  named by eid, number or name. Without one such a request writes as nobody.
- The request names the conversation it comes from in `x-via`. The machine keeps
  one session standing for each (`session{persona, source}`, its eid derived
  from the conversation's id; @yaks/session `standIn`), and what the request
  writes is stamped `via` that session. `source` is the conversation's id where
  that is an eid. A request naming none speaks through one session kept for the
  tunnel.

Whatever a request through the tunnel names in `x-via`, it never speaks as one
of the machine's own sessions, and never as the machine's person.

### The owner's own words

One kind of request is the machine's person's own: a hosted assistant passing on
what its person wrote, word for word, where the platform read the words and who
wrote them itself. The platform then names that person in `x-yak-by`, by its own
id for them, and the machine's config says which of the platform's people is its
own:

```json
{
  "use": "@yaks/tunnel",
  "with": {
    "callers": {
      "operator": {
        "routes": ["/mcp"],
        "tools": ["comment_new", "decision_answer"],
        "persona": "N-153900",
        "owner": "3f0c9a52-6d1e-4b7a-9c58-2a4d7e61b0f3"
      }
    }
  }
}
```

- `owner` is the platform's id for the person the machine's config names as its
  `person`. A request naming them in `x-yak-by` writes `by` that `person` and
  `via` the machine's own process, as what they type at the machine's own page
  does, and through no session. So a comment it writes reads as the person's
  everywhere a graph tells a person's comment from an agent's.
- A request naming anybody else, or any at all where the config names no `owner`
  or no `person`, is refused (403) and writes nothing.
- It is offered the same tools as its caller. Only the platform sets the header,
  and takes it off whatever an app or a model sends.

### Model steps through the tunnel

A hosted space runs model steps on the machine's own providers by opening
`/model/step` (@yaks/model/step) to the caller that may spend them, which
[@yaks/harness](../harness/README.md#answering-another-hosts-model-steps)
answers from the providers its `serve` option names. The gateway hands back the
machine's answer as it arrives, so the reply streams to the platform piece by
piece.

With a token, the service runs `cloudflared` and starts it again whenever it
exits, after a pause that grows to a minute while it keeps failing. The machine
needs `cloudflared` on its `PATH`, or `cloudflared` in the options names the one
to run. A machine whose tunnel something else already runs leaves the token out,
and the service ends at once. Ending the role stops the connector.

## The record

`tunnel{id, service, adopted}` on an entity says which tunnel it reaches a
machine by and which VPC Service its gateway is bound to. `adopted` marks a pair
made elsewhere and only recorded here: removing it forgets the ids and leaves
the resources alone. All three are written by the server, never by a client
(`stamped`, `wire: false`). A hosting platform keeps one on each space that has
a tunnel, and puts that space's gateway in front of its service.
