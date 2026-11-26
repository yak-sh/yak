# @yaks/model-cli

The native harness can use Grok Build (`grok`) and Google Antigravity CLI
(`agy`) on the machine that runs the harness effects. Sign in to each CLI
interactively as the operating-system user that runs those effects. Each CLI
finds its own sign-in. The harness passes the transcript and tool definitions
through the CLI and keeps credentials in the CLI's own account store.
[Grok Build authentication](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/02-authentication.md)
and
[Antigravity authentication](https://antigravity.google/docs/install?tab=cli)
describe those sign-ins.

Add the plugin entry to the host's `plugins` list alongside `@yaks/harness`.

```json
{
  "use": "@yaks/model-cli",
  "with": {
    "grok": { "models": ["grok-4.6"] },
    "antigravity": { "models": ["gemini-3.8-flash-medium"] }
  }
}
```

Each key enables its provider. `command` can name the path to the vendor's
executable if it is outside the effects host's PATH. The `models` array lists
the CLI model IDs for `yak model list`. Use the IDs in Grok's model picker and
`agy models` to match your plan. These providers are for an effects host running
under the CLI account, including a host running yak from a source checkout.

A new session or a follow-up can select either provider by name.

```sh
yak session new 'Summarize the task' --provider grok --model grok-4.6
yak session send S-123 'Continue the work' --provider antigravity --model gemini-3.8-flash-medium
```

## Routes for subscription failover

After both providers are configured on the effects host, add their offerings to
the graph's default with `routes` edges. This example uses the models above. Its
edge order puts these offerings after the existing default routes when none of
their plans has a quota reading. Each provider has its own plan unless its
`provider.plan` names another.

```sh
yak graph apply --bundles '[
  {"entity":{"eid":"$grok"},"provider":{"name":"grok"}},
  {"entity":{"eid":"$grok_model"},"model":{"name":"grok-4.6"}},
  {"entity":{"eid":"$grok_offer"},"edge":{"from":"$grok","to":"$grok_model"},"serves":{"name":"grok-4.6"}},
  {"edge":{"from":"8b429c76-beb1-8dcf-82fc-c68f7f0e5c73","to":"$grok_offer","ord":100},"routes":{}},
  {"entity":{"eid":"$antigravity"},"provider":{"name":"antigravity"}},
  {"entity":{"eid":"$antigravity_model"},"model":{"name":"gemini-3.8-flash-medium"}},
  {"entity":{"eid":"$antigravity_offer"},"edge":{"from":"$antigravity","to":"$antigravity_model"},"serves":{"name":"gemini-3.8-flash-medium"}},
  {"edge":{"from":"8b429c76-beb1-8dcf-82fc-c68f7f0e5c73","to":"$antigravity_offer","ord":101},"routes":{}}
]'
```

When a routed plan runs out, the harness writes a `Moved on` entry and replays
the conversation on the next available plan. An immediate retry passes each
exhausted plan once. When no route has room, a CLI quota failure defers for an
hour and can try the routes again then. Transient capacity errors follow the
harness's ordinary retry. Antigravity's per-invocation settings disable using
Google AI credits after plan quota runs out.

## One headless turn

Every ask starts a fresh headless process in a temporary directory with the
model selection, graph history, instructions, and tool declarations. The CLI
returns a schema-constrained text reply and any tool requests. The harness
executes those requests using its usual workspace and permissions. Grok limits
its tool set on the command line. Antigravity selects a local custom agent with
an empty built-in tool list and no inherited MCP or customizations. The adapter
emits the reply's text once the structured result is complete. It accepts text
and harness tools. Media and typed questions are refused before a CLI is
started.

The CLI protocols are documented by
[Grok Build](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)
and [Google Antigravity](https://antigravity.google/docs/cli/headless/).
