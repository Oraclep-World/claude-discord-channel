// laris-co: one id map for the guild (Nat 2026-11-08: "we should resolve and create mapping and listable").
// STATE_DIR/ids.json = rooms (categories + channels), open threads, people (access allowFrom), bots (oracles/*/config.yaml
// client_id). Rebuilt with the board (5 s after a thread opens/closes/renames, and on start). /ids lists or finds.
import { readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { client, loadAccess, STATE_DIR } from '../server.ts'

export type IdRow = { kind: 'category' | 'room' | 'thread' | 'person' | 'bot'; id: string; name: string; parent?: string; oracle?: string }

export async function buildIds(guild: any): Promise<IdRow[]> {
  const rows: IdRow[] = []
  for (const c of guild.channels.cache.values()) {
    if (c.type === 4) rows.push({ kind: 'category', id: c.id, name: c.name })
    else if (!c.isThread?.() && [0, 2, 5, 15].includes(c.type)) rows.push({ kind: 'room', id: c.id, name: c.name, parent: c.parentId ?? undefined })
  }
  const act: any = await guild.channels.fetchActiveThreads().catch(() => null)
  for (const t of act ? act.threads.values() : []) rows.push({ kind: 'thread', id: t.id, name: t.name, parent: t.parentId ?? undefined })
  const access = loadAccess()
  for (const uid of new Set(access.allowFrom ?? [])) {
    const u: any = await client.users.fetch(uid).catch(() => null)
    rows.push({ kind: 'person', id: uid, name: u?.globalName || u?.username || '?' })
  }
  const team = process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'
  let names: string[] = []
  try { names = readdirSync(join(team, 'oracles')).filter(n => n.endsWith('-oracle')) } catch {}
  for (const n of names) {
    try {
      const m = /^client_id:\s*"?(\d{17,})"?/m.exec(readFileSync(join(team, 'oracles', n, 'config.yaml'), 'utf8'))
      if (!m) continue
      const u: any = client.users.cache.get(m[1]!) ?? await client.users.fetch(m[1]!).catch(() => null)
      rows.push({ kind: 'bot', id: m[1]!, name: u?.username || n, oracle: n })
    } catch {}
  }
  writeFileSync(join(STATE_DIR, 'ids.json'), JSON.stringify({ built: new Date().toISOString(), rows }, null, 1) + '\n')
  return rows
}

export function readIds(): IdRow[] {
  try { return JSON.parse(readFileSync(join(STATE_DIR, 'ids.json'), 'utf8')).rows ?? [] } catch { return [] }
}

// id -> name, for anything that wants names instead of raw ids
export function idName(id: string): string { return readIds().find(r => r.id === id)?.name ?? id }

export function idsText(find: string): string {
  const rows = readIds()
  if (!rows.length) return 'no id map yet (it builds with the board; try again in a few seconds)'
  const byId = new Map(rows.map(r => [r.id, r]))
  const q = find.trim().toLowerCase()
  const hit = q ? rows.filter(r => r.id.includes(q) || r.name.toLowerCase().includes(q) || (r.oracle ?? '').includes(q)) : rows
  const icon: Record<string, string> = { category: '📁', room: '#', thread: '🧵', person: '👤', bot: '🤖' }
  const order = ['person', 'bot', 'category', 'room', 'thread']
  const lines: string[] = [q ? `**/ids find:${find}** · ${hit.length} match(es)` : `**/ids** · ${rows.length} ids · \`/ids find:<name>\` to search`]
  for (const k of order) {
    const g = hit.filter(r => r.kind === k)
    if (!g.length) continue
    if (!q && (k === 'room' || k === 'thread')) {   // full list is long: rooms/threads only by count unless searched
      lines.push(`${icon[k]} ${k}s: ${g.length}`); continue
    }
    for (const r of g.slice(0, 25)) {
      const p = r.parent ? byId.get(r.parent)?.name : ''
      lines.push(`${icon[k]} \`${r.id}\` ${r.name}${p ? ` · in ${p}` : ''}${r.oracle && r.oracle !== r.name ? ` · ${r.oracle}` : ''}`)
    }
  }
  return lines.join('\n').slice(0, 1950)
}
