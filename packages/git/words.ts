// The `./words` facet: what this package adds to a COMMAND LINE, run on the
// box that typed it. A server's facets (`./tools`, `./rules`, `./effects`, …)
// answer for the graph; a word answers for the caller's own machine — here, the
// checkout it is standing in. `land` reads no graph, needs no server and takes
// no config, so `yak land` works in any checkout at all, which is the whole
// point of it being a word rather than a tool: a `land` tool would fast-forward
// a branch on the SERVER's box, which is nobody's intent.
//
// A word is declared the way a tool is — a name, a description, an input schema
// the command line is mapped through — so it is listed, helped and completed
// from the one declaration. Only its run differs: arguments in, exit code out,
// printing as it goes, where a tool's is bundles in and bundles out. That is
// @yaks/cli's `Word`; the literals here are checked against it where the `yak`
// command carries them (@yaks/cli `here`), so a package contributing a word
// needs no dependency on the command that runs it.

import { land } from './land.ts'

/** Where a word prints: a @yaks/cli `Ctx` is one, and a test hands over two
 * arrays. `out` is the answer, `note` is everything else. */
export type Says = {
  out: (line: string) => void
  note: (line: string) => void
}

let ABOUT =
  `Land the branch you are standing on. Fast-forwards it into the base — the ` +
  `branch the shared checkout holds — and pushes if the base has an upstream. ` +
  `If the base moved, rebases onto it and returns WITHOUT merging, printing ` +
  `what it pulled in, so you can re-gate and land again; that is exit 1, ` +
  `because nothing landed. Refuses a landing whose files carry content no ` +
  `commit on the branch wrote unless --allow-revert names them. Runs no gate ` +
  `and reads no graph: every coordinate comes from git.`

/** `land` — the pure git primitive, as a word. */
let landing = {
  name: 'land',
  title: 'fast-forward this branch into the base',
  description: ABOUT,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      'allow-revert': {
        type: 'string',
        description:
          'comma-separated files whose rewind is deliberate, landed with a warning',
      },
    },
  },
  run: async (
    args: Record<string, unknown>,
    c: Says,
  ): Promise<number> => {
    let outcome = await land({
      allow: String(args['allow-revert'] ?? '').split(',').filter(Boolean),
      // git's own output, as git wrote it: stdout is the account, stderr the
      // warnings, and an empty run says nothing at all.
      write: (text, error) => {
        let said = text.trimEnd()
        if (said) (error ? c.note : c.out)(said)
      },
    })
    if (!('landed' in outcome)) return 1
    c.out(`landed ${outcome.landed}`)
    return 0
  },
}

/** The words this package contributes to a command line. */
export let words = [landing]
