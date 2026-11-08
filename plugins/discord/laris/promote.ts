// laris-co patch (Nat 2026-11-08 "so ... make a cli? slash command?" -> "build and merge all please asap"): /promote.
// Typed in a talk thread, it shows the caller (only) the plan from the CLI itself (`maw soul promote <thread> --dry`,
// GETs only), a souls picker and Promote ✓ / Cancel. Promote runs tools/promote-slash.sh detached
// (`maw soul promote ... --yes`): repo + origin/thread.md + room 📦・<owner>∕<repo> + souls, then the thread gets a
// "moved to" line and is archived. The result is posted in the new room. No logic is copied here: the five steps live
// in laris-co/soul-in-repo soul-promote.sh, so /promote and `maw soul promote` always do the same thing.
import { spawn } from 'child_process'
import { openSync } from 'fs'
import { join } from 'path'
import { STATE_DIR, type Access } from '../server.ts'
import { soulIcon, soulOracles } from './rooms.ts'

export type PromotePlan = { thread: string; owner: string; name: string; souls: string[]; plan: string; ok: boolean;
  fresh?: boolean; matches?: string[] }   // matches: existing repos close to the name, waiting for a pick (CLI exit 3)
export const promotePlans = new Map<string, PromotePlan>()   // by user id: one pending /promote per person
// Promote ✓ creates a repo and writes access rows: Nat and catbutter only (the --yes rule), whoever else may see a plan.
export const PROMOTE_GO = ['691531480689541170', '917019242094817301']

const team = () => process.env.LARIS_TEAM_DIR || '/opt/Code/github.com/laris-co/laris-team'

// "ESP32 Beacon" -> esp32-beacon (same rule as the CLI's own slug; the CLI checks it again)
export function promoteName(raw: string): string {
  return raw.trim().toLowerCase().normalize('NFKD').replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '').slice(0, 100)
}

// name: "laris-co/oracle-gods-eys-os" -> owner laris-co + that repo (Nat 2026-11-08 "find god eyes os repo? and how?":
// the repo lives in laris-co, not the CLI's default owner); "ESP32 Beacon" -> the default owner + esp32-beacon
export function promoteTarget(raw: string): { owner: string; name: string } {
  const m = /^\s*([A-Za-z0-9][A-Za-z0-9-]{0,38})\/(.+)$/.exec(raw)
  return m ? { owner: m[1]!, name: promoteName(m[2]!) } : { owner: '', name: promoteName(raw) }
}

// The plan, from the CLI. Async (never spawnSync: a slow GitHub or Discord lookup must not stall the gateway).
// Arguments travel as argv to `bash -lc 'maw soul promote "$@"'`, never spliced into the script.
export function promoteMake(thread: string, owner: string, name: string, souls: string[], fresh = false): Promise<PromotePlan> {
  const args = [thread, ...souls, ...(owner ? [`--owner=${owner}`] : []), ...(name ? [`--name=${name}`] : []), ...(fresh ? ['--new'] : []), '--dry']
  return new Promise(resolve => {
    let out = ''
    const p = spawn('bash', ['-lc', 'maw soul promote "$@" 2>&1', 'promote', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { out += '\nstop: the plan took longer than 45 s'; p.kill() }, 45000)
    p.stdout.on('data', d => { out += String(d) })
    p.stderr.on('data', d => { out += String(d) })
    p.on('close', code => {
      clearTimeout(timer)
      // exit 3 = existing repo(s) close to the name (Nat 2026-11-08 "use existing repo first", "let confirm ?"): pick one
      const matches = code === 3 ? [...out.matchAll(/^MATCH (\S+\/\S+)/gm)].map(m => m[1]!).slice(0, 4) : []
      const plan = out.split('\n').filter(l => !/^plan only\./.test(l) && !/^\s+maw soul promote .*--yes$/.test(l) && !/^confirm: /.test(l)).join('\n').trim()
      resolve({ thread, owner, name, souls, fresh, matches, plan: plan || `maw soul promote exited ${code}`, ok: code === 0 })
    })
    p.on('error', e => { clearTimeout(timer); resolve({ thread, owner, name, souls, fresh, plan: `cannot run maw: ${e}`, ok: false }) })
  })
}

// Souls that already live in a repo room come first (the select holds 25), then every other oracle with a soul repo.
export function promoteChoices(access: Access): string[] {
  const inRooms = new Set<string>()
  for (const g of Object.values(access.groups ?? {}) as any[]) for (const o of (g?.layout === 9 ? g.souls ?? [] : [])) inRooms.add(o)
  const all = soulOracles()
  return [...all.filter(o => inRooms.has(o)), ...all.filter(o => !inRooms.has(o))].slice(0, 25)
}

export function promoteView(access: Access, p: PromotePlan): any {
  const names = promoteChoices(access)
  for (const o of p.souls) if (!names.includes(o)) names.unshift(o)
  const souls = p.souls.length ? p.souls.map(o => `${soulIcon(o)} ${o}`.trim()).join(', ') : 'none (room only: /soul adds them later)'
  if (p.matches?.length) return { content: ['**This thread looks like an existing repo** (only you see this)', '```', p.plan.slice(0, 1400), '```',
    '♻️ pick the repo it belongs to, or ⚠️ make a new one'].join('\n'), components: [{ type: 1, components: [
      ...p.matches.map((m, i) => ({ type: 2, style: i ? 2 : 3, custom_id: `promote:use:${i}`, label: `♻️ ${m}`.slice(0, 80) })),
      { type: 2, style: 4, custom_id: 'promote:new', label: '⚠️ New repo' }] },
      { type: 1, components: [{ type: 2, style: 2, custom_id: 'promote:no', label: 'Cancel' }] }] }
  const content = ['**Promote this thread to a repo?** (only you see this)', '```', p.plan.slice(0, 1450), '```',
    p.ok ? `**Souls:** ${souls}\n-# pick souls below (optional), then Promote ✓. Repo: \`/promote name:<repo>\` or \`name:<owner>/<repo>\``
      : '⚠️ the plan stopped (see above): nothing can run until it is fixed'].join('\n')
  const select = { type: 3, custom_id: 'promote:souls', placeholder: 'souls for the new room (optional)', min_values: 0,
    max_values: Math.min(names.length, 25), options: names.slice(0, 25).map(o => ({
      label: `${soulIcon(o)} ${o}`.trim().slice(0, 100), value: o, default: p.souls.includes(o) })) }
  const buttons: any[] = p.ok ? [{ type: 2, style: 3, custom_id: 'promote:go', label: 'Promote ✓' }] : []
  buttons.push({ type: 2, style: 2, custom_id: 'promote:no', label: 'Cancel' })
  return { content, components: [...(p.ok && names.length ? [{ type: 1, components: [select] }] : []), { type: 1, components: buttons }] }
}

// Detached: the run takes minutes when souls come in (a body per soul). The script posts the result itself.
export function promoteStart(p: PromotePlan, who: string): boolean {
  try {
    const out = openSync(join(STATE_DIR, 'promote.log'), 'a')
    spawn('bash', [join(team(), 'tools', 'promote-slash.sh'), p.thread, p.owner, p.name, who, ...p.souls, ...(p.fresh ? ['--new'] : [])],
      { detached: true, stdio: ['ignore', out, out] }).unref()
    return true
  } catch (e) {
    process.stderr.write(`discord: promote start failed: ${e}\n`)
    return false
  }
}
