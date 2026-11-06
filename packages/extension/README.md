# @yaks/extension

A browser extension that lends the tab a person is on to their agent. The agent
calls a browser tool, the host sends the call down a socket to the extension,
and the extension answers from the tab: its address and title, its visible text,
what the person selected, a screenshot, or its links, buttons and fields; and it
clicks, types and navigates there. Nothing is read or done on a site until the
person allows that site, and a step that sends, buys, posts or deletes waits for
the person to press **Do it**.

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
  `{url, title, text, selection}`, and `touch(t, doc?, held?)` lists its
  controls or acts on one.
- `confirms(call, control)`, `weighty`, `named`, `aims` and `doing` decide a
  step.
- `answering(call, seen)`, `needs(tool)`, `asks(call, seen)`,
  `lends(call, seen)`, `unlent(failed)` and `line(control)` decide an answer
  from what the tab gave.
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

Every call waits for the site it aims at to be allowed: the tab's site, or for
`browser_navigate` the site it goes to (`aims`). On a site the person has not
allowed, the extension raises its badge, opens its popup when the window is
focused (`chrome.action.openPopup`), and asks **Allow on example.com?**; the
browser grants a site's permission only during a click
(`chrome.permissions.request` with `pattern(site)`). The call waits for their
answer, at most `PERSON` (two minutes), and is then answered: what it asked for,
or that they said no or did not answer. Allowed sites are listed in the popup,
each with a button to remove it. Every tool is declared with `waits`, so a host
waits `PERSON` longer than it would for the browser alone.

```ts
import { equal } from '@yaks/testing'
import { allow, allowed, ask, NONE, revoke } from '@yaks/extension'

let asking = ask('https://example.com')(NONE)
equal(asking, { sites: [], asking: 'https://example.com' })
let yes = allow('https://example.com')(asking)
equal(allowed('https://example.com')(yes), true)
equal(revoke('https://example.com')(yes), { sites: [] })
```

## Screenshots

Chrome's `chrome.tabs.captureVisibleTab` captures a tab only under `activeTab`
or the permission for every site (`<all_urls>`); a site's own permission is not
enough. `activeTab` is what the person grants a tab by clicking the extension's
button on it, and it lasts while that tab stays on the same site. So a
screenshot keeps per-site consent: when Chrome refuses one (`unlent`), the
extension waits for the person's click, at most `PERSON`, with its badge raised
and the popup saying where to click. Opening the popup is the click, and the
screenshot is taken then. A person who does not click is an answer telling the
agent to ask them to.

## Controlling the tab

`browser_elements` lists the links, buttons and fields on the tab, each named by
a **ref** (`e1`, `e2`, …). `browser_click` and `browser_type` take a ref and the
element's name as it was listed, and `browser_navigate` takes an address. The
name is what the conversation's step shows the person ("Clicked Place order"),
and a name that is no longer the ref's element is refused, so a step names what
it did.

`touch` runs inside the page, as `read` does. The elements a listing named are
held in the extension's isolated world for the page, which the page's scripts
can't see, so a page can't move a ref onto another element.

```ts
import { equal } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { touch } from '@yaks/extension'

let { document } = parseHTML(
  '<body><form><input aria-label="To"><button>Send</button></form></body>',
)
let held = {}
let { controls } = touch({ op: 'list' }, document, held)
equal(controls.map((c) => [c.ref, c.role, c.name, !!c.submits]), [
  ['e1', 'textbox', 'To', false],
  ['e2', 'button', 'Send', true],
])
```

### Do it

A step that sends, buys, posts or deletes waits for the person to press **Do
it** in the popup, which opens itself when the window is focused. The rule is
the extension's own (`confirms`), read from the element and the action:

- a click on a submit button, or on an element whose name has a word such as
  send, buy, pay, order, post, publish, delete or confirm (`weighty`);
- Enter typed into a field, unless the field is a search whose name has none of
  those words;
- any step the agent passed `confirm: true`.

The agent's `confirm` only adds a question: `confirm: false` removes none, and
nothing else a page says reaches the rule. A person who presses **Don't**, or
does not answer within `PERSON`, is an answer the agent reads, and nothing is
done.

```ts
import { equal } from '@yaks/testing'
import { confirms } from '@yaks/extension'

let send = { ref: 'e2', role: 'button', name: 'Send', submits: true }
let click = (args = {}) => ({ id: 'c', tool: 'browser_click', args })
equal(confirms(click(), send), true)
equal(confirms(click({ confirm: false }), send), true)
equal(confirms(click(), { ref: 'e3', role: 'link', name: 'Next' }), false)
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
- It uses the top frame of the active tab in the last focused window; frames
  inside the page and shadow roots are neither read nor touched, and `read`
  skips form fields, which `browser_elements` lists.
- A screenshot of a tab needs the person's click on the extension's button on
  it, once per tab and site (see Screenshots).
- A click is the element's `click()`, and typing sets its value and sends
  `input` and `change` events; a page that only listens for trusted key presses
  or pointer events may not respond.
