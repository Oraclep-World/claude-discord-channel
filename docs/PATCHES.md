# The patch in detail

The official `discord@claude-plugins-official` plugin listens only in channels listed one by one in
`access.json`, and it never opens threads. The team wants this instead: **tag a bot in any room, and it
answers in a thread on that message**. This folder keeps the code we run, so any machine can install it
and anyone can compare it with upstream.

See README.md for install. `upstream.patch` is `diff -u` of upstream 0.0.4 `server.ts` against ours.

## What the patch adds (all opt-in in access.json)

- `guilds: { "<guildId>": <policy> }` sets a default for every room in that guild that is not listed in `groups`.
- `threadOnMention: true` (per policy): a tag in a plain channel opens a thread on that message, and the
  message reaches Claude with the thread as `chat_id`. If two bots are tagged in one message, the second one
  joins the thread the first one opened.
- In a thread the bot opened, follow-ups need no tag.
- **`!thread <name>`** opens a thread called `<name>` on that message, and the message reaches Claude
  from inside it, so the bot answers there. A bare **`!thread`** opens one with a placeholder name. The message
  arrives with `thread_new`, and the agent names the thread with the **`rename_thread`** tool once it knows the topic.
- **Mode toggle per room:** `!thread on` switches the room to thread mode, and the bot reacts 🧵.
  `!thread off` switches it back to answering in the room, and the bot reacts 💬. The setting is saved in
  `<state dir>/modes.json`, so it survives restarts. When a room has no setting, `threadOnMention` decides
  (the laris-co default is off, so answers stay in the room). Bots that only answer tags need the tag on
  the command (`@bot !thread on`). Each bot keeps its own mode.
- `!here` unlocks a room, like waking a phone screen. Tag the bot with `!here`, for example
  `@LarisCo !here what's on today`. While the room is unlocked, that bot answers in the room, not in a
  thread, and hears every allowed message without a tag. Each message resets the idle timer. After
  10 minutes with no messages the room locks again. `!here 30m` or `!here 2h` sets a longer timer for
  that unlock. `!lock` locks the room now. The bot reacts 🔓 / 🔒. Only the tagged bot unlocks.
  The words and the default timer can be changed in access.json:
  `"here": { "unlock": "!here", "lock": "!lock", "idleMinutes": 10 }`.
- `historyBackfill: N` (per policy): on a tag, the plugin reads back through the room until it reaches
  this bot's own last message, or N messages. It hands those lines to Claude as `meta.context`, oldest
  first, so the bot knows what was said before it was tagged. Senders not on the allowlist are marked
  `[unverified]`. The idea comes from Hermes (`DISCORD_HISTORY_BACKFILL`).
- Every guild message reaches Claude with `tagged="true"` or `"false"` in meta. When the bot answers in a
  plain channel with `reply_to`, the plugin opens a thread on that message and answers there (only where
  `threadOnMention` is on, and not while the room is `!here` unlocked). With `requireMention: false`, a bot
  can read every message and still keep its answers in threads.
- `forwardTo: <worktree path>` (per policy): the room belongs to a worktree body of this oracle. The main
  body keeps the only gateway connection and types each message into the herdr agent whose cwd is that
  path, then reacts 📨. The worktree answers with `just say <chat_id> "<text>"`, which is send-only REST
  and does not listen. If no agent runs there, the message is delivered to the main body as usual. In
  config.yaml, write the path relative to the main checkout (`wt/<slug>`); `access-sync` makes it absolute.
- `mirrorTo: ["machine:<herdr machine>:<abs path>", "<abs path>"]` (per policy, Nat 2026-11-02): also type a
  read-only copy of each delivered message into the agent whose cwd is that path (resolved at send time, like
  `forwardTo`, so it survives moves and restarts), for example the same oracle's body on white
  (`machine:<label>:/abs/path/to/team-repo`). Exact panes
  (`machine:<label>:<pane>`, `<session>:<pane>`) also work. This body (or its `forwardTo` worktree) still answers. The copy is told not to post
  on Discord, so one bot still has one listener and gives one answer. It runs in the background with a 20 s limit, so an
  offline machine never delays the answer. Attachments are named only, because their files stay on this machine.
