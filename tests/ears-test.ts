#!/usr/bin/env bun
// Check the "!ears on|off" logic in plugins/discord/server.ts against a scratch state dir.
// It runs the real code: the block between "// ears:begin" and "// ears:end" is cut out of server.ts, stripped of
// types and evaluated with node:fs. No Discord, no bot, no real access.local.json.
// Run: bun tools/ears-test.ts
import { readFileSync, writeFileSync, mkdirSync, renameSync, mkdtempSync, statSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../plugins/discord/server.ts'), 'utf8')
const block = src.split('// ears:begin')[1]?.split('// ears:end')[0]
if (!block) throw new Error('ears:begin / ears:end markers not found in server.ts')
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(block)
const ears = new Function('readFileSync', 'writeFileSync', 'mkdirSync', 'renameSync',
  `${js}\nreturn { earsCommand, earsRead, earsOffHere, earsHearsUntagged, earsRooms, earsShouldAct, earsApply }`,
)(readFileSync, writeFileSync, mkdirSync, renameSync)

const dir = mkdtempSync(join(tmpdir(), 'ears-test-'))
const file = join(dir, 'access.local.json')
const read = () => JSON.parse(readFileSync(file, 'utf8'))
let failed = 0
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got: ${JSON.stringify(got)}`}`)
  if (!ok) failed++
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const ROOM = '111', TERM = '222', THREAD = '333'

// parsing
check('parse "!ears off"', ears.earsCommand('!ears off') === 'off')
check('parse "<@1> !EARS  On" (tags stripped, any case)', ears.earsCommand('<@123> !EARS  On') === 'on')
check('parse "<@&9> !ears off <@2>"', ears.earsCommand('<@&9> !ears off <@2>') === 'off')
check('no parse "!ears"', ears.earsCommand('!ears') === null)
check('no parse "!ears off please"', ears.earsCommand('!ears off please') === null)

// a terminal-made deny and an unrelated key already in the file
writeFileSync(file, JSON.stringify({ groups: { [TERM]: { deny: true }, [ROOM]: { requireMention: false } }, note: 'keep' }))

// off writes deny + earsOff, keeps the other keys
check('off on ROOM changes the file', ears.earsApply(file, ROOM, 'off') === true)
check('ROOM = requireMention kept + deny + earsOff', eq(read().groups[ROOM], { requireMention: false, deny: true, earsOff: true }), read().groups[ROOM])
check('top-level key kept', read().note === 'keep')
check('file mode 600', (statSync(file).mode & 0o777) === 0o600, (statSync(file).mode & 0o777).toString(8))
check('no tmp file left', !existsSync(`${file}.${process.pid}.tmp`))
check('second off is a no-op', ears.earsApply(file, ROOM, 'off') === false)

// off on a room the terminal denied: left alone, no marker added
check('off on TERM is a no-op', ears.earsApply(file, TERM, 'off') === false)
check('TERM still plain deny (no earsOff)', eq(read().groups[TERM], { deny: true }), read().groups[TERM])

// on removes only ears-made denies
check('on on ROOM changes the file', ears.earsApply(file, ROOM, 'on') === true)
check('ROOM back to its own keys only', eq(read().groups[ROOM], { requireMention: false }), read().groups[ROOM])
check('on on TERM is a no-op', ears.earsApply(file, TERM, 'on') === false)
check('terminal deny survives !ears on', eq(read().groups[TERM], { deny: true }), read().groups[TERM])

// a thread silences only itself; its entry is dropped when empty again
ears.earsApply(file, THREAD, 'off')
check('THREAD gets deny + earsOff', eq(read().groups[THREAD], { deny: true, earsOff: true }))
check('earsOffHere(THREAD)', ears.earsOffHere(file, THREAD) === true)
check('earsOffHere(TERM) is false (terminal deny)', ears.earsOffHere(file, TERM) === false)
ears.earsApply(file, THREAD, 'on')
check('THREAD entry dropped when empty', !(THREAD in read().groups), read().groups)

