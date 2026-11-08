// laris-co: repo room features split out of server.ts (Nat 2026-11-08 "can we make multiple files? or modules?").
// Board, new-thread welcome, /close /status /office /lean, the /soul picker helpers. installRooms() wires the events.
import { spawn, spawnSync } from 'child_process'
import { existsSync, openSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { buildIds } from './ids.ts'
import { client, findGroupPolicy, loadAccess, STATE_DIR, wtStart, wtThreads, type Access } from '../server.ts'

// laris-co patch (Nat 2026-11-08 "list help ... active should like kanban? not too much?" -> "gogogo" "both"):
// ONE board message in 📋・board (STATE_DIR/board.json {channel, message}), edited 5 s after any thread opens, closes or
// is renamed. One line per repo room: office open/closed, soul threads (icons), worktree threads, other threads.
// every oracle with a config (digger-oracle lives in Soul-Brews-Studio, so soulOracles() misses it)
export function iconOracles(): string[] {
  const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
  try { return readdirSync(join(team, 'oracles')).filter(n => n.endsWith('-oracle')) } catch { return [] }
}
let boardTimer: any = null
export function boardKick(): void { clearTimeout(boardTimer); boardTimer = setTimeout(() => { void boardUpdate() }, 5000) }
export async function boardUpdate(): Promise<void> {
  let cfg: any
  try { cfg = JSON.parse(readFileSync(join(STATE_DIR, 'board.json'), 'utf8')) } catch { return }
  const access = loadAccess()
  const bch: any = await client.channels.fetch(cfg.channel).catch(() => null)
  if (!bch?.guild) return
  const act: any = await bch.guild.channels.fetchActiveThreads().catch(() => null)
  const threads: any[] = act ? [...act.threads.values()] : []
  const rooms = Object.entries(access.groups ?? {}).filter(([, g]: any) => g?.repo && !g.deny && !g.archived)   // /archive: off the board
  const lines: string[] = []
  for (const [id, g] of rooms as any) {
    const room: any = bch.guild.channels.cache.get(id)
    if (!room || room.parentId !== bch.parentId) continue
    const ts = threads.filter(t => t.parentId === id)
    const office = ts.some(t => String(t.name).toLowerCase() === 'office')
    const souls = ts.filter(t => iconOracles().some(o => { const i = soulIcon(o); return i && String(t.name).startsWith(i) }))
    const wts = wtThreads(access, g.repo).filter(x => ts.some(t => t.id === x.thread))
    const other = ts.length - souls.length - wts.length - (office ? 1 : 0)
    const icon = String(room.name).split('・')[0]
    lines.push(`${icon} <#${id}>  ${office ? '🟢 office' : '⚪ office closed'}` +
      (souls.length ? ` · ${souls.map(t => String(t.name).split('・')[0]).join('')}` : '') +
      (wts.length ? ` · ${wts.length} wt` : '') + (other > 0 ? ` · ${other} thread${other > 1 ? 's' : ''}` : ''))
  }
  const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
  const body = [`📋 **board** · updated ${now} · \`/help\` for commands`, '', ...lines].join('\n').slice(0, 1990)
  const msg: any = await bch.messages.fetch(cfg.message).catch(() => null)
  if (msg) await msg.edit({ content: body, allowedMentions: { parse: [] } }).catch(() => {})
  await buildIds(bch.guild).catch(() => {})   // the id map is rebuilt at the same moment as the board
}
export function installRooms(): void {
  client.on('threadUpdate', () => boardKick())
  client.on('threadDelete', () => boardKick())
  client.once('ready', () => boardKick())
  client.on('threadCreate', onThreadCreate)
}

// laris-co patch (Nat 2026-11-08: "if not wt it should like welcome Laris Labs Oracle and Somsri (gm) and can have
// specific that set to dustboy"): a NEW thread in a repo room that is not a worktree, not a soul thread and not office
// gets a welcome line and its crew (tools/thread-welcome.ts). Waits 8 s first: /wt and /soul write their own rows right
// after creating a thread, and a thread that already has a row anywhere is left alone.
export async function onThreadCreate(t: any, isNew: boolean): Promise<void> {
  boardKick()
  if (!isNew || !t?.parentId) return
  const first = loadAccess()
  if (!first.host) return
  const room = (first.groups as any)?.[t.parentId]
  if (!room?.repo || !/^[\w.-]+\/[\w.-]+$/.test(room.repo)) return
  await new Promise(r => setTimeout(r, 8000))
  const access = loadAccess()
  const name = String(t.name ?? '')
  if (name.toLowerCase() === 'office' || (access.groups as any)?.[t.id]) return
  if (wtThreads(access, room.repo).some(x => x.thread === t.id)) return
  if (soulOracles().some(o => { const i = soulIcon(o); return i && name.startsWith(i) })) return
  const soul = typeof room.defaultSoul === 'string' && /^[a-z0-9-]+-oracle$/.test(room.defaultSoul) ? room.defaultSoul : ''
  await t.send(soul ? `👋 here: ${soulIcon(soul)} ${soul} (room default, every line) · Somsri 🪷 (gm, tag) · Laris Labs Oracle 🏮 (tag)`
    : `👋 here: Somsri 🪷 (gm, every line) · Laris Labs Oracle 🏮 (tag me)`).catch(() => {})
  const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
  try {
    const out = openSync(join(STATE_DIR, 'welcome.log'), 'a')
    spawn('bun', [join(team, 'tools', 'thread-welcome.ts'), t.id, room.repo, t.parentId, ...(soul ? [soul] : [])],
      { detached: true, stdio: ['ignore', out, out] }).unref()
  } catch (e) { process.stderr.write(`discord channel: thread-welcome failed: ${e}\n`) }
}


// laris-co patch (Nat 2026-11-08): what /close would do in this channel.
export function closeKind(access: Access, ch: any): { refuse?: string; what?: string; wt?: string; soul?: string; repo?: string } {
  if (!ch?.isThread?.()) return { refuse: '/close works inside a thread (rooms are never closed)' }
  if (String(ch.name).toLowerCase() === 'office') return { refuse: 'the office thread stays open' }
  // a thread's own row (forward / tag-only) has no repo: take it from the parent room row
  const repo = ((findGroupPolicy(access, ch) as any)?.repo ?? (access.groups as any)?.[ch.parentId]?.repo) as string | undefined
  const wt = repo ? wtThreads(access, repo).find(x => x.thread === ch.id)?.name : undefined
  if (wt) return { wt, repo, what: `Worktree \`${wt}\`: unlink + archive (the worktree stays on disk)` }
  const soul = repo ? soulOracles().find(o => { const i = soulIcon(o); return i && String(ch.name).startsWith(i) }) : undefined
  if (soul) return { soul, repo, what: `${soulIcon(soul)} ${soul}: soul out (ears rm, icon off), then archive` }
  return { what: 'Plain thread: archive' }
}

// laris-co patch (Nat 2026-11-08): /close in a room, /status. Picked thread ids per user, until Close or Cancel.
export const closePicked = new Map<string, string[]>()
export async function roomThreads(room: any): Promise<any[]> {
  if (!room?.guild) return []
  const act: any = await room.guild.channels.fetchActiveThreads().catch(() => null)
  return act ? [...act.threads.values()].filter((t: any) => t.parentId === room.id) : []
}
export function threadLine(access: Access, t: any): { label: string; closable: boolean } {
  const k = closeKind(access, t)
  const ago = t.lastMessageId ? Math.round((Date.now() - Number((BigInt(t.lastMessageId) >> 22n) + 1420070400000n)) / 60000) : -1
  const when = ago < 0 ? '' : ago < 60 ? ` · ${ago}m ago` : ago < 2880 ? ` · ${Math.round(ago / 60)}h ago` : ` · ${Math.round(ago / 1440)}d ago`
  const kind = String(t.name).toLowerCase() === 'office' ? 'office' : k.wt ? `wt ${k.wt}` : k.soul ? `soul ${k.soul}` : 'thread'
  return { label: `${t.name} · ${kind}${when}`, closable: !k.refuse }
}
// Nat 2026-11-08 "not modal ... show as table have a button action": one row per thread (text + a Close button),
// Discord components v2 (Section type 9 with a button accessory, Text Display type 10). Sent over REST: discord.js
// would try to wrap raw rows in action rows. A Close tap closes that thread and redraws the list.
export async function closeRoomList(access: Access, room: any, note = ''): Promise<any> {
  const list = (await roomThreads(room)).map(t => ({ t, l: threadLine(access, t) })).filter(x => x.l.closable).slice(0, 10)
  const head = { type: 10, content: `**Threads in <#${room.id}>**${list.length ? '' : '\nnothing left to close (office never closes)'}${note ? '\n' + note : ''}` }
  const rows = list.map(x => ({ type: 9, components: [{ type: 10, content: `**${x.t.name}**\n-# ${x.l.label.split(' · ').slice(1).join(' · ')}` }],
    accessory: { type: 2, style: 4, label: 'Close', custom_id: `close:one:${x.t.id}` } }))
  // Nat 2026-11-08 "oh what if /close all": a Close all (N) button; it asks once more before closing
  const all = list.length > 1 ? [{ type: 2, style: 4, custom_id: 'close:all', label: `Close all (${list.length})` }] : []
  return { flags: 64 | 32768, components: [head, ...rows, { type: 1, components: [...all,
    { type: 2, style: 2, custom_id: 'close:refresh', label: 'Refresh' }, { type: 2, style: 2, custom_id: 'close:done', label: 'Done' }] }] }
}
export async function interactionCallback(interaction: any, type: number, data: any): Promise<boolean> {
  try { await client.rest.post(`/interactions/${interaction.id}/${interaction.token}/callback`, { body: { type, data }, auth: false }); return true }
  catch (e) { process.stderr.write(`discord channel: interaction callback ${type} refused: ${e}\n`); return false }
}
// Nat 2026-11-08 "can not drop down but radio?": a pop-up form with checkboxes (Discord CheckboxGroup, type 22,
// modal-only and still in preview). Sent through REST because discord.js's ModalBuilder rejects unknown types.
// Returns false when it cannot be shown (more than 10 threads, none, or Discord refuses) so the caller falls back.
export async function closeCheckboxModal(access: Access, room: any, interaction: any): Promise<boolean> {
  const list = (await roomThreads(room)).map(t => ({ t, l: threadLine(access, t) })).filter(x => x.l.closable)
  if (!list.length || list.length > 10) return false
  const data = { custom_id: 'close:modal', title: 'Close threads', components: [{ type: 18, label: 'Tick the threads to close',
    description: 'Submit closes them: wt unlink, soul out, or archive. Nothing is deleted.',
    component: { type: 22, custom_id: 'close:boxes', min_values: 1, max_values: list.length, options: list.map(x => ({
      value: x.t.id, label: String(x.t.name).slice(0, 100), description: x.l.label.split(' · ').slice(1).join(' · ').slice(0, 100) || undefined })) } }] }
  try {
    await client.rest.post(`/interactions/${interaction.id}/${interaction.token}/callback`, { body: { type: 9, data }, auth: false })
    return true
  } catch (e) {
    process.stderr.write(`discord channel: close checkbox modal refused: ${e}\n`)
    return false
  }
}
export async function closeRoomPicker(access: Access, room: any): Promise<any> {
  const list = (await roomThreads(room)).map(t => ({ t, l: threadLine(access, t) })).filter(x => x.l.closable)
  if (!list.length) return { content: 'No open threads to close here (office never closes).', components: [] }
  const opts = list.slice(0, 25).map(x => ({ label: x.l.label.slice(0, 100), value: x.t.id }))
  return { content: `**Close threads in <#${room.id}>** — pick one or more`, components: [
    { type: 1, components: [{ type: 3, custom_id: 'close:pick', placeholder: 'pick threads', min_values: 1, max_values: opts.length, options: opts }] },
    { type: 1, components: [{ type: 2, style: 2, custom_id: 'close:no', label: 'Cancel' }] }] }
}
export async function roomStatus(access: Access, room: any): Promise<any> {
  const repo = (access.groups as any)?.[room?.id]?.repo as string | undefined
  const threads = await roomThreads(room)
  const lines = threads.map(t => `- ${threadLine(access, t).label}`)
  // checkouts on this machine (Nat 2026-11-08 "show full status of machine .... wt ... branch .. path"): tools/room-status.py
  let co = '', stale = 0
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
    const map: Record<string, string> = {}
    for (const t of threads) map[t.id] = t.name
    const r = spawnSync('python3', [join(team, 'tools', 'room-status.py'), repo], { encoding: 'utf8', timeout: 20000,
      env: { ...process.env, THREADS: JSON.stringify(map), ROOM: room.id } })   // ROOM: who-hears-what mapping
    const out = String(r.stdout || '')
    stale = Number(/STALE_COUNT=(\d+)/.exec(out)?.[1] ?? 0)
    co = out.replace(/\nSTALE_COUNT=\d+\s*$/, '').trim()
  }
  const head = `**${repo ? `📦 ${repo}` : `<#${room?.id}>`}** · ${threads.length} open thread(s)`
  // the mapping already lists every thread, so the plain thread lines are only shown when there is no checkout table
  const body = [head, ...(co ? [] : lines), co ? '```\n' + co.slice(0, 1850) + '\n```' : ''].filter(Boolean).join('\n').slice(0, 1990)
  const buttons: any[] = []
  if (threads.length) buttons.push({ type: 2, style: 4, custom_id: 'status:close', label: 'Close…' })
  if (stale) buttons.push({ type: 2, style: 2, custom_id: 'status:tidy', label: `Tidy ${stale} stale` })
  return { content: body, components: buttons.length ? [{ type: 1, components: buttons }] : [] }
}
// laris-co patch (Nat 2026-11-08: "i think it just /office ?" -> "cool!" "go!"): /office toggles the room's office
// thread. Open: the same office thread comes back (or is created, with Somsri every line + Laris tag via
// thread-welcome.ts). Close: a short summary goes to the room (general), then the office is archived. Nothing is deleted.
// Nat 2026-11-08 "but work and office check": an opened office starts with the /work report of its repo (where we are:
// commits, PRs/issues, worktrees + who works there, stale), posted by the CLI in the office thread. Detached.
function officeReport(room: any, thread: string): void {
  const repo = (loadAccess().groups as any)?.[room?.id]?.repo as string | undefined
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return
  try {
    const out = openSync(join(STATE_DIR, 'work.log'), 'a')
    spawn('bash', ['-lc', 'maw soul work "$@"', 'work', repo, `--post=${thread}`, '--yes'], { detached: true, stdio: ['ignore', out, out] }).unref()
  } catch {}
}
export async function officeToggle(room: any, who: string): Promise<string> {
  const active = (await roomThreads(room)).find((t: any) => String(t.name).toLowerCase() === 'office')
  if (active) {
    const msgs: any = await active.messages.fetch({ limit: 100 }).catch(() => null)
    const list = msgs ? [...msgs.values()] : []
    const people = [...new Set(list.map((m: any) => m.member?.displayName ?? m.author?.username).filter(Boolean))]
    const first = list.length ? list[list.length - 1].createdTimestamp : 0
    const hhmm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
    const lines = [`🔒 **office closed** by ${who} · <#${active.id}>`,
      `- ${list.length}${list.length === 100 ? '+' : ''} messages${first ? ` since ${hhmm(first)}` : ''} · ${people.slice(0, 8).join(', ') || 'nobody'}`,
      `- \`/office\` opens it again (same thread, history kept)`]
    await room.send({ content: lines.join('\n'), allowedMentions: { parse: [] } }).catch(() => {})
    await active.setArchived(true, `/office by ${who}`).catch(() => {})
    return `🔒 office closed; summary posted in <#${room.id}>`
  }
  const arch: any = await room.threads.fetchArchived({ type: 'public', limit: 50 }).catch(() => null)
  const old = arch ? [...arch.threads.values()].find((t: any) => String(t.name).toLowerCase() === 'office') : undefined
  if (old) {
    await old.setArchived(false, `/office by ${who}`).catch(() => {})
    await old.send(`🟢 **office open** (by ${who}) · Somsri 🪷 answers every line · souls hear all, answer when tagged · \`/office\` again closes it`).catch(() => {})
    officeReport(room, old.id)
    return `🟢 office reopened: <#${old.id}> (check follows there)`
  }
  const th: any = await room.threads.create({ name: 'office', autoArchiveDuration: 10080, reason: `/office by ${who}` }).catch(() => null)
  if (!th) return '⚠️ could not create the office thread'
  const repo = (loadAccess().groups as any)?.[room.id]?.repo as string | undefined
  const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
  if (repo) {
    const out = openSync(join(STATE_DIR, 'welcome.log'), 'a')
    spawn('bun', [join(team, 'tools', 'thread-welcome.ts'), th.id, repo, room.id], { detached: true, stdio: ['ignore', out, out] }).unref()
  }
  await th.send(`🟢 **office open** (new, by ${who}) · Somsri 🪷 answers every line · Laris on tag · \`/office\` again closes it`).catch(() => {})
  officeReport(room, th.id)
  return `🟢 new office: <#${th.id}> (check follows there)`
}

