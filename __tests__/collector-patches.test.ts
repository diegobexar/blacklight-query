// Tests for the fixes in patches/@themarkup+blacklight-collector+*.patch.
// They import the collector's built files, which is the code that actually
// runs, so each test fails if `patch-package` hasn't been applied.
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

const { generateReport } = require('@themarkup/blacklight-collector/build/parser');
const { getCanvasFontFingerprinters } = require('@themarkup/blacklight-collector/build/canvas-fingerprinting');
const { collect } = require('@themarkup/blacklight-collector');
import { desktopDevice, bundledChromeVersion } from '../src/devices';

/** Serves `page` at / and records every request. */
async function startServer(page: string) {
    const requests: http.IncomingMessage[] = [];
    const server = http.createServer((req, res) => {
        requests.push(req);
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(req.url === '/' ? page : '');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { server, requests, url: `http://127.0.0.1:${port}/` };
}

describe('google_analytics_events report', () => {
    const trackingRequest = (url: string) => ({
        message: { type: 'TrackingRequest', url, data: { query: {} }, stack: [] },
    });

    test('leaves doubleclick requests in third_party_trackers', () => {
        const gaUrl = 'https://stats.g.doubleclick.net/g/collect?v=2&tid=G-TEST000&cid=1';
        const otherUrl = 'https://tracker.example.org/pixel.gif';
        const messages = [trackingRequest(gaUrl), trackingRequest(otherUrl)];

        // Same order as the collector's default blTests: GA runs first, and
        // both reports read the same message objects.
        const ga = generateReport('google_analytics_events', messages, '', 'example.com');
        const trackers = generateReport('third_party_trackers', messages, '', 'example.com');

        expect(ga).toHaveLength(1);
        expect(ga[0].raw).toBe(gaUrl);
        expect(ga[0]).not.toHaveProperty('url');
        expect(trackers.map((e: { url: string }) => e.url)).toEqual([gaUrl, otherUrl]);
    });
});

describe('canvas_font_fingerprinters', () => {
    test('counts every matching font, not every other one', () => {
        // 60 distinct fonts from one script; the threshold is 50.
        const script = 'https://fp.example.org/fp.js';
        const calls = Array.from({ length: 60 }, (_, i) => ({
            data: { symbol: 'CanvasRenderingContext2D.font', value: `${10 + i}px Font${i}`, operation: 'set' },
            stack: [{ fileName: script }],
        }));

        const result = getCanvasFontFingerprinters(calls);

        expect(result.canvas_font[script]).toHaveLength(60);
    });

    const measureCalls = (script: string, text: string, n: number) =>
        Array.from({ length: n }, () => ({
            data: { symbol: 'CanvasRenderingContext2D.measureText', arguments: [text], operation: 'call' },
            stack: [{ fileName: script }],
        }));

    test('counts measureText calls per text, without NaN for later texts', () => {
        const script = 'https://fp.example.org/fp.js';
        const calls = [...measureCalls(script, 'mmmmmmmmmmlli', 60), ...measureCalls(script, 'abc', 3)];

        const result = getCanvasFontFingerprinters(calls);

        expect(result.text_measure[script]).toEqual({ mmmmmmmmmmlli: 60, abc: 3 });
    });

    test('keeps only scripts that measured one text at least 50 times', () => {
        const fingerprinter = 'https://fp.example.org/fp.js';
        const layout = 'https://cdn.example.com/layout.js';
        const calls = [...measureCalls(fingerprinter, 'mmmmmmmmmmlli', 50), ...measureCalls(layout, 'Hello', 49)];

        const result = getCanvasFontFingerprinters(calls);

        expect(Object.keys(result.text_measure)).toEqual([fingerprinter]);
    });

    test('handles a script that measures a very large number of distinct texts', () => {
        const script = 'https://cdn.example.com/layout.js';
        const calls = Array.from({ length: 200000 }, (_, i) => ({
            data: { symbol: 'CanvasRenderingContext2D.measureText', arguments: [`word${i}`], operation: 'call' },
            stack: [{ fileName: script }],
        }));
        expect(getCanvasFontFingerprinters(calls).text_measure).toEqual({});
    });
});

describe('collect() against a local page', () => {
    const WAIT_MS = 3000;
    const LATE_REQUEST_DELAY_MS = 1500;
    const page = `<!doctype html><html><head><title>fixture</title></head>
<body style="height:4000px">
<script>
  // Fires once the collector's autoScroll starts, then requests /late later.
  addEventListener('scroll', () => setTimeout(() => fetch('/late'), ${LATE_REQUEST_DELAY_MS}), { once: true });
</script>
</body></html>`;

    let server: http.Server;
    let requests: http.IncomingMessage[];
    let outDir: string;
    let inspection: any;
    const firstAttemptTimers: unknown[] = [];
    const clearedTimers = new Set<unknown>();

    beforeAll(async () => {
        let url: string;
        ({ server, requests, url } = await startServer(page));
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-collect-'));

        // spyOn calls through to the real timers.
        const setSpy = jest.spyOn(global, 'setTimeout');
        const clearSpy = jest.spyOn(global, 'clearTimeout');
        try {
            await collect(url, {
                outDir,
                numPages: 0,
                headless: true,
                saveScreenshots: false,
                postLoadWaitMs: WAIT_MS,
            });
            // Read before mockRestore(), which resets mock.calls.
            setSpy.mock.calls.forEach(([, ms], i) => {
                if (ms === 10000) firstAttemptTimers.push(setSpy.mock.results[i].value);
            });
            clearSpy.mock.calls.forEach(([handle]) => clearedTimers.add(handle));
        } finally {
            setSpy.mockRestore();
            clearSpy.mockRestore();
        }
        inspection = JSON.parse(fs.readFileSync(path.join(outDir, 'inspection.json'), 'utf8'));
    }, 90000);

    afterAll(() => {
        server?.close();
        if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
    });

    test('clears the 10 s first-navigation timer once navigation settles', () => {
        expect(firstAttemptTimers.length).toBeGreaterThan(0);
        for (const timer of firstAttemptTimers) {
            expect(clearedTimers.has(timer)).toBe(true);
        }
    });

    test('postLoadWaitMs keeps the page open after autoScroll', () => {
        expect(requests.some(r => r.url === '/late')).toBe(true);
        expect(inspection.config.postLoadWaitMs).toBe(WAIT_MS);
    });
});

describe('collect() device emulation', () => {
    test('a rejected emulation fails the scan', async () => {
        const { server, url } = await startServer('<!doctype html><title>fixture</title>');
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-emulate-'));
        try {
            const badDevice = { userAgent: 'test', viewport: { width: -1, height: 900 } };
            await expect(
                collect(url, { outDir, numPages: 0, saveScreenshots: false, emulateDevice: badDevice }),
            ).rejects.toThrow();
        } finally {
            server.close();
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    }, 60000);

    test('desktop: user agent, navigator.platform and Sec-CH-UA-Platform agree', async () => {
        const report = `<!doctype html><title>fixture</title><script>
  fetch('/report?' + new URLSearchParams({ platform: navigator.platform, ch: navigator.userAgentData?.platform ?? '' }));
</script>`;
        const { server, requests, url } = await startServer(report);
        const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-desktop-'));
        const device = desktopDevice(bundledChromeVersion);
        try {
            await collect(url, { outDir, numPages: 0, saveScreenshots: false, emulateDevice: device });
        } finally {
            server.close();
            fs.rmSync(outDir, { recursive: true, force: true });
        }

        const first = requests.find(r => r.url === '/')!;
        expect(first.headers['user-agent']).toBe(device.userAgent);
        const chPlatform = device.userAgentMetadata!.platform;
        expect(first.headers['sec-ch-ua-platform']).toBe(`"${chPlatform}"`);

        const reported = new URL(requests.find(r => r.url!.startsWith('/report'))!.url!, url).searchParams;
        expect(reported.get('ch')).toBe(chPlatform);
        // navigator.platform can't be emulated; the user agent has to follow it.
        const uaTokenFor: [RegExp, string][] = [[/^Mac/, 'Macintosh'], [/^Win/, 'Windows'], [/^Linux/, 'Linux']];
        const token = uaTokenFor.find(([re]) => re.test(reported.get('platform')!))![1];
        expect(device.userAgent).toContain(token);
    }, 60000);
});
