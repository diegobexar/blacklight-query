import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { parseUrlList, readInput } from '../src/input';

describe('parseUrlList', () => {
    test('skips blank lines and # comments, keeps http(s) URLs in order', () => {
        const text = '# sites\n\nhttps://example.com\n   \n  http://example.org/path?q=1  \n# done\n';
        expect(parseUrlList(text)).toEqual({
            urls: ['https://example.com', 'http://example.org/path?q=1'],
            invalid: [],
        });
    });

    test('handles CRLF, CR and a byte-order mark', () => {
        const text = '﻿https://example.com\r\nhttps://example.org\rhttps://example.net';
        expect(parseUrlList(text).urls).toEqual(['https://example.com', 'https://example.org', 'https://example.net']);
    });

    test('reports invalid lines with their line numbers instead of throwing', () => {
        const text = 'https://example.com\nexample.org\nftp://example.net/file\nhttps://example.org';
        const { urls, invalid } = parseUrlList(text);
        expect(urls).toEqual(['https://example.com', 'https://example.org']);
        expect(invalid).toEqual([
            { line: 2, text: 'example.org', reason: 'not an absolute URL' },
            { line: 3, text: 'ftp://example.net/file', reason: 'unsupported protocol ftp:' },
        ]);
    });

    test('returns nothing for an empty or comment-only list', () => {
        expect(parseUrlList('')).toEqual({ urls: [], invalid: [] });
        expect(parseUrlList('# nothing yet\n\n')).toEqual({ urls: [], invalid: [] });
    });
});

describe('readInput', () => {
    test('resolves relative paths and hashes the raw bytes', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-input-'));
        try {
            fs.writeFileSync(path.join(dir, 'list'), 'https://example.com\n');
            const input = await readInput('list', dir);
            expect(input.path).toBe(path.join(dir, 'list'));
            expect(input.text).toBe('https://example.com\n');
            // sha256 of "https://example.com\n"
            expect(input.sha256).toBe('65cdccbca9388a68023519f997367783be69ed42864398cac568e56f65ce0e75');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('"-" reads the whole stdin stream', async () => {
        const stdin = Readable.from([Buffer.from('https://example.com\n'), Buffer.from('https://example.org\n')]);
        const input = await readInput('-', '/unused', stdin);
        expect(input.path).toBe('-');
        expect(input.text).toBe('https://example.com\nhttps://example.org\n');
    });
});
