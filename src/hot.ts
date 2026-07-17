// Hot swap, server half: version-stamp the served module graph.
//
// A reload that keeps the window alive works by re-importing the client
// code under a fresh URL — the browser's ESM cache is keyed by exact
// specifier, so `./App.tsx?v=8` is a brand-new module while `./App.tsx`
// stays whatever it was. Busting only the root wouldn't cascade (a child
// imported without the query resolves to the cached copy), so stamp()
// rewrites EVERY relative import in every served module with the current
// generation — the whole swappable graph re-fetches together.
//
// The exceptions are the point: live.ts and types.ts are the SHELL — they
// hold the signals (cache, camera), the socket, and the vocabulary that
// both generations must share. They stay unversioned, so every generation
// of component code resolves them to the same cached singletons and the
// app's state survives the swap. (main.tsx never re-imports at all; a
// change to shell files sends a full 'reload' instead — see server.ts.)
export let stamp = (js: string, gen: number): string =>
  js.replace(
    /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\.?\/[^"']+?)\2/g,
    (all, lead, q, spec) =>
      /(?:^|\/)(live|types)\.ts$/.test(spec)
        ? all
        : `${lead}${q}${spec}?v=${gen}${q}`,
  )
