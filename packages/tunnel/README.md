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
route sees them. A request without the mark did not come through the tunnel, and
the filter leaves it alone.

```sh
deno add jsr:@yaks/tunnel
```

Entry points:

- `@yaks/tunnel`: the account calls (`connect`, `disconnect`, `tunnels`,
  `services`, `gateways`), the tunnel's two ends (`GATEWAY`, `HEADER`, `filter`,
  `opens`) and the vocabulary.
- `@yaks/tunnel/routes`: the filter a machine's server puts in front of its
  routes, over the paths its config opens.
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
