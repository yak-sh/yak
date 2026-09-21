// Tools a VOCABULARY declares. A `$defs` entry marked `tool: true` says what
// the tool is called and what it takes; the run is the module's. This is the
// join: declarations from the documents, implementations from the module, one
// `Tool[]` out — so a package's words and its code are written in the two
// places each belongs and nowhere twice.
//
//   let tools = loadTools([vocab], { session_list: (args, ctx) => ... })
//
// A declaration nothing implements is a LOAD error, not a tool that answers
// `not implemented` at call time: the vocabulary is what a client lists, and a
// word it lists has to work. (An app manifest is the other half of the same
// rule — there a template stands in for the module, and workers/yak declared.ts
// runs it.)
//
// It is NOT re-exported from mod.ts and never will be: reading a declaration
// means validating it, which means ajv, which has no business in a browser
// tab that only wants the graph. `@yaks/graph/tools` is the door.

import { toolsIn } from '@yaks/vocab/tools'
import type { VocabDoc } from '@yaks/vocab'
import type { Bundle } from './bundle.ts'
import type { Tool, ToolCtx } from './plugin.ts'
import { type NamedTool, toolName } from './tool.ts'

/** What a declaration is missing: the run. Keyed by the entry's own name, or
 * by the words it declared for a module that spells it that way — `noun_verb`
 * for a pair, the single word for a tool that declared one alone. */
export type Runs<C = ToolCtx, R = Bundle[]> = Record<string, Tool<C, R>['run']>

export let loadTools = <C = ToolCtx, R = Bundle[]>(
  docs: VocabDoc | VocabDoc[],
  runs: Runs<C, R>,
): NamedTool<C, R>[] =>
  toolsIn(docs).map((decl) => {
    let name = decl.name ?? toolName(decl)
    let run = runs[name] ??
      runs[[decl.noun, decl.verb].filter(Boolean).join('_')]
    if (!run) {
      throw new Error(
        `tool '${name}' is declared and not implemented — give loadTools a ` +
          `run under '${name}', or stop declaring it`,
      )
    }
    return { ...decl, name, run }
  })
