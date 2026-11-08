// laris-co patch (Nat 2026-11-08 "it should have like /work for report like /work <github url>", "gogogo"): /work.
// The plan + report come from the CLI (`maw soul work <repo> [souls] --dry`, laris-co/soul-in-repo soul-work.sh), only
// the caller sees them, with a souls picker and Work ✓ (Nat or catbutter). The run is detached; the CLI posts the
// report in the repo's room itself (the room is reused, or made in ⚡ active).
import { spawn } from 'child_process'
import { openSync } from 'fs'
import { join } from 'path'
import { STATE_DIR, type Access } from '../server.ts'
import { promoteChoices } from './promote.ts'
import { soulIcon } from './rooms.ts'

export type WorkPlan = { repo: string; souls: string[]; plan: string; ok: boolean; post?: string }   // post: report goes here
export const workPlans = new Map<string, WorkPlan>()   // by user id

export function workRepo(raw: string): string {
  const r = raw.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '').split('/').slice(0, 2).join('/')
  return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : ''
}

export function workMake(repo: string, souls: string[], post?: string): Promise<WorkPlan> {
  return new Promise(resolve => {
    let out = ''
    const p = spawn('bash', ['-lc', 'maw soul work "$@" 2>&1', 'work', repo, ...souls, '--dry'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { out += '\nstop: the plan took longer than 60 s'; p.kill() }, 60000)
    p.stdout.on('data', d => { out += String(d) }); p.stderr.on('data', d => { out += String(d) })
    p.on('close', code => { clearTimeout(timer); resolve({ repo, souls, post, ok: code === 0, plan: out.split('\n')
      .filter(l => !/^plan only\./.test(l) && !/^\s+maw soul work .*--yes$/.test(l)).join('\n').replace(/```/g, "'''").trim() }) })
    p.on('error', e => { clearTimeout(timer); resolve({ repo, souls, post, ok: false, plan: `cannot run maw: ${e}` }) })
  })
}

export function workView(access: Access, w: WorkPlan): any {
  const names = promoteChoices(access)
  for (const o of w.souls) if (!names.includes(o)) names.unshift(o)
  const select = { type: 3, custom_id: 'work:souls', placeholder: 'souls to bring in (optional)', min_values: 0,
    max_values: Math.min(names.length, 25), options: names.slice(0, 25).map(o => ({ label: `${soulIcon(o)} ${o}`.trim().slice(0, 100), value: o, default: w.souls.includes(o) })) }
  const buttons: any[] = w.ok ? [{ type: 2, style: 3, custom_id: 'work:go', label: 'Work ✓' }] : []
  buttons.push({ type: 2, style: 2, custom_id: 'work:no', label: 'Cancel' })
  return { content: [`**/work ${w.repo}** (only you see this)`, '```', w.plan.slice(0, 1600), '```'].join('\n'),
    components: [...(w.ok ? [{ type: 1, components: [select] }] : []), { type: 1, components: buttons }] }
}

export function workStart(w: WorkPlan): boolean {
  try {
    const out = openSync(join(STATE_DIR, 'work.log'), 'a')
    spawn('bash', ['-lc', 'maw soul work "$@"', 'work', w.repo, ...w.souls, ...(w.post ? [`--post=${w.post}`] : []), '--yes'], { detached: true, stdio: ['ignore', out, out] }).unref()
    return true
  } catch (e) { process.stderr.write(`discord: work start failed: ${e}\n`); return false }
}
