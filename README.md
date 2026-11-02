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
| `mirrorTo` | a read-only copy of each message also goes to other sessions, even on another machine; the room's owner still answers |
| `!!setup` | the host lays out a new server: rooms, a thread per bot, a rule check |

Everything is opt-in in `access.json`; with none of it set the plugin behaves like upstream.
Full list: [docs/PATCHES.md](docs/PATCHES.md). Diff against upstream: [docs/upstream.patch](docs/upstream.patch).

## Who hears what (listening on and off)

| how | on | off | survives a restart |
|---|---|---|---|
| `!here` | `!here`, `!here 30m`, `!here 2h` in a room: answers without a tag | `!lock`, or idle for the set time (default 10 min) | no |
| join a thread | tag the bot in a thread, or `!!summon @Bot` | `!leave` / `!kick` | yes (`joined.json`) |
| per room | `requireMention: false` in `access.json` | `requireMention: true` | yes |
| per machine | `access.local.json` beside `access.json`: `deny: true` silences a room on this machine only | delete the entry | yes, never committed or synced |

The plugin re-reads both files on every message, so no restart is needed.

**One bot, one listener.** Two processes holding the same bot both hear every message and both answer: two workers
on one task. To keep a second agent informed, use `mirrorTo` (a read-only copy); to hand a room over, use `forwardTo`.

## Install

```bash
# in Claude Code
/plugin marketplace add Soul-Brews-Studio/claude-discord-channel
/plugin install discord@soul-brews

# start an agent with its own bot (token from your password store, never a file in a repo)
DISCORD_BOT_TOKEN=... DISCORD_STATE_DIR=~/.claude/channels/<name> \
  claude --channels=plugin:discord@soul-brews
```

Bot token and access setup: [docs/UPSTREAM-README.md](docs/UPSTREAM-README.md) and
[plugins/discord/ACCESS.md](plugins/discord/ACCESS.md).

## Layout

```
.claude-plugin/marketplace.json   this repo is a plugin marketplace ("soul-brews")
plugins/discord/                  the plugin: server.ts, skills, manifest
docs/PATCHES.md                   every change, setting by setting
docs/upstream.patch               diff -u against the official 0.0.4 server.ts
docs/UPSTREAM-README.md           the official README, unchanged
```

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