// who acts
check('tagged, not me: no', ears.earsShouldAct('off', true, false, true, file, ROOM) === false)
check('tagged, me: yes (even if not hearing)', ears.earsShouldAct('off', true, true, false, file, ROOM) === true)
check('untagged off, hears: yes', ears.earsShouldAct('off', false, false, true, file, ROOM) === true)
check('untagged off, deaf: no', ears.earsShouldAct('off', false, false, false, file, TERM) === false)
ears.earsApply(file, ROOM, 'off')
check('untagged on, ears entry: yes', ears.earsShouldAct('on', false, false, false, file, ROOM) === true)
check('untagged on, terminal deny only: no', ears.earsShouldAct('on', false, false, false, file, TERM) === false)
check('untagged on, no entry: no', ears.earsShouldAct('on', false, false, true, file, '999') === false)

// review #90 point 1: untagged off acts only for a bot that would have delivered the untagged message
const NAT = '42', OTHER = '43'
const H = ears.earsHearsUntagged
check('requireMention-only bot (guild default) does not hear untagged', H({ requireMention: true, allowFrom: [] }, NAT, false, false, false) === false)
check('requireMention-only bot ignores untagged !ears off',
  ears.earsShouldAct('off', false, false, H({ requireMention: true, allowFrom: [] }, NAT, false, false, false), file, ROOM) === false)
check('requireMention unset counts as true', H({ allowFrom: [] }, NAT, false, false, false) === false)
check('requireMention:false bot hears untagged', H({ requireMention: false, allowFrom: [] }, NAT, false, false, false) === true)
check('requireMention:false but sender not in room allowFrom: no', H({ requireMention: false, allowFrom: [OTHER] }, NAT, false, false, false) === false)
check('requireMention:false, sender in room allowFrom: yes', H({ requireMention: false, allowFrom: [NAT] }, NAT, false, false, false) === true)
check('requireMention bot, room unlocked with !here: yes', H({ requireMention: true, allowFrom: [] }, NAT, false, false, true) === true)
check('requireMention bot, its own thread: yes', H({ requireMention: true, allowFrom: [] }, NAT, false, true, false) === true)
check('joined thread, no policy: yes', H(undefined, NAT, true, false, false) === true)
check('no policy (denied), not joined: no', H(undefined, NAT, false, false, true) === false)

// review #90 point 2: "!ears on" in a thread under a deaf parent lifts the parent too
const PARENT = '444', KID = '555'
writeFileSync(file, JSON.stringify({ groups: { [TERM]: { deny: true } } }))
ears.earsApply(file, PARENT, 'off')
check('off targets only the room itself', eq(ears.earsRooms('off', file, KID, PARENT), [KID]))
check('on in thread under deaf parent targets the parent', eq(ears.earsRooms('on', file, KID, PARENT), [PARENT]))
check('untagged on in that thread: acts', ears.earsShouldAct('on', false, false, false, file, KID, PARENT) === true)
check('untagged on in a plain thread with no ears anywhere: no', ears.earsShouldAct('on', false, false, false, file, KID, '777') === false)
ears.earsApply(file, KID, 'off')
check('thread and parent both deaf: on targets both', eq(ears.earsRooms('on', file, KID, PARENT), [KID, PARENT]))
for (const r of ears.earsRooms('on', file, KID, PARENT)) ears.earsApply(file, r, 'on')
check('both lifted, terminal deny kept', eq(read(), { groups: { [TERM]: { deny: true } } }), read())
check('on in thread under a TERMINAL-denied parent targets nothing', eq(ears.earsRooms('on', file, KID, TERM), []))
check('untagged on there: no act', ears.earsShouldAct('on', false, false, false, file, KID, TERM) === false)

// a broken file is never overwritten
writeFileSync(file, '{ broken')
let threw = false
try { ears.earsApply(file, ROOM, 'off') } catch { threw = true }
check('broken file: throws (caller reacts ⚠️), file untouched', threw && readFileSync(file, 'utf8') === '{ broken')

// a missing file: off creates it
rmSync(file)
ears.earsApply(file, ROOM, 'off')
check('missing file: off creates it', eq(read(), { groups: { [ROOM]: { deny: true, earsOff: true } } }), read())
ears.earsApply(file, ROOM, 'on')
check('on empties it to {}', eq(read(), {}), read())

rmSync(dir, { recursive: true })
console.log(failed ? `\n${failed} FAILED` : '\nall ok')
process.exit(failed ? 1 : 0)
