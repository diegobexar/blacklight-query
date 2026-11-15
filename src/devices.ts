import { createRequire } from "module";
import { dirname, resolve } from "path";
import type { Device, Protocol } from "puppeteer";
import type { DeviceName } from "./options";

// Use the puppeteer the collector itself depends on, so device presets and
// version info always match the browser it launches.
const collectorPackageJson = require.resolve("@themarkup/blacklight-collector/package.json");
const collectorRequire = createRequire(collectorPackageJson);
const puppeteer = collectorRequire("puppeteer") as typeof import("puppeteer");

/** This repo's root folder. */
export const repoDir = resolve(__dirname, "..");
export const collectorDir = dirname(collectorPackageJson);
export const collectorVersion: string = collectorRequire("./package.json").version;
export const puppeteerVersion: string = collectorRequire("puppeteer/package.json").version;

/**
 * Chrome for Testing build that puppeteer downloads and the collector runs.
 * PUPPETEER_REVISIONS is exported at runtime but missing from the type declarations.
 */
export const bundledChromeVersion: string = (puppeteer as unknown as { PUPPETEER_REVISIONS: { chrome: string } })
  .PUPPETEER_REVISIONS.chrome;

/** Host platforms with a desktop preset, and how Chrome describes each. */
const DESKTOP_OS = {
  darwin: { uaToken: "Macintosh; Intel Mac OS X 10_15_7", platform: "macOS" },
  win32: { uaToken: "Windows NT 10.0; Win64; x64", platform: "Windows" },
  linux: { uaToken: "X11; Linux x86_64", platform: "Linux" },
} as const;

/**
 * Chrome's reduced desktop user agent (minor versions frozen at 0.0.0) for the
 * host OS, so it agrees with navigator.platform, which emulation can't change.
 */
export function desktopUserAgent(chromeVersion: string, hostPlatform: string = process.platform): string {
  const major = chromeVersion.split(".")[0];
  return `Mozilla/5.0 (${desktopOs(hostPlatform).uaToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

function desktopOs(hostPlatform: string) {
  const os = DESKTOP_OS[hostPlatform as keyof typeof DESKTOP_OS];
  if (!os) throw new Error(`--device desktop supports macOS, Windows and Linux hosts, not ${hostPlatform}`);
  return os;
}

/**
 * A puppeteer Device plus the `name` that KnownDevices entries carry, and
 * optional client-hint metadata (applied by the collector patch).
 */
export type NamedDevice = Device & { name: string; userAgentMetadata?: Protocol.Emulation.UserAgentMetadata };

/**
 * 1440x900 desktop Chrome on the host OS. The client-hint metadata makes
 * Chrome send Sec-CH-UA-* headers that match the user agent; without it Chrome
 * sends none once the user agent is overridden.
 */
export function desktopDevice(
  chromeVersion: string,
  hostPlatform: string = process.platform,
  hostArch: string = process.arch,
): NamedDevice {
  const major = chromeVersion.split(".")[0];
  return {
    // Not a puppeteer KnownDevice; named here so inspection.json says what was used.
    name: "Desktop 1440x900",
    userAgent: desktopUserAgent(chromeVersion, hostPlatform),
    viewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true,
    },
    userAgentMetadata: {
      brands: [
        { brand: "Not)A;Brand", version: "99" },
        { brand: "Google Chrome", version: major },
        { brand: "Chromium", version: major },
      ],
      fullVersionList: [
        { brand: "Not)A;Brand", version: "99.0.0.0" },
        { brand: "Google Chrome", version: chromeVersion },
        { brand: "Chromium", version: chromeVersion },
      ],
      fullVersion: chromeVersion,
      platform: desktopOs(hostPlatform).platform,
      // High-entropy hint; left empty rather than guessing the OS release.
      platformVersion: "",
      architecture: hostArch === "arm64" ? "arm" : "x86",
      bitness: "64",
      model: "",
      mobile: false,
      wow64: false,
    },
  };
}

/** The collector's own default device, passed explicitly so it's recorded. */
export const MOBILE: NamedDevice = { name: "iPhone 13 Mini", ...puppeteer.KnownDevices["iPhone 13 Mini"] };

export function deviceFor(name: DeviceName): NamedDevice {
  return name === "desktop" ? desktopDevice(bundledChromeVersion) : MOBILE;
}
