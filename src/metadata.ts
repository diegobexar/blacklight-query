import { execFileSync } from "child_process";
import * as fs from "fs";
import { join } from "path";
import { bundledChromeVersion, collectorDir, collectorVersion, NamedDevice, puppeteerVersion, repoDir } from "./devices";
import type { InvalidLine } from "./input";
import type { DeviceName } from "./options";

/** Bytes read from the top of each blocklist; the header is in the first lines. */
const BLOCKLIST_HEADER_BYTES = 4096;

/** Reads `! Version:` and `! Last modified:` from an Adblock Plus list header. */
export function parseBlocklistHeader(text: string): { version: string | null; lastModified: string | null } {
  const field = (name: string) => text.match(new RegExp(`^!\\s*${name}:\\s*(.+?)\\s*$`, "mi"))?.[1] ?? null;
  return { version: field("Version"), lastModified: field("Last modified") };
}

/** Parses the header of a blocklist file, reading only its first few KB. */
export function readBlocklistHeader(path: string) {
  const fd = fs.openSync(path, "r");
  try {
    const buf = Buffer.alloc(BLOCKLIST_HEADER_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    return parseBlocklistHeader(buf.toString("utf8", 0, bytesRead));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Must match the marker line that patches/@themarkup+blacklight-collector+*.patch
 * adds to each patched file. Bump both together when the patch changes, so a
 * checkout with an older patch applied is caught.
 */
export const PATCH_MARKER = "blacklight-query-patch:1";
export const PATCHED_FILES = ["build/collector.js", "build/parser.js", "build/canvas-fingerprinting.js"];

/** Patched collector files that don't carry exactly PATCH_MARKER. Empty when fully patched. */
export function unpatchedCollectorFiles(dir: string = collectorDir): string[] {
  // Whole marker only, so ":1" doesn't match a file patched with ":12".
  const marker = new RegExp(`^// ${PATCH_MARKER}(?!\\d)`, "m");
  return PATCHED_FILES.filter(file => {
    try {
      return !marker.test(fs.readFileSync(join(dir, file), "utf8"));
    } catch {
      return true;
    }
  });
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export interface GitState {
  sha: string | null;
  /** True when tracked files are modified or untracked, non-ignored files exist. */
  dirty: boolean | null;
}

/**
 * The checkout's commit, and whether it has local changes. Nulls unless `dir`
 * is the repo root, so a copy inside some other repository doesn't record
 * that repository's commit.
 */
export function gitState(dir: string = repoDir): GitState {
  const top = git(dir, ["rev-parse", "--show-toplevel"]);
  if (!top || fs.realpathSync(top) !== fs.realpathSync(dir)) return { sha: null, dirty: null };
  const status = git(dir, ["status", "--porcelain"]);
  return { sha: git(dir, ["rev-parse", "HEAD"]), dirty: status === null ? null : status.length > 0 };
}

export interface ToolVersions {
  collector: string;
  puppeteer: string;
  /**
   * The Chromium build puppeteer downloads. The browser a scan actually used
   * is in each inspection.json as `browser.version`; they differ when
   * PUPPETEER_EXECUTABLE_PATH points somewhere else.
   */
  bundledChromium: string;
  /** PUPPETEER_EXECUTABLE_PATH, when set. */
  executablePath: string | null;
  easylist: ReturnType<typeof parseBlocklistHeader>;
  easyprivacy: ReturnType<typeof parseBlocklistHeader>;
  git: GitState;
}

/** Versions of everything that affects scan results. Read once per invocation. */
export function readToolVersions(): ToolVersions {
  const blocklist = (file: string) => readBlocklistHeader(join(collectorDir, "data", "blocklists", file));
  return {
    collector: collectorVersion,
    puppeteer: puppeteerVersion,
    bundledChromium: bundledChromeVersion,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    easylist: blocklist("easylist.txt"),
    easyprivacy: blocklist("easyprivacy.txt"),
    git: gitState(),
  };
}

/** The contents of `run.json`. Written when a run starts and updated as it goes. */
export interface RunMetadata {
  device: DeviceName;
  emulateDevice: NamedDevice;
  userAgent: string;
  run: number;
  runs: number;
  startedAt: Date;
  /** null while the run is in progress. */
  endedAt: Date | null;
  /** True when the run was stopped by SIGINT or SIGTERM. */
  interrupted: boolean;
  /** When interrupted: the signal, and the URL being scanned at the time. */
  signal?: string;
  urlInProgress?: string | null;
  location: string | null;
  waitMs: number;
  input: { path: string; sha256: string; urls: number; invalid: InvalidLine[] };
  /** Counts so far, updated after each URL; final once endedAt is set. */
  results: { scanned: number; failed: number };
  /** The collector patch was verified at startup (the tool refuses to scan otherwise). */
  patched: true;
  versions: ToolVersions;
}
