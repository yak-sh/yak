import { description, feedback } from '@yaks/feedback'
import type { NamedTool } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import type { Host } from '@yaks/host'
import { said, worded } from '@yaks/tools/result'
import { valued, valueIn } from '@yaks/tools/value'
import { pinned } from './release.ts'
import { remote } from './remote.ts'
import { doorUrl } from './rpc.ts'
import type { Command } from './run.ts'

let declaration = {
  name: feedback.name,
  title: 'Send feedback about yak',
  description: description +
    ' Sign in with yak auth yaks.app to keep the thread under your account. ' +
    'If signed out, save the private receipt to read replies to the same thread.',
  destructive: feedback.destructive,
  openWorld: feedback.openWorld,
  positional: ['text'],
  inputSchema: { ...feedback.input, additionalProperties: false },
}

let sending = (args: Record<string, unknown>) => ({
  ...args,
  yak_version: pinned['@yaks/cli'],
})

/** The feedback tool a local yak host offers to MCP clients. */
export let feedbackTool = (host: Pick<Host, 'remote'>): NamedTool => ({
  ...declaration,
  run: async (call) => {
    let rows = await host.remote!(feedback.name, sending(argsOf(call)), {
      mixedAuth: true,
    })
    return [{
      ...said(call, worded(rows)),
      output: valued(call, valueIn(rows)).output,
    }]
  },
})

/** The CLI feedback command also works before a graph has been initialized. */
export let feedbackCommand: Command = {
  ...declaration,
  run: async (args, ctx) => {
    let rows = await remote(feedback.name, sending(args), {
      url: new URL(doorUrl(ctx.host)).origin,
      mixedAuth: true,
      as: ctx.as,
      state: ctx.state,
      config: ctx.config,
    })
    ctx.out(ctx.json ? JSON.stringify(valueIn(rows), null, 2) : worded(rows))
    return 0
  },
}
