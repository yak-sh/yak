# @yaks/extension

A browser extension that lends the tab a person is on to their agent. The agent
calls a browser tool, the host sends the call down a socket to the extension,
and the extension answers from the tab: its address and title, its visible text,
what the person selected, or a screenshot. Nothing is read from a site until the
person allows that site.

The package is the extension's core and knows no host. A host is a
**configuration**, given as data, and `build.ts` makes an unpacked Chrome
extension (Manifest V3) for it.

## Terms

- A **configuration** (`Config`) is the host an extension is made for:
  `{name, origin, description?}`, such as
  `{"name": "yaks.app", "origin": "https://yaks.app"}`.
- A **space** is where the person's agent runs on the host, served at
  `<space>.<host>`. The extension holds one socket, to one space.
- A **call** is a tool call the host sends the browser, and an **answer** is
  what the browser sends back with the call's id: text, an image beside it, or
  an error (`./wire`).
- A **site** is a page's origin, `https://example.com`. **Consent** is the list
  of sites the person allowed, and the one site the agent is asking about.

## Example

A call for the page's text, answered from a page the person allowed:

````ts
import { equal } from '@yaks/testing'
import { answering, call, callOf } from '@yaks/extension'

let asked = callOf(call('c1', 'browser_text'))!
let page = {
  url: 'https://example.com/',
  title: 'Example',
  text: 'Hello.',
  selection: '',
}
let { answer } = answering(asked, { url: page.url, allowed: true, page })
equal(answer.id, 'c1')
equal(answer.text?.endsWith('```\nHello.\n```'), true)

// The same call on a site the person has not allowed is refused, and says
// the extension is asking them.
let refused = answering(asked, { url: page.url, allowed: false }).answer
equal(refused.error?.startsWith('The person has not allowed you'), true)
````

## Exports

| Import                  | What it offers                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `@yaks/extension`       | everything below except the build                                                                                                    |
| `@yaks/extension/wire`  | `call`, `answer`, `callOf`, `answerOf`, `PING`, and `protocols` and `bearerOf` for the socket's bearer                               |
| `@yaks/extension/tools` | `TOOLS`, `toolOf` and `PERSON`: the browser tools a host declares to its model, and how long one that `waits` may wait on the person |
| `@yaks/extension/build` | `build(config, dir)`: the unpacked extension                                                                                         |

From `@yaks/extension`:

- `read(doc?, selected?, limit?)` is the `Page` a document shows:
  `{url, title, text, selection}`.
- `answering(call, seen)`, `needs(tool)`, `asks(call, seen)`,
  `lends(call, seen)` and `unlent(failed)` decide an answer from what the tab
  gave.
- `site`, `allow`, `revoke`, `allowed`, `ask`, `dismiss` and `pattern` are
  consent.
- `configOf`, `socket`, `spaceOf` and `spaceHost` are the connection.
- `registration`, `register`, `provider` and `kept` are signing in.
- `manifest(config)` is the extension's `manifest.json`,
  `screen(config,
  state)` the popup's HTML, and `asked(state)` whether its
  badge shows.

## The host's side

A host declares `TOOLS` to its model, sends each call with
`call(id, tool,
args)`, and reads answers with `answerOf`. The socket is the
host's: the extension opens the configuration's `socket`, `{space}` replaced by
the person's space, with two subprotocols, a plain `yaks` and
`bearer.<base64url of the token>`, because a browser's WebSocket can set no
header. `bearerOf` reads the token back out of the `sec-websocket-protocol`
header, and the host answers with `yaks`. The extension sends `PING` every 20
seconds, which the host ignores, so neither the socket nor the browser's service
worker goes idle.

```ts
import { equal } from '@yaks/testing'
import { bearerOf, socket } from '@yaks/extension'

let { url, protocols } = socket(
  {
    name: 'yaks.app',
    origin: 'https://yaks.app',
    socket: 'wss://yaks.app/manage/{space}/operator?browser=1',
  },
  { token: 'secret', space: 'jeff' },
)
equal(url, 'wss://yaks.app/manage/jeff/operator?browser=1')
equal(bearerOf(protocols.join(', ')), 'secret')
```

## Reading a page

