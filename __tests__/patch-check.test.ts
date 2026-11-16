import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    PATCHED_FILES,
    PATCH_MARKER,
    STAMP_FILE,
    checkCollectorPatch,
    collectorPatch,
    readCollectorPatchStamp,
    recordCollectorPatch,
    unpatchedCollectorFiles,
} from '../src/collector-patch';

const PATCH_FILE = '@themarkup+blacklight-collector+3.11.0.patch';
const repoDir = path.join(__dirname, '..');

const tmpDirs: string[] = [];
const tmpDir = () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blq-patch-')));
    tmpDirs.push(dir);
    return dir;
};
afterAll(() => tmpDirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

describe('patch markers', () => {
    test('lists files without the marker', () => {
        const dir = tmpDir();
        fs.mkdirSync(path.join(dir, 'build'));
        fs.writeFileSync(path.join(dir, 'build/collector.js'), `// ${PATCH_MARKER}\n`);
        fs.writeFileSync(path.join(dir, 'build/parser.js'), '// blacklight-query-patch:0\n');
        // A longer marker number is a different patch, not a match.
        fs.writeFileSync(path.join(dir, 'build/canvas-fingerprinting.js'), `// ${PATCH_MARKER}2\n`);
        expect(unpatchedCollectorFiles(dir)).toEqual(['build/parser.js', 'build/canvas-fingerprinting.js']);
    });

    test('the patch file adds the marker to every checked file', () => {
        const patch = fs.readFileSync(path.join(repoDir, 'patches', PATCH_FILE), 'utf8');
        for (const file of PATCHED_FILES) {
            const section = patch.split('diff --git ').find(s => s.startsWith(`a/node_modules/@themarkup/blacklight-collector/${file} `));
            expect(section).toContain(`+// ${PATCH_MARKER}`);
        }
    });
});

describe('checkCollectorPatch', () => {
    /** A repo with a patch file, and a collector folder whose files all carry the marker. */
    function fixture() {
        const repo = tmpDir();
        const collector = tmpDir();
        fs.mkdirSync(path.join(repo, 'patches'));
        fs.writeFileSync(path.join(repo, 'patches', PATCH_FILE), 'patch v1\n');
        fs.mkdirSync(path.join(collector, 'build'));
        for (const file of PATCHED_FILES) fs.writeFileSync(path.join(collector, file), `// ${PATCH_MARKER}\n`);
        return { repo, collector };
    }

    const problem = (collector: string, repo: string) => {
        const check = checkCollectorPatch(collector, repo);
        return 'problem' in check ? check.problem : null;
    };

    test('the installed collector matches patches/', () => {
        expect(checkCollectorPatch()).toEqual({ patch: collectorPatch(repoDir) });
    });

    test('recordCollectorPatch stores the patch file name and SHA-256', () => {
        const { repo, collector } = fixture();
        const expected = { file: PATCH_FILE, sha256: createHash('sha256').update('patch v1\n').digest('hex') };
        expect(recordCollectorPatch(repo, collector)).toEqual(expected);
        expect(readCollectorPatchStamp(collector)).toEqual(expected);
    });

    test('refuses without a stamp', () => {
        const { repo, collector } = fixture();
        expect(readCollectorPatchStamp(collector)).toBeNull();
        expect(problem(collector, repo)).toMatch(/no record of which collector patch was applied/);
    });

    test.each([['not json'], ['{"file": "x.patch"}']])('reports an invalid stamp (%s) instead of throwing', text => {
        const { repo, collector } = fixture();
        fs.writeFileSync(path.join(collector, STAMP_FILE), text);
        expect(problem(collector, repo)).toMatch(/Could not check the collector patch: .* is not a valid stamp/);
    });

    test('reports a missing patch file instead of throwing', () => {
        const { repo, collector } = fixture();
        recordCollectorPatch(repo, collector);
        fs.rmSync(path.join(repo, 'patches'), { recursive: true });
        expect(problem(collector, repo)).toMatch(/Could not check the collector patch: .*ENOENT/);
    });

    test('refuses when the patch changed since install', () => {
        const { repo, collector } = fixture();
        const recorded = recordCollectorPatch(repo, collector);
        expect(checkCollectorPatch(collector, repo)).toEqual({ patch: recorded });
        fs.writeFileSync(path.join(repo, 'patches', PATCH_FILE), 'patch v2\n');
        expect(problem(collector, repo)).toMatch(/the patch changed since the collector was installed/);
    });

    test('refuses when a patched file lost its marker, even with a matching stamp', () => {
        const { repo, collector } = fixture();
        recordCollectorPatch(repo, collector);
        fs.writeFileSync(path.join(collector, 'build/parser.js'), '"use strict";\n');
        expect(problem(collector, repo)).toMatch(/not applied \(no ".*" in build\/parser\.js\)/);
    });

    test('collectorPatch fails loudly when there is no patch file', () => {
        const repo = tmpDir();
        fs.mkdirSync(path.join(repo, 'patches'));
        expect(() => collectorPatch(repo)).toThrow(/No @themarkup\+blacklight-collector\+\*\.patch/);
    });
});