- `access.local.json` beside `access.json` (Nat 2026-11-02): a per-machine override. It is never committed and
  never written by `access-sync`. Its `groups` / `guilds` entries are merged over the same ids, key by key. For example,
  `{ "groups": { "<room>": { "deny": true } } }` silences that room on this machine only, which lets one bot run
  on two machines and have one of them stop hearing a room. The plugin re-reads it with every message, so there is
  no restart. `saveAccess` never writes it back into `access.json`.
- **Rooms per oracle, routed by the host.** An oracle lists its rooms in `oracles/<name>/config.yaml`
  `rooms:` (`id`, `body`, `what`). `access-sync` for the host bot (LarisCo, `host: true`) turns each room
  into a route: `forwardTo` = the body (a worktree path, matched on agent cwd in any running herdr session,
  or an exact `session:pane`), `answerAs` = the oracle's bot, and `answerMention` = its `owner`. The body
  answers with `BOT=<oracle> just say`. `just room-map <name>` posts and pins a map in the oracle's main
  channel showing thread → body → status, and edits that same message on later runs.
- `answerCmd` (set by access-sync): the full send-only command (`BOT=<bot> <laris-team>/tools/discord-say.sh`),
  so a forwarded body in another repo (neo-oracle, calliope-oracle) can answer without the laris-team justfile.
- `roleCall: [<role id>]`: a message from an `allowFrom` user that tags one of these roles (Laris Co: All Oracles)
  reaches the bot in any room, even one its policy denies, and the bot may answer in that room. A bot that is not
  running does not answer: a roll call never wakes a sleeping bot.
- **A tag in a thread joins it** (2026-10-31). When a trusted human tags a bot inside a thread, the bot stays: it
  hears the rest of that thread without a tag, until `!leave` or `!kick`. (Before, a tag counted for one message.)
- **`!!<name>` reuses its thread** (2026-10-31). The host first looks for an unlocked thread of that name in the room
  (active, else archived and unarchived) and links it; only otherwise it opens a new one. A bot tagged in the `!!`
  message (`!!fireman @FireMan Oracle`) joins that thread, so nobody has to tag it again there.
- **Roll call in a thread joins it.** A role tag (All Oracles or a team role) inside a thread makes every awake
  bot holding that role join the thread. After that, every message there from an `allowFrom` user reaches those
  bots without a tag. `!leave` in the thread makes every bot leave, and `!kick @Bot [@Bot…]` makes only the tagged bots leave
  (each one reacts 👋). `!kick @media-team` (a role) makes every bot holding that role leave, and `!join @role` brings
  them back (2026-10-31); a kick is checked before the roll call, so the role tag in it does not pull them back in. Joined threads are saved in
  `<state dir>/joined.json`, so they survive restarts.
