# @yaks/discord

Discord for [@yaks/chat](../chat/README.md). A bot hears messages only over
Discord's [Gateway](https://discord.com/developers/docs/events/gateway), a
websocket it holds open, so `gateway(token)` is its handshake, heartbeat and
resume as @yaks/chat's pure `Socket` steps, and `send(token, reply)` posts a
reply with the REST API. `discord` is the `Platform` both make.

- **Hello** identifies with `INTENTS` (servers, their messages, direct messages,
  and all three privileged intents: Message Content, Server Members and
  Presence), or resumes the session it had, and beats at the interval Discord
  gives. A bot whose owner did not turn Members or Presence on is refused them
  (4014), and identifies afresh with the `NEEDED` ones alone (`closed`).
- **A message** is heard as `Said` (`said(message, me)`): a bot's own and other
  bots' are not, so two bots never answer each other. It is `mentioned` when it
  names the bot or was sent to it directly, and the bot's mention is taken out
  of its words.
- **Who is about** is each person's status as Discord says it, `online`, `idle`,
  `dnd` or `offline` (someone invisible shows offline), from the presences a
  server arrives with and each `PRESENCE_UPDATE` after (`presents`), never a
  bot's. It needs the Presence intent.
- **A beat Discord never answered**, a reconnect request, or an invalid session
  connects again; a session Discord says can be resumed is resumed, any other
  identifies afresh.
- **Close codes** after which the same token must not connect (a refused token,
  a disallowed intent) are said by `ends(code)` in words for whoever holds the
  bot.
- **A reply** answers the message it names, when there still is one, and pings
  nobody but the one account it names (`ping`), with its buttons (`controls`) as
  secondary buttons, five to an action row. A 429 or 5xx is `Unsent`, tried
  again after what Discord says.
- **A press** of a button is an `INTERACTION_CREATE` of type 3 (a message
  component), which Discord sends over the Gateway to a bot with no interactions
  endpoint set, whatever its intents (`pressed`). `presses.hold` answers it at
  once, within Discord's three seconds, as a deferred ephemeral message
  (callback type 5, flag 64) that only the presser sees; `presses.answer` writes
  that message (PATCH `/webhooks/{app}/{token}/messages/@original`) within the
  fifteen minutes its token lasts. An ephemeral message is the only way a bot
  says something in a room to one person, and only in answer to an interaction.

- **A direct message** (`direct(token, user, text)`) opens the person's direct
  room (POST `/users/@me/channels`) and posts to it, pinging nobody. Discord
  refuses someone who shares no server with the bot or takes no direct messages
  from it (403), which is `Unreachable`.

- **A room's server** is what Discord says of the channel
  (`server(token, room)`, GET `/channels/{id}`): its guild, none for a direct
  one.

- **Working on an answer** shows as typing (`typing(token, room)`, POST
  `/channels/{id}/typing`), which Discord keeps for ten seconds or until the
  bot's next message there, so it is `working` every 8 s. It needs no intent. A
  bot shows online on its own while its Gateway socket is open.
- **A server's rooms** are its text and announcement channels in the order
  Discord shows them (`rooms(token, server)`, GET `/guilds/{id}/channels`),
  which a space chooses the one it hears in full from.
- **A room's recent messages** are read back newest first and given oldest first
  (`recent(token, room, {before, limit})`, GET `/channels/{id}/messages`, at
  most 100), bots' own included and none `addressed`. They carry no server:
  Discord's answer leaves it out.

- **Its name in a server** is its nickname there (`named(token, server, name)`,
  PATCH `/guilds/{id}/members/@me`), cut to Discord's 32 characters. It needs
  Change Nickname.

- **What it may read** for people in a server is `api`: Discord's REST API as
  the bot (`Bot` before its token), at the paths any member could read: the
  server and its preview, channels, active threads, roles, members, emoji,
  stickers and events; a channel, its messages, one message, its pins,
  reactions, archived public threads, thread members and poll voters; a user.
  Never the servers the bot is in, which are other spaces', nor what only
  moderators see.
- **A room every member sees** is `open(token, room)`: the server's @everyone
  role, with the channel's overwrite for it, holds View Channel
  (`everyone(guild, channel)`). A thread is its channel's; a private thread and
  a direct room are open to nobody else.
- **A room's basics** are `basics(token, room, people)`: the server's name and
  icon (`icon(server, hash)`, on Discord's CDN, an animated one as GIF), the
  channel's name and topic, and each of `people` by their nickname, with the
  server's roles they hold, highest first.

- **Voice rooms.** Who is in each comes from the Voice States intent: the
  `voice_states` a server arrives with and each `VOICE_STATE_UPDATE`, read by
  `voices(server, states, me)`, the bot's own marked `me` and other bots `bot`.
  `join(server, room)` is the Update Voice State frame (op 4) that takes the bot
  into a room, or out with `room` null, and `VOICE_SERVER_UPDATE` says where its
  audio goes (`media`). The audio itself needs UDP and Discord's end-to-end
  encryption (DAVE), which a Worker cannot hold, so
  [@yaks/discord-voice](../discord-voice/README.md)'s relay does, and streams
  the room to its host over `line`: 24 kHz 16-bit mono, as JSON frames
  `start{call}`, `media{payload}`, `speaking{user}`, `mark{name}` and `stop`,
  the host sending `media`, `clear` and `mark`.

yaks.app's authorize link asks for `PERMISSIONS` (@yaks/connections'
`discord.json` carries the same integer): View Channels and Read Message
History; Send Messages, in threads too, with Embed Links, Attach Files, Send
Polls, Add Reactions and outside emoji and stickers; creating and managing
threads; Manage and Pin Messages; creating and managing events; Change Nickname;
and Connect, Speak and Use Voice Activity. A server that added the bot before
keeps what it was given then until it adds it again.

Messages in rooms the bot was not named in carry their words only with the
Message Content intent, and a server's member list needs Server Members. Discord
reviews the privileged intents of a bot in over 100 servers.

The token is the host's to supply: yaks.app's own bot's, or the one a space
brings (@yaks/connections' `discord` and `discord-bot` integrations). Nothing
reads the environment.
