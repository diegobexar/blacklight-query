import { createRequire } from "module";
import { dirname, resolve } from "path";
import type { Device } from "puppeteer";
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

/**
 * Chrome's reduced desktop user agent (minor versions frozen at 0.0.0), for
 * the given full Chrome version.
 */
export function desktopUserAgent(chromeVersion: string): string {
  const major = chromeVersion.split(".")[0];
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** A puppeteer Device plus the `name` that KnownDevices entries carry. */
export type NamedDevice = Device & { name: string };

export const DESKTOP: NamedDevice = {
  // Not a puppeteer KnownDevice; named here so inspection.json says what was used.
  name: "Desktop 1440x900",
  userAgent: desktopUserAgent(bundledChromeVersion),
  viewport: {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    isLandscape: true,
  },
};

/** The collector's own default device, passed explicitly so it's recorded. */
export const MOBILE: NamedDevice = { name: "iPhone 13 Mini", ...puppeteer.KnownDevices["iPhone 13 Mini"] };

export function deviceFor(name: DeviceName): NamedDevice {
  return name === "desktop" ? DESKTOP : MOBILE;
}
