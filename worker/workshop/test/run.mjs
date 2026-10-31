// Runs every *.test.mjs in this directory in its own process and exits non-zero if any suite fails.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const suites = readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const suite of suites) {
    const res = spawnSync(process.execPath, [here + suite], { encoding: 'utf8' });
    const out = res.stdout || '';
    const line = (out.match(/RESULT: .*/) || ['RESULT: crashed'])[0];
    if (res.status !== 0) {
        failed++;
        process.stdout.write(out + (res.stderr || ''));
    }
    console.log(`${res.status === 0 ? 'ok  ' : 'FAIL'}  ${suite.padEnd(28)} ${line}`);
}

console.log(`\n${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed === 0 ? 0 : 1);
