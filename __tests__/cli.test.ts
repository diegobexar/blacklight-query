// Runs the real launcher (`./blacklight-query`) as a child process.
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

const launcher = path.join(__dirname, '..', 'blacklight-query');

function start(args: string[]) {
    const child = spawn(launcher, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    child.stdout!.on('data', d => (output.stdout += d));
    child.stderr!.on('data', d => (output.stderr += d));
    const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));
    return { child, output, exited };
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise(r => setTimeout(r, 100));
    }
}

let children: ChildProcess[] = [];
afterEach(() => {
    children.forEach(c => c.exitCode === null && c.kill('SIGKILL'));
    children = [];
});

test('says it is reading stdin while a pipe is open', async () => {
    const { child, output, exited } = start([]);
    children.push(child);
    await waitFor(() => output.stderr.includes('reading URLs from stdin...'), 'the stdin notice');
    child.stdin!.end();
    expect(await exited).toBe(1);
    expect(output.stderr).toContain('No valid URLs found in stdin.');
}, 60000);

test.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
] as const)('%s marks run.json as interrupted and exits %d', async (signal, exitCode) => {
    // A page that never responds, so the scan is in progress when the signal arrives.
    const server = http.createServer(() => {});
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-cli-'));
    const runJson = path.join(out, 'r1', 'run.json');
    try {
        const { child, output, exited } = start(['--out', out, '-']);
        children.push(child);
        // The first URL fails at once (no retry for DNS errors), then the second hangs.
        child.stdin!.end(`https://nonexistent.invalid/\n${url}\n`);
        await waitFor(() => output.stdout.includes(`Scanning ${url}`), 'the second scan to start');
        // Counts are saved after each URL, not only at the end.
        expect(JSON.parse(fs.readFileSync(runJson, 'utf8')).results).toEqual({ scanned: 0, failed: 1 });

        child.kill(signal);

        expect(await exited).toBe(exitCode);
        const run = JSON.parse(fs.readFileSync(runJson, 'utf8'));
        expect(run).toMatchObject({ interrupted: true, signal, urlInProgress: url, patched: true });
        expect(run.endedAt).not.toBeNull();
        // The partial folder of the interrupted URL is removed.
        expect(fs.readdirSync(path.join(out, 'r1')).sort()).toEqual(['failures.json', 'run.json']);
    } finally {
        server.closeAllConnections();
        server.close();
        fs.rmSync(out, { recursive: true, force: true });
    }
}, 60000);
