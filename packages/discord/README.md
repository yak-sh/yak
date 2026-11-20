# @yaks/discord

Discord for [@yaks/chat](../chat/README.md). A bot hears messages only over
Discord's [Gateway](https://discord.com/developers/docs/events/gateway), a
websocket it holds open, so `gateway(token)` is its handshake, heartbeat and
resume as @yaks/chat's pure `Socket` steps, and `send(token, reply)` posts a
reply with the REST API. `discord` is the `Platform` both make.

- **Hello** identifies with `INTENTS` (servers, their messages, direct messages
  and Message Content), or resumes the session it had, and beats at the interval
  Discord gives.
- **A message** is heard as `Said` (`said(message, me)`): a bot's own and other
  bots' are not, so two bots never answer each other. It is `mentioned` when it
  names the bot or was sent to it directly, and the bot's mention is taken out
  of its words.
- **A beat Discord never answered**, a reconnect request, or an invalid session
  connects again; a session Discord says can be resumed is resumed, any other
  identifies afresh.
- **Close codes** after which the same token must not connect (a refused token,
  a disallowed intent) are said by `ends(code)` in words for whoever holds the
  bot.
- **A reply** answers the message it names, when there still is one, and pings
  nobody. A 429 or 5xx is `Unsent`, tried again after what Discord says.

- **A room's server** is what Discord says of the channel
  (`server(token, room)`, GET `/channels/{id}`): its guild, none for a direct
  one.

- **Working on an answer** shows as typing (`typing(token, room)`, POST
  `/channels/{id}/typing`), which Discord keeps for ten seconds or until the
  bot's next message there, so it is `working` every 8 s. It needs no intent. A
  bot shows online on its own while its Gateway socket is open.

Messages in rooms the bot was not named in carry their words only with the
Message Content intent, which Discord reviews for a bot in over 100 servers.

The token is the host's to supply: yaks.app's own bot's, or the one a space
brings (@yaks/connections' `discord` and `discord-bot` integrations). Nothing
reads the environment.
