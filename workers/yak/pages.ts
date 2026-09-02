// The kernel's own pages, in the home page's voice (workers/yak/public): what
// a person sees when there is nothing at an address, or when an app broke.
// One shell, three sentences; the palette is the home page's, inlined so a
// space's hostname needs no asset of the apex. Never a stack trace — the
// exception entity carries that to the person's agent (D-32318 §Errors).
let shell = (title: string, lead: string, status: number) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title} · yaks.app</title>
<style>
:root { color-scheme: light; --ground: #fdf5ee; --ink: #4a3a30; --soft-ink: #6f5d50; --meadow: #5c8a4c }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ground: #2a2320; --ink: #f1e6d8; --soft-ink: #c2b2a3; --meadow: #a7c080 } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--ground); color: var(--ink); font: 400 1.05rem/1.6 'Nunito', system-ui, sans-serif }
main { max-width: 30rem; padding: 2rem; text-align: center }
h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 .5rem }
p { color: var(--soft-ink); margin: 0 0 1rem }
a { color: var(--meadow) }
</style>
</head>
<body><main><h1>${title}</h1><p>${lead}</p><a href="https://yaks.app/">yaks.app</a></main></body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )

export let lost = () =>
  shell(
    'That page wandered off.',
    "There's nothing at this address. Head back home?",
    404,
  )

export let nothingHere = () =>
  shell(
    'Nothing here yet.',
    "This address is waiting for its first app. If it's yours, ask your " +
      'assistant to make something.',
    404,
  )

export let oops = () =>
  shell(
    'Something went wrong.',
    'Your assistant has been told and will take a look. Try again in a ' +
      'little while.',
    500,
  )

// A door a later leaf fills (sign-in, the connector): plain, not a mystery.
export let soon = (what: string) =>
  shell(`${what} is on its way.`, "We're still setting the table.", 404)
