import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MOBILE, bundledChromeVersion, deviceFor, desktopDevice } from '../src/devices';
import { PATCH_MARKER } from '../src/collector-patch';
import { gitState, parseBlocklistHeader, readBlocklistHeader, readToolVersions } from '../src/metadata';

const tmpDirs: string[] = [];
const tmpDir = () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blq-meta-')));
    tmpDirs.push(dir);
    return dir;
};
afterAll(() => tmpDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

describe('devices', () => {
    test('desktop is 1440x900 without touch, for the bundled Chrome major version', () => {
        const desktop = deviceFor('desktop');
        expect(desktop.viewport).toMatchObject({ width: 1440, height: 900, isMobile: false, hasTouch: false });
        const major = bundledChromeVersion.split('.')[0];
        expect(desktop.userAgent).toContain(`Chrome/${major}.0.0.0 `);
        expect(desktop.userAgent).not.toMatch(/Mobile|Headless/);
        expect(desktop.userAgentMetadata).toMatchObject({ fullVersion: bundledChromeVersion, mobile: false });
    });

    test.each([
        ['darwin', 'x64', 'Macintosh; Intel Mac OS X 10_15_7', 'macOS', 'x86'],
        ['darwin', 'arm64', 'Macintosh; Intel Mac OS X 10_15_7', 'macOS', 'arm'],
        ['win32', 'x64', 'Windows NT 10.0; Win64; x64', 'Windows', 'x86'],
        ['linux', 'x64', 'X11; Linux x86_64', 'Linux', 'x86'],
    ])('desktop on %s/%s: user agent and client hints match the host', (platform, arch, uaToken, chPlatform, chArch) => {
        const device = desktopDevice('131.0.6778.85', platform, arch);
        expect(device.userAgent).toBe(
            `Mozilla/5.0 (${uaToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`,
        );
        expect(device.userAgentMetadata).toMatchObject({ platform: chPlatform, architecture: chArch, bitness: '64' });
        expect(device.userAgentMetadata!.brands).toContainEqual({ brand: 'Google Chrome', version: '131' });
    });

    test('desktop on the current host uses the host OS', () => {
        const expected = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform as string];
        expect(deviceFor('desktop').userAgentMetadata!.platform).toBe(expected);
    });

    test('desktop refuses hosts without a preset', () => {
        expect(() => desktopDevice('131.0.6778.85', 'freebsd')).toThrow(/macOS, Windows and Linux/);
    });

    test('mobile is the collector default, iPhone 13 Mini', () => {
        expect(deviceFor('mobile')).toBe(MOBILE);
        expect(MOBILE.name).toBe('iPhone 13 Mini');
        expect(MOBILE.viewport).toMatchObject({ isMobile: true, hasTouch: true });
    });
});

describe('blocklist headers', () => {
    test('reads Version and Last modified', () => {
        const text = '[Adblock Plus 2.0]\n! Version: 202301011200\n! Title: Test list\n! Last modified: 01 Jan 2023 12:00 UTC\n||ads.example^\n';
        expect(parseBlocklistHeader(text)).toEqual({ version: '202301011200', lastModified: '01 Jan 2023 12:00 UTC' });
    });

    test('nulls when the header has no such fields', () => {
        expect(parseBlocklistHeader('||ads.example^\n')).toEqual({ version: null, lastModified: null });
    });

    test('readBlocklistHeader reads only the top of the file', () => {
        const file = path.join(tmpDir(), 'list');
        // A Version line 8 KB down is past the header and must not be read.
        fs.writeFileSync(file, `! Title: Test\n${'||ads.example^\n'.repeat(600)}! Version: 202301011200\n`);
        expect(readBlocklistHeader(file)).toEqual({ version: null, lastModified: null });
        fs.writeFileSync(file, '! Version: 202301011200\n||ads.example^\n');
        expect(readBlocklistHeader(file).version).toBe('202301011200');
    });
});

describe('gitState', () => {
    const git = (dir: string, ...args: string[]) =>
        execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd: dir, stdio: 'ignore' });

    test('counts untracked files as dirty, but not ignored ones', () => {
        const dir = tmpDir();
        git(dir, 'init', '-q');
        fs.writeFileSync(path.join(dir, '.gitignore'), 'outputs/\n');
        git(dir, 'add', '.');
        git(dir, 'commit', '-qm', 'init');
        expect(gitState(dir)).toEqual({ sha: expect.stringMatching(/^[0-9a-f]{40}$/), dirty: false });

        fs.mkdirSync(path.join(dir, 'outputs'));
        fs.writeFileSync(path.join(dir, 'outputs', 'scan.json'), '{}');
        expect(gitState(dir).dirty).toBe(false);

        fs.writeFileSync(path.join(dir, 'notes.md'), 'local change');
        expect(gitState(dir).dirty).toBe(true);
    });

    test('nulls when the folder is inside another repo, not its root', () => {
        const dir = tmpDir();
        git(dir, 'init', '-q');
        fs.mkdirSync(path.join(dir, 'vendored'));
        expect(gitState(path.join(dir, 'vendored'))).toEqual({ sha: null, dirty: null });
    });
});

describe('readToolVersions', () => {
    // The patch checkCollectorPatch verified (see patch-check.test.ts).
    const patch = { file: '@themarkup+blacklight-collector+3.11.0.patch', sha256: 'abc123' };

    test('reports collector, puppeteer, Chromium, blocklist and git versions', () => {
        const v = readToolVersions(patch);
        expect(v.collector).toBe('3.11.0');
        expect(v.collectorPatch).toEqual({ marker: PATCH_MARKER, ...patch });
        expect(v.puppeteer).toMatch(/^\d+\.\d+\.\d+/);
        expect(v.bundledChromium).toBe(bundledChromeVersion);
        expect(v.bundledChromium).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        expect(v.easylist.version).toMatch(/^\d{12}$/);
        expect(v.easyprivacy.version).toMatch(/^\d{12}$/);
        // Tests run from a git checkout.
        expect(v.git.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(typeof v.git.dirty).toBe('boolean');
    });

    test('records PUPPETEER_EXECUTABLE_PATH when set', () => {
        const saved = process.env.PUPPETEER_EXECUTABLE_PATH;
        try {
            delete process.env.PUPPETEER_EXECUTABLE_PATH;
            expect(readToolVersions(patch).executablePath).toBeNull();
            process.env.PUPPETEER_EXECUTABLE_PATH = '/opt/chrome/chrome';
            expect(readToolVersions(patch).executablePath).toBe('/opt/chrome/chrome');
        } finally {
            if (saved === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
            else process.env.PUPPETEER_EXECUTABLE_PATH = saved;
        }
    });
});
