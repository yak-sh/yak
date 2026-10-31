// The terminal's account selector is an input to admin operations. This
// binding belongs to the CLI facet, independently of any tool's schema.
import type { CliCommand, CliFacet } from '@yaks/cli/host'
import { toolsIn } from '@yaks/vocab/tools'
import { adminDoc } from './vocab.ts'

export let globals: CliFacet['globals'] = Object.fromEntries(
  toolsIn(adminDoc).filter((t) =>
    Object.hasOwn(t.inputSchema?.properties ?? {}, 'as')
  ).map((t) => [
    t.name!,
    ['as'],
  ]),
)

export let commands: CliCommand[] = [{
  noun: 'admin',
  verb: 'throwaway',
  title: 'Run one command as a throwaway test account',
  description:
    "Sign in as a test account, <name>@bot.yak.sh, run one shell command as it, and sign out. Without a name, a fresh probe-<random> address. The sign-in code is read from the letter in this graph. The box's own account never changes; a test account to keep signing in as is `yak auth yaks.app --as <address>`.\n\n  yak admin throwaway 'yak about && yak app_list' --name cookbook",
  positional: ['command'],
  name: 'admin_throwaway',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'the shell command to run as the account',
      },
      name: { type: 'string', description: 'the local part of the address' },
    },
    required: ['command'],
    additionalProperties: false,
  },
  run: async (args, host, context) =>
    (await import('./throwaway.ts')).throwaway()(args, host, context),
}, {
  noun: 'admin',
  verb: 'client',
  title: 'Keep an OAuth client',
  description:
    "Keep an OAuth client yaks.app signs in to a service as, sealed in the platform's vault under its name; every integration naming that client signs in as it. The id and the secret are op:// references read only by this terminal command and never printed.\n\n  yak admin client google 'op://Yak Shaving LLC/googleapis oauth/client id' 'op://Yak Shaving LLC/googleapis oauth/client secret' --as admin@bot.yak.sh",
  positional: ['name', 'id', 'secret'],
  name: 'admin_client',
  globals: ['as'],
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "the client's name, as an integration's `client` names it",
      },
      id: {
        type: 'string',
        description: 'an op:// reference to the client id',
      },
      secret: {
        type: 'string',
        description:
          'an op:// reference to the client secret, for a confidential client',
      },
      as: {
        type: 'string',
        description:
          'the owner’s yaks.app connection, matched by whole address or the part before @; list the owner’s connections with connection_list(owner), or yak connection list <owner> (owner id or name), and use a yaks.app entry’s account. Default is your own email, else the oldest connection',
      },
    },
    required: [
      'name',
      'id',
    ],
    additionalProperties: false,
  },
  run: async (args, host, context) =>
    (await import('./client.ts')).client()(args, host, context),
}]
