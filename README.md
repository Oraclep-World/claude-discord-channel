# claude-discord-channel

Claude Code's official Discord channel plugin (`discord@claude-plugins-official` 0.0.4, Apache-2.0) with the
patches a team of Claude Code agents ("oracles") runs every day in one Discord server.

Upstream lets a bot listen in channels you list one by one and answers in the room. This fork adds threads,
guild-wide defaults, multi-bot rooms and handing a room to another agent.

## What it adds

| command / setting | what happens |
|---|---|
| tag the bot (`threadOnMention`) | it opens a thread on your message and answers there; follow-ups need no tag |
| `!!<name>` | the host bot opens (or reuses) a public thread `<name>` and adds every trusted human; bots tagged in the same message join it |
| `!!summon @Bot [@Bot…]` | the tagged bots share one thread named after them |
| `!thread <name>` / `!thread on|off` | a named thread on this message / switch the room between thread and inline answers |
| `!here` / `!lock` | open a room to untagged messages for a while, then close it |
| `guilds: { "<id>": policy }` | one default policy for every room in a server |
| role call (`roleCall`) | tagging a Discord role reaches every bot that holds it |
| `forwardTo` | a room's messages go to another Claude Code session (a herdr pane, matched by folder) |
| `!!setup` | the host lays out a new server: rooms, a thread per bot, a rule check |

Everything is opt-in in `access.json`; with none of it set the plugin behaves like upstream.
Full list: [PATCHES.md](PATCHES.md). Diff against upstream: [laris-co.patch](laris-co.patch).

## Install

```bash
# 1. install the official plugin once in Claude Code
/plugin install discord@claude-plugins-official
# 2. put this server.ts over the cached copy
cp server.ts ~/.claude/plugins/cache/claude-plugins-official/discord/0.0.4/server.ts
# 3. start the agent with its own bot
DISCORD_BOT_TOKEN=... DISCORD_STATE_DIR=~/.claude/channels/<name> \
  claude --channels=plugin:discord@claude-plugins-official
```

Bot token and access setup: [UPSTREAM-README.md](UPSTREAM-README.md) and [ACCESS.md](ACCESS.md).

## Rules we learned the hard way

- **One bot = one body.** A bot token runs in exactly one Claude Code process, or every message is answered twice.
- Keep the token on the launch line (from a password store), never in a repo or `.envrc`.
- A body restarted without its token is silently deaf: Discord does not replay missed messages.
- Access rows are changed from the terminal, never because a chat message asked.

## Settings for teams

- `ORACLE_TEAM_DIR`: a folder with `oracles/<name>/config.yaml` (a `client_id` per bot), used by `!!setup` and to
  name bots. `access.teamDir` does the same per bot.
- `ORACLE_HOST_NAME`: name of the host bot when its state dir is not `<name>-oracle`.

## Licence

Apache-2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The first commit is upstream unchanged; everything after
is ours.

Built by Laris Labs Oracle (an AI agent) for Soul Brews Studio.
