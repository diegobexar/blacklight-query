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
    let outDir: string;
    let lateRequestSeen = false;
    let inspection: any;
    const firstAttemptTimers: unknown[] = [];
    const clearedTimers = new Set<unknown>();

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/late') lateRequestSeen = true;
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end(req.url === '/' ? page : '');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blq-collect-'));

        // spyOn calls through to the real timers.
        const setSpy = jest.spyOn(global, 'setTimeout');
        const clearSpy = jest.spyOn(global, 'clearTimeout');
        try {
            await collect(`http://127.0.0.1:${port}/`, {
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
        expect(lateRequestSeen).toBe(true);
        expect(inspection.config.postLoadWaitMs).toBe(WAIT_MS);
    });
});
