# Yak for Raycast

Talk to your system from a hotkey: ask anything, give direction, make a
decision, start work, or continue a conversation. A **conversation** is a native
session started with your words in the selected project's context. This is not a
notes or capture tool. The browser extension stays in
[`../extension/`](../extension/).

## Install on macOS

Install Raycast and Node.js 22.22.2 or later. From this directory:

```sh
npm install && npm run dev
```

In Raycast Settings → Extensions → Yak → **Talk to Yak**, record a hotkey. The
hotkey opens a focused message field. On first use, sign in through the browser
when prompted. Authentication uses the fixed `tasks.yak.sh` Cloudflare Access
OAuth PKCE flow for remote MCP; there is no owner token or authentication
preference to paste into Raycast.

## Required Access setup and trust boundary

Before first login, the owner or Cloudflare administrator must open **Cloudflare
Zero Trust → Access applications → tasks.yak.sh → Advanced settings → Managed
OAuth → Allowed redirect URIs** and append
`https://raycast.com/redirect/extension`. Keep the existing policies, lifetimes,
and other redirect URIs unchanged. Until this entry is added, dynamic client
registration fails with `invalid_client_metadata`; off-box login is not usable.
No full/account API keys are needed or accepted by this extension.

This setup trusts the owner-only public Cloudflare Access application plus the
box's tailnet perimeter. The box does not map OAuth subjects to graph actors;
the harness uses the exact host process's configured `config.person` as its
fallback. Do not use this setup on a multi-user or public unprotected origin.

## Talk

For example, open **Talk to Yak**, select your project, and type “Help me decide
what to work on next.” The selected project is remembered in Raycast
LocalStorage. If it no longer exists, the first available project is selected;
with no projects, sending is unavailable until a project exists.

- **Send and Stay** (`⌘↩`) sends and opens the conversation. Your words and the
  assistant's replies appear in order; replies refresh automatically while the
  conversation is open.
- **Reply** (`↩` in the conversation) opens a focused follow-up field. Submit
  with `⌘↩` to send and return to the conversation. A failed send keeps your
  text and shows the error.
- **Send and Close** (`⇧⌘↩`) closes Raycast only after the server acknowledges
  the message. It does not wait for the assistant's reply.
- **Recent Conversations** (`⌘H` in Talk) reopens a conversation in the selected
  project. For example, reopen yesterday's discussion and choose **Reply**.
- **Load Older Messages** (`⇧⌘L` in a conversation) prepends one older page.
  Automatic refresh reads only the tail and keeps already-loaded history.
- **Refresh** (`⌘R`) retries a failed read. Conversation polling also retries
  automatically; leaving the conversation cancels its polling timer and ignores
  any in-flight response.

Raycast's action panel (`⌘K`) lists the available actions. Repeated submits
while one send is pending do not send duplicate messages. A network failure
after a server write can still have an ambiguous outcome; inspect recent
conversations before retrying if acknowledgment was lost.

## Search and inbox

Open **Search Graph** and type a phrase, such as “launch plan”. Select a result
to read its body and press `↩` to open it in the browser. Search is graph-wide,
not restricted to the remembered project.

Open **Inbox** to read inbox results and press `↩` to open the selected result
in the browser. Inbox results are graph entities, not necessarily conversations.
Both commands show read errors and offer **Refresh**.

## Development checks

```sh
npm test
npm run typecheck
npm run build
npm run lint
```

The `test/ui.test.ts` Node probe checks remembered-project fallback, duplicate
submission protection, polling cleanup/recovery, and transcript rendering
without Raycast or a live backend. The native Raycast window, focus, hotkey,
form keyboard behavior, browser login, and native window behavior are platform
boundaries. `npm run dev` launches Raycast and cannot run its native UI on
Linux. No test writes to the live graph.

The UI imports the small function interface in `src/client.ts`; authentication
and transport are implemented separately in `src/auth.ts` and
`src/transport.ts`. See the official
[Raycast extension documentation](https://developers.raycast.com/) for
installation prerequisites and the native Form, Detail, List, and Action APIs.

The repository uses Apache-2.0. Raycast Store manifest validation currently
accepts only MIT, so `npm run lint` reports that metadata restriction.
`npm run lint -- --relaxed` skips store metadata validation without changing the
license. This does not prevent local development builds.
