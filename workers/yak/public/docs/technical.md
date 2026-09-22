<!--
  The technical page (T-33643). Jeff: "i'd like also a link to a page for
  technical details. basically, explain that it's hosted on CF, scalable, some
  limitations, etc etc."

  The rule this page is written under: every number and every capability on this page
  is read off the code, never invented, and the pointer is named in a comment
  beside anything a reader might want to check. If the code stops being true,
  this page is wrong and somebody has to fix it — so it says as little as it
  can get away with, and points at the guide for the rest (M-14370).

  It is also still yaks.app's voice: plain words, short sentences, no hype. It
  is the page for the person who asked "but where does it actually run" — the
  lead says out loud that nobody needs to read it.

  It is a page of the documentation (docs.ts, T-37752), drawn at
  /docs/technical from this file, which is served as it is written at
  /docs/technical.md. It says no `guide` row, so the connector does not offer
  it as a resource: it is written for a person, not for an agent building an
  app. /technical answers a 301 to it.
-->

# Technical details

This page explains how yaks.app hosts apps, stores data, runs code, controls
access, and applies limits. For setup and everyday use, see [Help](/help).

## Where it runs

yaks.app runs on Cloudflare. The platform uses one Cloudflare Worker, and app
code runs in a Cloudflare data centre near the visitor.

Cloudflare supplies capacity as traffic changes, without a dedicated server for
each app. An app with no traffic uses no compute.

## Data storage

<!-- graph.ts:1 "one app's graph, and nothing of the fleet's"; the DO name is
     pinned at the app's birth (directory.ts storeName) so a rename never moves
     the data. -->

Each app has its own SQLite database inside a Cloudflare Durable Object. App
databases are not shared.

The platform restricts each app to its own database when it handles a request.
Your signed-in assistant can access your apps on your behalf.

<!-- apps.ts blobKey: `${space}/${app}/blobs/${sha}` in the BLOBS R2 bucket,
     content-addressed, so the same photo twice is one object. -->

Photos and files are stored in Cloudflare R2 under an app-specific prefix. Files
are addressed by a hash of their contents, so uploading the same file twice
stores one copy. The database stores file metadata; R2 stores the bytes.

Structured app data uses a graph of entities and components. Apps can declare
their own components. See [the documentation](/docs) for the data model.

## Serving app files

<!-- files.ts + the Files entrypoint, cached per wrangler.toml
     [exports.Files.cache]; the default entrypoint is never cached because the
     cache key is not the hostname. -->

An app consists of `index.html` and related CSS, JavaScript, image, and other
files. There is no required framework or build step.

Files are served from R2 through Cloudflare's cache. A cached file can be
returned from the edge without reading R2. Paths without a file extension
receive `index.html`, which supports client-side routing and direct loads of
nested URLs.

<!-- versions.ts KEEP = 20 -->

Each deployment creates a version, and the last twenty are kept. A rollback
restores an earlier set of files as a new version. Rollbacks do not change saved
app data.

## Server-side code

<!-- dispatch.ts: a worker.js among an app's files is uploaded into the
     `yak-apps` Workers for Platforms dispatch namespace; the kernel forwards
     non-/api requests to it and falls back to the files on a 404. -->

Apps can receive webhooks or call APIs without exposing credentials in browser
code. A `worker.js` file runs as a Cloudflare Worker in a Workers for Platforms
namespace. App requests reach that worker first; a 404 response falls back to
the app's files.

App code never receives your yaks.app sign-in session. The platform uses a token
valid for sixty seconds and scoped to one app database and one visitor. It
removes the token before app code receives the request. App secrets are stored
separately and do not appear in app files.

## Connectors and MCP

<!-- mcp.ts: POST /mcp is stateless streamable HTTP; GET /mcp is the per-person
     stream backed by the Wire DO, resumable by Last-Event-ID. Auth is OAuth
     via @cloudflare/workers-oauth-provider. -->

The MCP endpoint is `https://yaks.app/mcp` and uses Streamable HTTP. It supports
Claude connectors, ChatGPT custom connectors, Claude Code, and other MCP
clients. No yaks.app-specific client package is required.

Authentication uses OAuth with dynamic client registration. Accounts have no
password; yaks.app emails a six-digit code and stores the browser session in a
signed cookie. Only a keyed digest of the code is stored.

App pages do not use MCP. They import a client from their own URL and access the
app database through `query`, `apply`, `search`, `subscribe` over a WebSocket
for live updates, and `upload` for files.

## Access levels

Each app has one of three access levels, which can be changed:

<!-- session.ts reads/writes: private hides the app entirely; open lets a
     stranger write; public is read-anyone, write-members. -->

- **Public.** Anyone with the link can read it. Only you and invited members can
  make changes. This is the default.
- **Open.** Anyone with the link can read and write without signing in. This
  suits votes, signup sheets, and guestbooks.
- **Private.** Only you and invited members can open it. Other visitors are not
  told that it exists.

Invitations use email addresses and apply to the whole space, not one app.
Members can be owners, editors, or viewers. Only members can change app files;
the Open level applies to app data, not code.

