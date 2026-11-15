import { DESKTOP, MOBILE, bundledChromeVersion, deviceFor, desktopUserAgent } from '../src/devices';
import { parseBlocklistHeader, readToolVersions } from '../src/metadata';

describe('devices', () => {
    test('desktop is 1440x900 without touch, with a UA for the bundled Chrome major version', () => {
        expect(deviceFor('desktop')).toBe(DESKTOP);
        expect(DESKTOP.viewport).toMatchObject({ width: 1440, height: 900, isMobile: false, hasTouch: false });
        const major = bundledChromeVersion.split('.')[0];
        expect(DESKTOP.userAgent).toContain(`Chrome/${major}.0.0.0 `);
        expect(DESKTOP.userAgent).not.toMatch(/Mobile|Headless/);
    });

    test('mobile is the collector default, iPhone 13 Mini', () => {
        expect(deviceFor('mobile')).toBe(MOBILE);
        expect(MOBILE.name).toBe('iPhone 13 Mini');
        expect(MOBILE.viewport).toMatchObject({ isMobile: true, hasTouch: true });
    });

    test('desktopUserAgent uses only the major version', () => {
        expect(desktopUserAgent('131.0.6778.85')).toBe(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        );
    });
});

describe('parseBlocklistHeader', () => {
    test('reads Version and Last modified', () => {
        const text = '[Adblock Plus 2.0]\n! Version: 202301011200\n! Title: Test list\n! Last modified: 01 Jan 2023 12:00 UTC\n||ads.example^\n';
        expect(parseBlocklistHeader(text)).toEqual({ version: '202301011200', lastModified: '01 Jan 2023 12:00 UTC' });
    });

    test('nulls when the header has no such fields', () => {
        expect(parseBlocklistHeader('||ads.example^\n')).toEqual({ version: null, lastModified: null });
    });
});

describe('readToolVersions', () => {
    test('reports collector, puppeteer, Chromium, blocklist and git versions', () => {
        const v = readToolVersions();
        expect(v.collector).toMatch(/^\d+\.\d+\.\d+/);
        expect(v.puppeteer).toMatch(/^\d+\.\d+\.\d+/);
        expect(v.chromium).toBe(bundledChromeVersion);
        expect(v.chromium).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
        expect(v.easylist.version).toMatch(/^\d{12}$/);
        expect(v.easyprivacy.version).toMatch(/^\d{12}$/);
        // Tests run from a git checkout.
        expect(v.git.sha).toMatch(/^[0-9a-f]{40}$/);
        expect(typeof v.git.dirty).toBe('boolean');
    });
});