// laris-co patch (Nat 2026-11-08: "lean to like close as much as we can (detect first)"): /lean shows what it WOULD
// close, then one Lean ✓ button does it. Threads idle > 24 h (closable kinds only), the office idle > 6 h, and
// stale checkouts (tools/room-status.py rule). The plan is re-checked on click.
export const leanPlans = new Map<string, { room: string; threads: string[]; office: boolean; stale: number }>()
export const idleMin = (t: any) => t.lastMessageId ? (Date.now() - Number((BigInt(t.lastMessageId) >> 22n) + 1420070400000n)) / 60000 : 1e9
export async function leanDetect(access: Access, room: any): Promise<{ text: string; threads: string[]; office: boolean; stale: number }> {
  const ts = await roomThreads(room)
  const idle = ts.filter(t => String(t.name).toLowerCase() !== 'office' && !closeKind(access, t).refuse && idleMin(t) > 24 * 60)
  const off = ts.find(t => String(t.name).toLowerCase() === 'office')
  const office = !!off && idleMin(off) > 6 * 60
  const repo = (access.groups as any)?.[room.id]?.repo as string | undefined
  let staleRows: string[] = []
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
    const map: Record<string, string> = {}
    for (const t of ts) map[t.id] = t.name
    const r = spawnSync('python3', [join(team, 'tools', 'room-status.py'), repo], { encoding: 'utf8', timeout: 20000, env: { ...process.env, THREADS: JSON.stringify(map) } })
    // a stale row ENDS with '  STALE' (room-status.py); the summary line STALE_COUNT=N is not a row (2026-11-08: /lean
    // showed 'Stale checkouts (1) · STALE_COUNT=0' and offered Lean ✓ (1) while /status said 0 stale)
    staleRows = String(r.stdout || '').split('\n').filter(l => /\sSTALE\s*$/.test(l)).map(l => l.split(/\s{2,}/)[0])
  }
  const h = (t: any) => { const m = idleMin(t); return m > 2880 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 60)}h` }
  const lines = [`**/lean in <#${room.id}>: detection** (nothing changed yet)`,
    idle.length ? `**Threads idle > 24 h** (${idle.length})\n` + idle.map(t => `- ${t.name} · ${threadLine(access, t).label.split(' · ')[1] ?? ''} · idle ${h(t)}`).join('\n') : '**Threads idle > 24 h**: none',
    off ? (office ? `**Office**: quiet ${h(off)} → close with summary` : `**Office**: active (idle ${h(off)}), stays`) : '**Office**: already closed',
    staleRows.length ? `**Stale checkouts** (${staleRows.length})\n` + staleRows.map(x => `- ${x}`).join('\n') : '**Stale checkouts**: none']
  return { text: lines.join('\n').slice(0, 1900), threads: idle.map(t => t.id), office, stale: staleRows.length }
}

