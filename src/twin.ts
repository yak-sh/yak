// The near-duplicate ("twin") vocabulary that CLIENT and server must agree on,
// kept platform-free so both may import it without dragging in the embedder.
// The dupe hint runs on the client (client.ts, the doc view's Similar section)
// and asks the server's /similar over HTTP; if the two halves disagreed on the
// text a doc's vector means or on how close counts as the same, the hint would
// lie. So those two facts live here, apart from embed.ts's server-only machinery
// (the model, the vectors, the sweep) — which re-exports them for its own use.

// What a doc's vector means: title and body as one text, cut at the model's
// horizon (bge reads ~512 tokens; beyond ~2KB is silence anyway).
export let textOf = (title: unknown, body: unknown) =>
  `${String(title ?? '')}\n${String(body ?? '')}`.trim().slice(0, 2000)

// The twin floor, measured on the live graph (2026-07-22): an exact copy scores
// 1.0, a reworded twin ~0.83, a close sibling ~0.81, a same-domain different
// fact ~0.68 — 0.78 catches the twins (with margin for terser rewordings) and
// admits the odd sibling worth a look, while topic-mates stay out. Every similar
// door shares it: the dupe hint (client.ts) and the doc view's Similar section.
export let FLOOR = 0.78
