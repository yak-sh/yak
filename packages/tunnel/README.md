# @yaks/tunnel

`@yaks/tunnel` links a machine to a hosted space without opening a port on it.
The space's apps reach the paths the machine opens to them, on one service there
(a local server, say), and nothing else on that machine or its network.

Three Cloudflare resources make the link:

- a **Cloudflare Tunnel**, the machine's own outbound connection. `cloudflared`
  runs on the machine with the tunnel's token and dials Cloudflare, so the
  machine needs no public address and no open port.
- a **Workers VPC Service**, one host and port behind that tunnel. A Worker
  bound to it reaches exactly that service, whatever URL it fetches.
- a **gateway**, the one Worker bound to that service. It lives in the hosting
  platform's dispatch namespace, so only the platform calls it, and it adds the
  link's secret to every request it passes on. An app never holds the binding or
  the secret: it asks the platform, and the platform decides.

On the machine, the service the VPC Service names is the link's **door**, not
the machine's server. The door answers only a request carrying the link's
secret, only at the paths the machine opened to the link, and passes what it
admits on to the server. A request through the tunnel never reaches anything the
machine did not open, and nothing that reaches the server's own port has come
through the tunnel.

```sh
deno add jsr:@yaks/tunnel
```

Entry points:

- `@yaks/tunnel`: the account calls (`connect`, `disconnect`, `tunnels`,
  `services`, `gateways`), the link's two ends (`GATEWAY`, `link`, `opens`,
  `HEADER`) and the vocabulary.
- `@yaks/tunnel/service`: the machine's end, which keeps `cloudflared` running
  and the door open for as long as its role runs.
- `@yaks/tunnel/vocab`: the `tunnel` component alone.

## Making a link

```ts ignore
import { connect, disconnect, gateways } from '@yaks/tunnel'

let api = { account: ACCOUNT_ID, token: API_TOKEN }
let uploader = { account: ACCOUNT_ID, token: WORKERS_TOKEN }
let { tunnel, service, token } = await connect(api, 'my-box', { port: 5174 })
let secret = await gateways(uploader, 'my-namespace').put('link-ada', service)
// ... later
await gateways(uploader, 'my-namespace').remove('link-ada')
await disconnect(api, { tunnel, service })
```

`connect` makes the tunnel, then the service behind it on `127.0.0.1` at the
port given (the door's port, never the server's), or at `host` when the door
listens elsewhere on the machine's network. If the service cannot be made, the
tunnel is removed again, so a failure leaves nothing in the account.
`disconnect` removes both; a resource that is already gone is not an error.

`gateways(api, namespace).put(name, service)` uploads the gateway in front of
the service into a Workers for Platforms dispatch namespace, with a new secret,
and answers the secret; putting it again is how the secret is rotated. The
platform reaches it with its dispatch binding (`env.DISPATCH.get(name)`) once it
has decided an app may reach the machine.

`tunnels(api).rotate(id)` gives the tunnel a new secret and answers its new
token. A connector already running keeps its connection until it restarts; a
connector holding the old token cannot open a new one.

The API token the tunnel and service calls are made with needs **Cloudflare
Tunnel Write** and the **Connectivity Directory Admin** role. The one a gateway
is uploaded with needs **Workers Scripts Edit** and **Connectivity Directory
Bind**. An account holds at most 1,000 VPC Services.

## The token and the secret are credentials

Whoever holds a tunnel's token can run the tunnel, and whoever holds a link's
secret can speak as the link. `connect`, `rotate` and `put` hand them to their
caller and never log or keep them; the caller puts them in a vault. On the
machine, the connector passes the token to `cloudflared` in the environment
(`TUNNEL_TOKEN`), never on the command line, so no process listing shows it.

## The machine's end

The connector and the door are a service: `yak` runs them in the process that
holds its role, one process at a time. A config names the token and the secret
as secrets, read from the vault, the port the door listens on, and the paths it
opens:

```json
{
  "plugins": [
    {
      "use": "@yaks/tunnel",
      "with": {
        "token": { "secret": "TUNNEL_TOKEN" },
        "secret": { "secret": "LINK_SECRET" },
        "port": 5174,
        "routes": ["/mail/inbound"]
      }
    }
  ]
}
```

With a token, the service runs `cloudflared` and starts it again whenever it
exits, after a pause that grows to a minute while it keeps failing. The machine
needs `cloudflared` on its `PATH`, or `cloudflared` in the options names the one
to run. A machine whose tunnel something else already runs leaves the token out.

With a port, the door listens on `127.0.0.1` there. `routes` are URLPattern
pathnames (`/mail/inbound`, `/hooks/*`), and none opens nothing: `/apply` and
`/query` stay closed unless the machine's owner lists them. What the door admits
goes on to `to`, an origin, which defaults to this graph's own `yak serve` at
the config's `port`. The secret is read on every request, so a new one written
to the vault is checked from then on, and until there is one nothing is
admitted.

With neither, the service ends at once. Ending the role stops both.

## The record

`tunnel{id, service, adopted}` on an entity says which tunnel links it and which
VPC Service its gateway is bound to. `adopted` marks a pair made elsewhere and
only recorded here: unlinking it forgets the ids and leaves the resources alone.
All three are written by the server, never by a client (`stamped`,
`wire: false`). A hosting platform keeps one on each space that has a linked
machine, and puts that space's gateway in front of its service.