export async function closeThread(access: Access, ch: any, who: string): Promise<string> {
  const kind = closeKind(access, ch)
  if (kind.refuse) return `⚠️ ${kind.refuse}`
  if (kind.wt) {
    // maw soul wt-close unlinks and archives; the result goes to the room (a post in the thread would reopen it)
    await ch.send(`🔒 closed by ${who} with /close: worktree \`${kind.wt}\` unlinked, thread archived (the worktree stays)`).catch(() => {})
    const r = wtStart({ close: true, name: kind.wt }, kind.repo!, ch.parentId, ch.parentId)
    return `${r.emoji} ${r.what}: \`${kind.wt}\``
  }
  if (kind.soul) {
    const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
    const out = openSync(join(STATE_DIR, 'soul.log'), 'a')
    const p = spawn('bash', [join(team, 'tools', 'soul-slash.sh'), 'rm', kind.soul, kind.repo!, ch.id, ch.parentId, ch.id],
      { stdio: ['ignore', out, out] })
    p.on('exit', () => { void ch.send(`🔒 closed by ${who} with /close: ${kind.soul} out, thread archived`).catch(() => {})
      .finally(() => ch.setArchived(true, `/close by ${who}`).catch(() => {})) })
    return `📤 taking ${kind.soul} out, then archiving`
  }
  await ch.send(`🔒 closed by ${who} with /close (archived; one message brings it back)`).catch(() => {})
  await ch.setArchived(true, `/close by ${who}`).catch(() => {})
  return '🔒 archived'
}

