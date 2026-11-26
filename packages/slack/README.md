# Slack chat provider

`@yaks/slack` supplies Slack's Events API and Web API to `@yaks/chat`. A space
owner adds the app from Connections. Each workspace installation grants its own
bot token. A channel mention or direct message reaches the connected space's
Operator as a guest message. The answer is posted in the Slack thread.

## Register the yaks.app Slack app

1. Sign in at [Your Apps](https://api.slack.com/apps) with the yaks.app Slack
   account. Create an app **From a manifest**, choosing a workspace yaks.app
   controls. Paste the JSON printed by the command below.
2. In **Basic Information**, save the **Client ID**, **Client Secret**, and
   **Signing Secret** in the shared 1Password vault in an item named
   `Slack yaks.app application`. Name the fields `client id`, `client secret`,
   and `signing secret`.
3. From a terminal with access to the shared vault, register the client with the
   command below. It copies the three fields directly to the platform vault. The
   signing secret verifies callbacks. OAuth provides each installation's bot
   token.
4. In **Event Subscriptions**, enable events and verify
   `https://yaks.app/slack/events`. Subscribe to the bot events `app_mention`
   and `message.im`, then save. Activate public distribution in **Manage
   Distribution** to allow installation in another workspace.

```sh
jq '{
  display_information: {name: "yaks.app"},
  features: {
    bot_user: {display_name: "yaks.app"},
    app_home: {messages_tab_enabled: true, messages_tab_read_only_enabled: false}
  },
  oauth_config: {
    redirect_urls: ["https://yaks.app/connections/callback"],
    scopes: {bot: .scopes}
  }
}' packages/connections/slack.json
```

```sh
yak admin client slack \
  'op://Yak Shaving LLC/Slack yaks.app application/client id' \
  'op://Yak Shaving LLC/Slack yaks.app application/client secret' \
  --signing 'op://Yak Shaving LLC/Slack yaks.app application/signing secret' \
  --as admin@bot.yak.sh
```

## Test a workspace installation

1. As the owner of the yaks.app `checks` space, open its Connections page and
   connect Slack. On Slack's authorization screen choose a test workspace.
2. Invite the app to a test channel. Mention it in a message and verify its
   reply appears under that message. Mention it again within the thread and
   verify the next reply stays under the same root message.
3. Open the app's **Messages** tab, send a DM, and verify a threaded reply.
4. Disconnect Slack in Connections and send another mention. The workspace stops
   reaching the Operator. Use Slack's app settings to uninstall it from the
   workspace when desired.
