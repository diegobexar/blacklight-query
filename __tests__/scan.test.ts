import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectWithRetry, defaultOutDir, urlFolderName } from '../src/scan';

describe('defaultOutDir', () => {
    test('outputs/<YYYYMMDD-HHMM>-<device> in local time', () => {
        expect(defaultOutDir('/repo', 'desktop', new Date(2026, 0, 2, 3, 4, 59))).toBe(
            path.join('/repo', 'outputs', '20260102-0304-desktop'),
        );
    });
});

describe('urlFolderName', () => {
    test('hostname, numbered when a host repeats', () => {
        const used = new Set<string>();
        expect(urlFolderName('https://example.com/', used)).toBe('example.com');
        expect(urlFolderName('https://example.com/about', used)).toBe('example.com-2');
        expect(urlFolderName('https://example.org/', used)).toBe('example.org');
        expect(urlFolderName('http://example.com/contact', used)).toBe('example.com-3');
    });
});

describe('collectWithRetry', () => {
    let outDir: string;
    beforeEach(() => {
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-scan-'));
    });
    afterEach(() => {
        fs.rmSync(outDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });
    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));

    test('succeeds on the first attempt without retrying', async () => {
        const collect = jest.fn().mockResolvedValue({ status: 'success' });
        expect(await collectWithRetry('https://example.com', { outDir }, collect)).toBeNull();
        expect(collect).toHaveBeenCalledTimes(1);
    });

    test('retries once after a thrown error', async () => {
        const collect = jest.fn()
            .mockRejectedValueOnce(new Error('Navigation timeout of 35000 ms exceeded'))
            .mockResolvedValueOnce({ status: 'success' });
        expect(await collectWithRetry('https://example.com', { outDir }, collect)).toBeNull();
        expect(collect).toHaveBeenCalledTimes(2);
        expect(fs.existsSync(outDir)).toBe(true);
    });

    test('treats a "failed" status as an error and records the last one', async () => {
        const collect = jest.fn()
            .mockRejectedValueOnce(new Error('net::ERR_NAME_NOT_RESOLVED'))
            .mockResolvedValueOnce({ status: 'failed', page_response: 'Chrome crashed' });
        expect(await collectWithRetry('https://nonexistent.invalid', { outDir }, collect)).toEqual({
            url: 'https://nonexistent.invalid',
            error: 'collector returned status "failed": Chrome crashed',
            attempts: 2,
        });
        expect(collect).toHaveBeenCalledTimes(2);
        expect(fs.existsSync(outDir)).toBe(false);
    });
});