`read` runs inside the page: the extension hands it to
`chrome.scripting.executeScript({func: read})`, which sends the function's
source to the tab, so it closes over nothing in its module. It skips scripts,
styles, form fields and hidden elements (the `hidden` attribute,
`aria-hidden="true"`, an inline `display: none` or `visibility: hidden`, and in
a browser whatever `checkVisibility()` says is hidden), collapses whitespace,
puts each block on its own line and keeps a `pre` as it is. The text and the
selection are each cut at 50,000 characters, with a line saying where.

```ts
import { equal } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { read } from '@yaks/extension'

let { document } = parseHTML(
  '<html><head><title>Notes</title></head><body><h1>Rain</h1>' +
    '<p>falls  on <b>the</b> plain</p><script>track()</script>' +
    '<p hidden>draft</p></body></html>',
)
let page = read(document, 'the plain')
equal([page.title, page.text, page.selection], [
  'Notes',
  'Rain\nfalls on the plain',
  'the plain',
])
```

Every word the page wrote reaches the model between backtick fences longer than
any run of backticks inside it, introduced as written by the site.

## Consent

A call on a site the person has not allowed is answered with an error saying so,
and the extension raises its badge. Its popup then asks **Allow on
example.com?**, because the browser grants a site's permission only during a
click (`chrome.permissions.request` with `pattern(site)`). Allowed sites are
listed in the popup, each with a button to remove it.

## Screenshots

Chrome's `chrome.tabs.captureVisibleTab` captures a tab only under `activeTab`
or the permission for every site (`<all_urls>`); a site's own permission is not
enough. `activeTab` is what the person grants a tab by clicking the extension's
button on it, and it lasts while that tab stays on the same site. So a
screenshot keeps per-site consent: when Chrome refuses one (`unlent`), the
extension waits for the person's click, at most `PERSON` (two minutes), with its
badge raised and the popup saying where to click. Opening the popup is the
click, and the screenshot is taken then. A person who does not click is an
answer telling the agent to ask them to. `browser_screenshot` is declared with
`waits`, so a host waits that much longer for its answer.

```ts
import { equal } from '@yaks/testing'
import { allow, allowed, ask, NONE, revoke } from '@yaks/extension'

let asking = ask('https://example.com')(NONE)
equal(asking, { sites: [], asking: 'https://example.com' })
let yes = allow('https://example.com')(asking)
equal(allowed('https://example.com')(yes), true)
equal(revoke('https://example.com')(yes), { sites: [] })
```

## Signing in

The extension registers itself with the host as a public OAuth client
(`POST <origin>/oauth/register`, `token_endpoint_auth_method: 'none'`) for its
browser redirect, `https://<id>.chromiumapp.org/`. It then signs in with the
authorization-code flow and PKCE through `chrome.identity.launchWebAuthFlow`,
asking for scope `graph` at `<origin>/oauth/authorize` and trading the code at
`<origin>/oauth/token`. `provider(config, client)` is that door as a
[@yaks/oauth](../oauth/README.md) provider, which runs the flow and refreshes
the grant; `kept(area)` keeps the grant in `chrome.storage.local`.

The host's sign-in names no space, so after signing in the person types their
space's name, or pastes its address (`spaceOf`).

## Building

```sh
deno run -A packages/extension/build.ts <config.json> <outdir>
```

writes `manifest.json`, `background.js` and `popup.js` (bundled by esbuild with
the configuration in them), `popup.html`, `popup.css` and icons drawn by code.
Load the directory at `chrome://extensions` with Developer mode on, through
**Load unpacked**.

The manifest asks for `activeTab`, `scripting`, `storage`, `identity`, `tabs`
and `alarms` (which wakes the service worker each minute to reconnect). It may
reach the host and its spaces (`https://<host>/*`, `https://*.<host>/*`), and
every other site is an optional permission (`*://*/*`), asked for one site at a
time.

## Limits

- Chrome only: the glue (`background.ts`, `popup.ts`) uses `chrome.*`.
- It reads the top frame of the active tab in the last focused window; frames
  inside the page, shadow roots and form fields are not read.
- A screenshot of a tab needs the person's click on the extension's button on
  it, once per tab and site (see Screenshots).
- It reads; it does not click, type or navigate.
