// Oraclep-World patch (Pleam 2026-11-12 14:16 "เอาปุ่มในห้องแบบพี่นัท"): /merge issue:<N> in the house's room.
// Same shape as Nat's /archive and /done: the plan comes from the CLI (`helper.sh plan N`), only the caller sees it,
// with Merge ✓ / Cancel. Merge ✓ writes a one-time approval file (repo, issue, PR, exact commit, time) and runs
// `helper.sh finish N --sha <commit> --approved-by-button <id>`; helper.sh checks the file and uses it up.
// Why not the DM Allow button (v1): it checked that an ask rule exists, not that this run hit it, so
// `bash /abs/path/helper.sh` merged with no press (ferris 12 Nov 13:3x). Here the press itself makes the approval.
// Honest limit (ferris 14:1x): the house's gh account can merge anyway — this is a guard-rail for a careless AI,
// not a lock against one that means to merge. A lock needs branch protection (paid plan or public repos).
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'

export type MergePlan = { issue: number; repo: string; number: number; state: string; isDraft: boolean; headRefOid: string;
  title: string; url: string; additions: number; deletions: number; changedFiles: number }
export const mergePlans = new Map<string, { plan: MergePlan; at: number }>()   // by user id: one pending /merge per person

const HELPER = () => process.env.HELPER_SH || join(homedir(), '.claude', 'skills', 'helper', 'helper.sh')
const APPROVALS = () => process.env.HELPER_APPROVALS_DIR || join(homedir(), '.claude', 'channels', 'approvals')
const PLAN_TTL = 5 * 60_000   // the approval file has the same 5 min limit in helper.sh

// The house = the cwd of the claude this plugin runs under (the plugin's own cwd is the plugin folder).
// helper.sh finds the house the same way, so both sides agree on which house is merging.
export function houseDir(): string | undefined {
  let p = process.pid
  while (p > 1) {
    try {
      const a = readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0')[0] ?? ''
      if (basename(a) === 'claude') return readlinkSync(`/proc/${p}/cwd`)
      p = Number(/^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0)
    } catch { return undefined }
  }
  return undefined
}

function run(args: string[], ms: number): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    const cwd = houseDir()
    if (!cwd) { resolve({ code: 1, out: '', err: 'no claude above this plugin: cannot tell which house this is' }); return }
    let out = '', err = ''
    const p = spawn('bash', [HELPER(), ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const t = setTimeout(() => { err += `\nstop: took longer than ${ms / 1000} s`; p.kill() }, ms)
    p.stdout.on('data', d => { out += String(d) }); p.stderr.on('data', d => { err += String(d) })
    p.on('close', code => { clearTimeout(t); resolve({ code: code ?? 1, out, err }) })
    p.on('error', e => { clearTimeout(t); resolve({ code: 1, out, err: String(e) }) })
  })
}

// autocomplete: this house's open helpers (`helper.sh list` lines "#N  branch  PR #x STATE")
export async function mergeChoices(typed: string): Promise<{ name: string; value: number }[]> {
  const r = await run(['list'], 2500)
  return r.out.split('\n').map(l => /^#(\d+)\s+(\S+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m)
    .filter(m => !typed || m[0].toLowerCase().includes(typed)).slice(0, 25)
    .map(m => ({ name: `#${m[1]} · ${m[3]} · ${m[2]}`.slice(0, 100), value: Number(m[1]) }))
}

export async function mergeMake(issue: number): Promise<{ plan?: MergePlan; error?: string }> {
  const r = await run(['plan', String(issue)], 30000)
  if (r.code !== 0) return { error: (r.err || r.out).trim().slice(0, 1500) || 'helper.sh plan failed' }
  try { return { plan: JSON.parse(r.out.trim().split('\n').pop()!) } } catch { return { error: `cannot read the plan: ${r.out.slice(0, 500)}` } }
}

export function mergeView(p: MergePlan): any {
  const open = p.state === 'OPEN'
  const lines = [
    `**Merge ${p.repo} PR #${p.number}?** (only you see this)`,
    `${p.title}`,
    `issue #${p.issue} · commit \`${p.headRefOid.slice(0, 8)}\` · +${p.additions} −${p.deletions} in ${p.changedFiles} file(s)${p.isDraft ? ' · draft' : ''}`,
    `<${p.url}>`,
    open ? 'Merge ✓ merges exactly this commit. If the PR changes before you press, nothing is merged.' : `⚠️ this PR is ${p.state}: nothing to merge`,
  ]
  const buttons: any[] = open ? [{ type: 2, style: 3, custom_id: 'merge:go', label: `Merge ✓ ${p.headRefOid.slice(0, 7)}` }] : []
  buttons.push({ type: 2, style: 2, custom_id: 'merge:no', label: 'Cancel' })
  return { content: lines.join('\n'), components: [{ type: 1, components: buttons }] }
}

// Merge ✓: the approval is written here, by the plugin, after the press — then helper.sh checks it and uses it up.
export async function mergeGo(p: MergePlan, at: number, userId: string): Promise<{ ok: boolean; text: string }> {
  if (Date.now() - at > PLAN_TTL) return { ok: false, text: 'This /merge is older than 5 min: type it again.' }
  const id = randomBytes(16).toString('hex')
  try {
    mkdirSync(APPROVALS(), { recursive: true, mode: 0o700 })
    writeFileSync(join(APPROVALS(), `${id}.json`), JSON.stringify({ repo: p.repo, issue: p.issue, pr: p.number, sha: p.headRefOid,
      by: userId, at: Math.floor(Date.now() / 1000) }) + '\n', { mode: 0o600, flag: 'wx' })
  } catch (e) { return { ok: false, text: `cannot write the approval: ${e}` } }
  const r = await run(['finish', String(p.issue), '--sha', p.headRefOid, '--approved-by-button', id], 240000)
  return { ok: r.code === 0, text: (r.out + (r.err ? '\n' + r.err : '')).trim().slice(0, 1700) || `exit ${r.code}` }
}
