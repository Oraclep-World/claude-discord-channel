// laris-co patch (Nat 2026-11-08 "we should have archive to handle this", "build both"): /archive in a repo room.
// The plan comes from the CLI (`maw soul archive <repo> --dry`, laris-co/soul-in-repo soul-archive.sh), only the caller
// sees it, with Archive ✓ (or Unarchive ✓ in an archived room). The run is detached; the script posts its own line.
import { spawn } from 'child_process'
import { openSync } from 'fs'
import { join } from 'path'
import { STATE_DIR } from '../server.ts'

export const archivePlans = new Map<string, { repo: string; un: boolean }>()   // by user id

export function archiveDry(repo: string, un: boolean): Promise<{ ok: boolean; text: string }> {
  return new Promise(resolve => {
    let out = ''
    const p = spawn('bash', ['-lc', 'maw soul archive "$@" 2>&1', 'archive', repo, ...(un ? ['--unarchive'] : []), '--dry'],
      { stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => { out += '\nstop: the plan took longer than 45 s'; p.kill() }, 45000)
    p.stdout.on('data', d => { out += String(d) }); p.stderr.on('data', d => { out += String(d) })
    p.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, text: out.split('\n')
      .filter(l => !/^plan only\./.test(l) && !/^\s+maw soul archive .*--yes$/.test(l)).join('\n').trim() }) })
    p.on('error', e => { clearTimeout(timer); resolve({ ok: false, text: `cannot run maw: ${e}` }) })
  })
}

export function archiveView(repo: string, un: boolean, plan: { ok: boolean; text: string }): any {
  const buttons: any[] = plan.ok ? [{ type: 2, style: un ? 3 : 4, custom_id: 'archive:go', label: un ? 'Unarchive ✓' : 'Archive ✓' }] : []
  buttons.push({ type: 2, style: 2, custom_id: 'archive:no', label: 'Cancel' })
  return { content: [`**${un ? 'Unarchive' : 'Archive'} ${repo}?** (only you see this)`, '```', plan.text.slice(0, 1700), '```'].join('\n'),
    components: [{ type: 1, components: buttons }] }
}

export function archiveStart(repo: string, un: boolean, who: string): boolean {
  try {
    const out = openSync(join(STATE_DIR, 'archive.log'), 'a')
    spawn('bash', ['-lc', 'maw soul archive "$@"', 'archive', repo, ...(un ? ['--unarchive'] : []), `--by=${who.replace(/[^\w.-]/g, '').slice(0, 40) || 'someone'}`, '--yes'],
      { detached: true, stdio: ['ignore', out, out] }).unref()
    return true
  } catch (e) { process.stderr.write(`discord: archive start failed: ${e}\n`); return false }
}