- **`!!summon @Bot [@Bot…] [topic]`** or plain **`summon @Bot`** (Nat 2026-10-30), tag before or after: a trusted human calls bots into a conversation. In a thread, each
  tagged bot joins it (hears everything there without a tag until `!leave` / `!kick`). In a room, the tagged bots share one
  thread named after them, never after the message (Nat 2026-10-31): each bot's server name as a slug, so `@Phd Oracle` →
  `phd-oracle` and two bots → `neo-oracle + nexus-oracle`. If the room already has an unlocked thread with that name
  (the oracle's own thread in #oracles), it is reused and unarchived, and the first tagged bot replies with a link to it;
  otherwise the thread opens on the message. The bots join it, adding only the human who summoned. Each joined bot reacts 👋 and says it is here. Untagged bots
  (the host too) ignore it. Only in `summonRooms` (access-defaults: #oracles and its threads); elsewhere the bot reacts 🚫.
- **`!!setup`** (Nat 2026-11-01): a trusted human (global `allowFrom`) types exactly `!!setup` in a text channel of a new
  server, and the host (`host: true`) checks that server against our rules. It opens (or reuses) a thread named `config`
  on the message, adds the author, creates `#townhall` and `#oracles` if the server has none (reports `missing` when it
  lacks Manage Channels), and lays out `#oracles` like Laris Co's: for every bot in its member cache whose name ends with
  "Oracle" (the host too) a thread named `<slug>` ("ESP32 Oracle" -> `esp32-oracle`), reused when one of that name is
  there (active or archived; locked ones skipped), else made on a "**<Bot> Oracle: command thread**" starter like
  `just online` writes, with only trusted humans (global `allowFrom`) added. It then posts one report there: host ok, how many ids are in `allowFrom`, whether `oracles/<server-slug>-oracle/
  config.yaml` exists ("CMMC Avengers" -> `cmmc-avengers-oracle`), which `roleCall` roles exist in the server, the bots it
  can see in its member cache and which have Administrator, and its own Manage Channels / Manage Threads / Send Messages
  in Threads, and an **Oracles room** section: `<slug>: thread <id> (created|reused)` and under each the terminal line
  that gives that bot its thread, `just guild-setup <slug> <guild id> --thread <id>`, or a note that laris-team has no
  `oracles/<slug>/config.yaml` for it. It ends with the terminal command and reacts ⚙️ (posts over 1900 chars are split). The check runs before the gate, so it works in a server
  with no policy yet; only that exact text from a global `allowFrom` id gets through there, and it never reaches Claude.
  It writes no file and changes no access. Other bots and untrusted senders are ignored silently.
- **`just guild-setup <bot> <guild id> [--host] [--thread <id>] [dry]`** is the terminal half: it adds the guild under `access: guilds:` in
  `oracles/<bot>/config.yaml` as a text edit (comments and order kept, a dated `guild-setup` comment on the line), then runs
  `access-sync`. `--host`: `requireMention: false`; without it: `requireMention: true, threadOnMention: false`; both
  `allowFrom: ["@humans"]`. `--thread <id>` adds that thread under `access: groups:` instead (`requireMention: false`,
  `allowFrom: ["@humans"]`, the entry `just online` writes for a Laris Co #oracles thread). An entry that is already
  there is left alone; `dry` prints the diff and writes nothing.
- **Joining a server tells Claude** (Nat 2026-11-01: "when first start add bot it nothing sent to any ai?"). On
  `guildCreate` the plugin sends one channel notification (meta `event: "guild_join"`, `guild_id`, `guild_name`) saying
  whether a policy covers that server, and if not, to type `!!setup` there and run `just guild-setup`. Nothing is posted
  in the server and access is not changed.
- A thread opened by a tag is named after the message text without the tags (`@LarisCo Oracle what is X` → `what is X`).
- Every message reaches Claude with the room's name, `channel="#oracles"`, plus `thread="laris-labs-oracle"` when it comes
  from a thread (2026-10-31). The names are read from the channel objects discord.js already keeps for the gateway
  (renames update them), so there is no API call, no timer and no cache of our own.
- A message that tags someone also carries their names, `mentions="<@111111111111111111>=FireMan Oracle; <@&…>=@media-team"`
  (2026-10-31): every user, role and channel tagged in the text, from what discord.js already parsed out of the message.
  The content keeps the raw `<@id>`, so a bot can still tag back.
- `deny: true` on a group means never listen there, even if the guild default would.
- A thread can be allowed by its own id. This is the earlier hand patch from 2026-10-17 10:40, now folded in.

Without these keys, the plugin behaves exactly like upstream.

## Per-bot access

Each bot still has its own `access.json` in its own state dir (`~/.claude/channels/<name>/`).
`just access-sync <name>` writes it from the repo:

1. `oracles/access-defaults.yaml`: the shared default (Laris Co Ltd: tag gets a thread, Nat allowed)
2. `oracles/<name>/config.yaml` `access:` block: whatever this bot needs that is different
3. `oracles/<name>/access.jsonl`: append-only allow/deny rows

Keep the defaults small and put the differences in each bot's `config.yaml`. Example: a bot that should
hear #media-team without a tag, and never read #บัญชี:

```yaml
access:
  groups:
    "222222222222222222": { requireMention: false }
    "333333333333333333": { deny: true }
```

## Concerns and open questions

- **Plugin updates overwrite the cache.** After an update, `just plugin-patch check` reports UNKNOWN.
  Copy the new upstream into `upstream-<ver>/`, re-apply `laris-co.patch` to it, and commit.
- **One body per bot.** Only the main checkout runs `--channels`. A worktree never connects as the bot.
  If a worktree should get only some of the work, route a thread to it (`maw atlas route` / `team-threads`)
  instead of giving it an `access.json`.
- **Every machine needs the patch.** A bot on white runs white's plugin cache. If it is unpatched, it ignores
  `guilds` and listens only in the rooms listed in `groups`.
- **Threads someone else opened** (by Nat, or by another bot) still need a tag on each message. Should a bot
  keep listening in a thread once it has been tagged there? Not decided.
- **Thread names** are the first 90 characters of the message. That may be too long or too noisy.
- **Who may tag.** The default `allowFrom` is Nat only. Adding teammates is a per-room question.
- **`!here` state is in memory.** A restart or `/mcp` reconnect locks every room. While a room is unlocked,
  every allowed message reaches that bot, so keep the timer short in busy rooms.
- **No token no longer means a failed plugin (fixed in the patch).** Upstream exits when there is no
  `DISCORD_BOT_TOKEN`. Every session without a bot (worktrees, oracles with no bot) then records
  `plugin:discord:discord` as failed in the global `~/.claude/mcp-needs-auth-cache.json`, and for 15
  minutes every new session skips Discord, bots too. The patch makes a token-less session connect as an
  empty server with no tools. Found by Athena.
- **A plugin that fails once stays off for 15 minutes.** Claude Code records the failure in
  `~/.claude/mcp-needs-auth-cache.json` and skips `plugin:discord:discord` until it expires. If a bot is
  silent after a restart, delete that entry (or run `/mcp` and reconnect) before you look elsewhere.
  Found by Athena.
- **Token resets: verify before use.** After a reset, the token read from the page is not always the newest
  one. Check it with `GET /users/@me` (`maw atlas whoami`) before you launch the body.
- **Bots ignore bots** (upstream rule). Oracles cannot tag each other into a thread over Discord. They use
  `maw hey` / herdr for that.
- **Untyped access.** The patch reads `ownerId` and `guildId` off the channel at runtime. It builds with
  `bun build`, but nobody has type-checked it with `tsc`.
- **`!ears off` / `!ears on`**: a trusted human (global `allowFrom`) switches a bot's
  listening in one room or thread **on this machine**, at once, with no restart. `off` writes
  `{ "deny": true, "earsOff": true }` for that room into `access.local.json` (atomic, mode 600, other keys kept), and the
  bot reacts 🙉. `on` removes the deny only where `earsOff` marks it, and drops the entry when it is empty; the bot reacts
  👂, or 🚫 when the room stays closed by the terminal. Chat can only lower listening below what the terminal gave, never
  raise it: a `deny` written by hand survives `!ears on`. ⚠️ means the file could not be written
  (a broken `access.local.json` is never overwritten).
  - Who acts: tag bots or roles (`@SomeBot !ears off`, `@some-role !ears off`) and only those act. Untagged,
    `off` reaches only the bots that would have received that very untagged message: a joined thread, or a live policy
    that admits the sender and needs no tag (`requireMention: false`, a thread the bot opened, or a room unlocked with
    `!here`). A bot that only answers tags (most bots in #general, through the guild default) ignores an untagged
    `!ears off`; tag it instead. Untagged `on` reaches every bot whose ears entry is there.
  - The room is the channel the message is in: in a thread, `off` silences only that thread. Off in a room also closes
    its threads, joined ones and roll calls included: while a room or its parent has `earsOff`, the gate drops
    everything there except `!ears on`. So `!ears on` typed inside such a thread lifts the parent room's ears entry
    too (and the thread's own, if it has one): the room and its threads hear again.
  - It is handled before the gate, so a deaf bot still hears `!ears on`, and it never reaches Claude. Untrusted senders
    are ignored silently. Static mode (`DISCORD_ACCESS_MODE=static`) never reads `access.local.json`: the bot reacts ⚠️.
  - `bun tests/ears-test.ts` checks the file logic on a scratch dir (it runs the `ears:begin`…`ears:end` block of `server.ts`).

## Oraclep-World additions

- **`/merge issue:<N>`** (Pleam 12 Nov 2026, `plugins/discord/oraclep/merge.ts`): in a house's room, shows the caller only
  the helper PR for issue N (`helper.sh plan N`: title, commit, size) with **Merge ✓ / Cancel**. Merge ✓ writes a one-time
  approval file to `~/.claude/channels/approvals/<id>.json` (repo, issue, PR, exact commit, time) and runs
  `helper.sh finish N --sha <commit> --approved-by-button <id>`; helper.sh checks the file (≤ 5 min, same commit) and
  renames it to `.used` before merging. Answered by the plugin, never forwarded to Claude. Only allowFrom can type it,
  and only the person who typed it can press it. Register the command once per guild (POST, not PUT — PUT replaces all):
  `{"name":"merge","description":"Merge a helper's PR (plan first)","options":[{"type":4,"name":"issue","description":"issue number","required":true,"autocomplete":true}]}`
- Limit: a guard-rail, not a lock — the house's own gh account can still merge. A lock needs branch protection.
