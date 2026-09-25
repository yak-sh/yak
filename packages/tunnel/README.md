# @yaks/tunnel

`@yaks/tunnel` links a machine to a hosted space without opening a port on it. A
Worker in the space reaches one service on the machine (a local server, say) as
if it were a binding, and nothing else on that machine's network.

Two Cloudflare resources make the link:

- a **Cloudflare Tunnel**, the machine's own outbound connection. `cloudflared`
  runs on the machine with the tunnel's token and dials Cloudflare, so the
  machine needs no public address and no open port.
- a **Workers VPC Service**, one host and port behind that tunnel. A Worker
  bound to it reaches exactly that service, whatever URL it fetches.

```sh
deno add jsr:@yaks/tunnel
```

Entry points:

- `@yaks/tunnel`: the account calls (`connect`, `disconnect`, `tunnels`,
  `services`) and the vocabulary.
- `@yaks/tunnel/service`: the connector, which keeps `cloudflared` running on
  the machine for as long as its role runs.
- `@yaks/tunnel/vocab`: the `tunnel` component alone.

## Making a link

```ts ignore
import { connect, disconnect } from '@yaks/tunnel'

let api = { account: ACCOUNT_ID, token: API_TOKEN }
let { tunnel, service, token } = await connect(api, 'my-box', { port: 5173 })
// ... later
await disconnect(api, { tunnel, service })
```

`connect` makes the tunnel, then the service behind it on `127.0.0.1` at the
port given (or at `host`, when the service listens elsewhere on the machine's
network). If the service cannot be made, the tunnel is removed again, so a
failure leaves nothing in the account. `disconnect` removes both; a resource
that is already gone is not an error.

`tunnels(api).rotate(id)` gives the tunnel a new secret and answers its new
token. A connector already running keeps its connection until it restarts; a
connector holding the old token cannot open a new one.

The API token these calls are made with needs **Cloudflare Tunnel Write** and
the **Connectivity Directory Admin** role. A Worker that carries the binding
needs its uploader to hold **Connectivity Directory Bind**. An account holds at
most 1,000 VPC Services.

## The token is a credential

Whoever holds a tunnel's token can run the tunnel. `connect` and `rotate` hand
the token to their caller and never log or keep it; the caller puts it in a
vault. On the machine, the connector passes it to `cloudflared` in the
environment (`TUNNEL_TOKEN`), never on the command line, so no process listing
shows it.

## Running the connector

The connector is a service: `yak` runs it in the process that holds its role,
one process at a time. A config names the token as a secret, read from the
vault:

```json
{
  "plugins": [
    { "use": "@yaks/tunnel", "with": { "token": { "secret": "TUNNEL_TOKEN" } } }
  ]
}
```

With no token the service ends at once. With one, it runs `cloudflared` and
starts it again whenever it exits, after a pause that grows to a minute while it
keeps failing. Ending the role stops it. The machine needs `cloudflared` on its
`PATH`, or `cloudflared` in the options names the one to run.

## The record

`tunnel{id, service}` on an entity says which tunnel links it and which VPC
Service a Worker's binding names. Both are written by the server that made them,
never by a client (`stamped`, `wire: false`). A hosting platform keeps one on
each space that has a linked machine, and binds the space's Workers to its
service.
