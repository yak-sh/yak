# Connect yaks.app

If you are a person reading this, paste this page's link,
https://yaks.app/agent, into your AI agent (Claude, ChatGPT, Claude Code, Cursor
or another), and it will follow these steps for you.

If you are the agent: the person who pasted this link wants you connected to
yaks.app. Once you are, you can build them web apps and put them online at their
own address, like `yourname.yaks.app/recipes`, with data that stays and sign-in
for the people they share an app with.

yaks.app is a remote MCP server:

- URL: `https://yaks.app/mcp`
- Transport: streamable HTTP
- Name: `yaks.app`, or `yaks` where a name must be one word
- Sign-in: OAuth. The person's browser opens, and they sign in with their email
  and the code sent to it. There is no API key. The first sign-in makes their
  free account.

Find the section for the app you are running in. Do every step you can do
yourself, then tell the person the one step that is theirs, in a sentence or two
with the exact thing to click or type.

## You already have yaks.app's tools

If tools from yaks.app such as `about`, `app_new` and `app_deploy` are available
to you, you are connected. Call `about`, then go to
[Once you are connected](#once-you-are-connected).

## Claude Code

1. Run `claude mcp add --transport http --scope user yaks https://yaks.app/mcp`.
2. Tell the person: "Type `/mcp`, pick **yaks** and choose **Authenticate**.
   Your browser opens to sign in to yaks.app." Outside an interactive session,
   `claude mcp login yaks` does the same.

If the tools don't appear after they sign in, tell them to start a new Claude
Code session.

## Codex

1. Run `codex mcp add yaks --url https://yaks.app/mcp`.
2. Tell the person: "Run `codex mcp login yaks` and sign in in the browser it
   opens, then start a new Codex session."

In the Codex app, the same server is under **Settings** → **MCP servers**, where
the person presses **Authenticate**.

## Cursor

1. Add the server to `~/.cursor/mcp.json`, keeping any servers already there:
   `{ "mcpServers": { "yaks": { "url": "https://yaks.app/mcp" } } }`
2. Tell the person: "In Cursor's settings, find **yaks** among the MCP servers
   and sign in to yaks.app when it asks."

## VS Code with GitHub Copilot

1. Run
   `code --add-mcp '{"name":"yaks","type":"http","url":"https://yaks.app/mcp"}'`.
2. Tell the person: "When VS Code starts the yaks server, sign in to yaks.app in
   the browser it opens."

## Gemini CLI and Antigravity

- Gemini CLI: run `gemini mcp add --transport http yaks https://yaks.app/mcp`,
  then tell the person to type `/mcp auth yaks` and sign in in their browser.
- Antigravity: add `"yaks": { "serverUrl": "https://yaks.app/mcp" }` under
  `mcpServers` in `~/.gemini/config/mcp_config.json`, then tell the person to
  open Agent settings → **Customizations** and press **Authenticate** beside
  yaks.

## Claude on the web, desktop or phone

You can't add a connector yourself. Give the person this link, which opens
Claude's **Add custom connector** dialog with yaks.app filled in:

https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=yaks.app&connectorUrl=https%3A%2F%2Fyaks.app%2Fmcp

Tell them to confirm it, sign in to yaks.app with their email when Claude asks,
and then start a new chat.

- On a phone, the link works in a browser at claude.ai. Once the connector is
  added, it works in the Claude phone app too.
- Claude's free plan allows one custom connector.
- On a Team or Enterprise plan, an owner adds it under **Organization settings**
  → **Connectors**, and then the person presses **Connect** beside it in
  **Customize** → **Connectors**.

## ChatGPT

You can't add a connector yourself. Tell the person these steps, which work on
the web, not in the phone app:

1. Open https://chatgpt.com/plugins, press **+**, then **Add custom MCP
   server**.
2. Name: `yaks.app`. Description: `Build, host and share web apps.` Under
   **Connection**, paste `https://yaks.app/mcp`.
3. Read the warning, press **I understand and want to continue**, then **Create
   as a plugin**, and sign in with their email.
4. Start a new ChatGPT chat.

Building needs ChatGPT Business, Enterprise or Edu, with developer mode turned
on by an admin. On Pro the connector can only read, so it can't build, and Free
and Plus can't add it. If their plan can't build, tell them Claude works on
every plan, and give them this page's link to paste there.

## Grok

Tell the person: "Open https://grok.com/connectors, choose **New Connector**,
then **Custom**, enter `https://yaks.app/mcp?auth=required`, and sign in to
yaks.app when it asks."

## Anything else

If you can run commands or edit your own MCP configuration, add a streamable
HTTP server named `yaks` with the URL `https://yaks.app/mcp`, then tell the
person to sign in through the prompt it shows. If you can't, tell the person to
add that URL wherever their app adds MCP servers or connectors. Step-by-step
pages for each app are at https://yaks.app/connect.

## Once you are connected

Call `about`. Then ask the person what they'd like to make, or suggest a few
apps from what you know about them. The guide to building an app is at
https://yaks.app/docs.md.