// laris-co patch (Nat 2026-11-08): helpers for the bare /soul picker.
export function soulIcon(o: string): string {
  const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
  try {
    const m = /^icon:\s*"([^"]*)"/m.exec(readFileSync(join(team, 'oracles', o, 'config.yaml'), 'utf8'))
    return m ? m[1].replace(/\\U([0-9A-Fa-f]{8})/g, (_, h) => String.fromCodePoint(parseInt(h, 16))) : ''
  } catch { return '' }
}
export function soulOracles(): string[] {
  const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
  const ghq = process.env.GHQ_ROOT || '/opt/Code'
  try { return readdirSync(join(team, 'oracles')).filter(n => n.endsWith('-oracle')
    && existsSync(join(ghq, 'github.com', 'laris-co', n, 'CLAUDE.md'))).sort() } catch { return [] }
}
export function soulPicker(repo: string, inThread: boolean, name: string | undefined, picked?: string): any {
  const names = soulOracles()
  const here = inThread ? names.filter(o => { const i = soulIcon(o); return i && name?.startsWith(i) }) : []
  const lines = [
    inThread ? `**Thread:** ${name}` : `**Room:** ${repo} (not a thread: Add brings the soul in with its own thread)`,
    inThread ? `**Soul here:** ${here.length ? here.map(o => `${soulIcon(o)} ${o}`).join(', ') : 'none (plain = worktree or office)'}` : '',
    picked ? `**Picked:** ${soulIcon(picked)} ${picked}` : 'Pick an oracle, then Add or Remove.',
  ].filter(Boolean)
  const select = { type: 3, custom_id: 'soul:pick', placeholder: 'pick an oracle', options: names.slice(0, 25).map(o => ({
    label: `${soulIcon(o)} ${o}`.trim().slice(0, 100), value: o, default: o === picked })) }
  const buttons: any[] = []
  if (picked) {
    buttons.push({ type: 2, style: 3, custom_id: `soul:add:${picked}`, label: 'Add' })
    if (inThread) buttons.push({ type: 2, style: 4, custom_id: `soul:rm:${picked}`, label: 'Remove' })
  }
  buttons.push({ type: 2, style: 2, custom_id: 'soul:ls', label: 'List all' })
  return { content: lines.join('\n'), components: [{ type: 1, components: [select] }, { type: 1, components: buttons }] }
}