## Custom domains

<!-- domains.ts: Cloudflare for SaaS custom hostnames on the yaks.app zone,
     HTTP DV, one CNAME to ORIGIN (route.ts). Apex is a hint, not a special
     case; the guide's answer is CNAME flattening. -->

A space, or one app in it, can use a domain you own in addition to
`yourname.yaks.app`. On the space, the domain serves it the way that address
does: your front page at `/` and each app at `/appname/`. On an app, that app
answers at the root of the domain. It's a Cloudflare for SaaS custom hostname.
Add a `CNAME` record at your registrar pointing to `origin.saas.yaks.app`.
Cloudflare issues and renews the TLS certificate.

Your assistant can report whether the DNS record is visible, the hostname is
accepted, and the certificate is issued. DNS standards do not allow a `CNAME` on
a bare domain such as `ourbookclub.com`. Cloudflare's free DNS plan supports
CNAME flattening for this case.

## Limits

The free plan allows five apps, 1 GB of app data, and 100 emails a month. A
person owns up to five free spaces, and their emails, builds, builder tokens and
sandbox time are shared by all of them; a space somebody invited you into, or
one on the Plus plan, does not count toward yours. Plus allows unlimited apps,
10 GB of app data, 50 GB of photos and files, and 2,500 emails a month. Visits
are allowed 50,000 a month on Free and 1,000,000 on Plus; past that an app
answers visitors 429 until the 1st, while the space's own people, signed in, are
still served. Operations that exceed a limit are refused, but existing apps and
data are not deleted. Your assistant receives a notice when usage reaches 80% of
a limit.

The email limit counts incoming and outgoing messages, and only sending stops
when the limit is reached. Incoming messages are still delivered. The count
resets on the first day of each month.

The optional built-in builder includes five builds a month on Free and 100 on
Plus. A build counts when it deploys an app, not per message. Its model reads
and writes up to 1,000,000 tokens a month on Free and 10,000,000 on the Plus
plan, counted whether or not a conversation deploys. Apps built or changed
through your connected agent do not use this allowance.

When something must be compiled — Rust to WebAssembly, say — the builder can run
it in a Linux container and copy the result into your app. The container comes
with Rust 1.98.1 (and wasm-bindgen 0.2.128, wasm-opt 132), Python 3.13.15 with
pip, Go 1.27.1, Zig 0.16.0 — which is also its C and C++ compiler — and Deno
2.9.1 alongside Node and Bun. Anything else the builder installs for that
session with `apt` or a package manager; the container's network reaches the
package registries and nothing else. One build gets **10 minutes** of container
time; past that the build says so and keeps whatever it has already shipped. A
month holds **1 hour** of container time on Free and **10 hours** on the Plus
plan, and one person has one container awake at a time on Free, two on the Plus
plan. The container is destroyed when the build ends, and everything in it with
it.

[The pricing page](/pricing) has both plans in full.

These limits apply to both plans:

- **20 MB** is the largest single file or upload.
- **20 versions** of an app are kept to roll back to.
- An app's own `worker.js` gets **50 ms of CPU** and **50 outgoing requests**
  per request. Waiting for an external API does not count toward CPU time.
- A sign-in code lasts **ten minutes**, allows **five guesses**, and yaks.app
  sends at most **three an hour** to one address.
- Without signing in, one place (one IP address) may ask for **5 sign-in
  codes**, register **10 connector clients**, make **60 connector tool calls**
  and send **1 piece of feedback** a minute, and make **300 requests a minute**
  for an app's data. Past that the answer is HTTP 429 with `Retry-After: 60`.
  Signed-in people are not counted.

## Current limitations

- **App email uses yaks.app addresses.** An app sends and receives at
  `<space>.<app>@yaks.app` — the space's front page at `<space>@yaks.app` — and
  a domain of your own cannot receive app mail, even when it serves the app
  pages.
- **No server-side image resizing.** An app can resize a photo in the browser
  before uploading it. yaks.app reads image dimensions but does not otherwise
  process the image.
- **No package installation in app code.** There is no package registry or
  bundler, so `worker.js` cannot install npm packages.
- **Search matches whole words.** Looking for _lemon_ won't find _lemons_.
- **Live subscriptions have a 2 KB query limit.** A connection can watch about 2
  KB of queries. Additional queries are refused.
- **Deleting a space requires email confirmation.** Your assistant cannot
  complete the deletion. yaks.app emails a confirmation link that is valid for
  one hour because deletion cannot be undone.
- **No wildcard domains.** One custom hostname serves one place — a space or an
  app.

## Exporting data

Ask your assistant to export an app: _give me everything in the recipe box as a
file._ It can read the app's data and files and return them directly. No
separate export request is required.

For a copy of what we hold about you, or to close your account, write to
<hello@yaks.app>. The [privacy page](/privacy) says what we keep and for how
long.

## More technical documentation

[The documentation](/docs) covers the data model, queries, files, sharing,
server-side code, and error handling. Add `.md` to any page's address for the
markdown an assistant reads.

Report an error on this page to <hello@yaks.app>.
