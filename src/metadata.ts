import { execFileSync } from "child_process";
import * as fs from "fs";
import { join } from "path";
import type { Device } from "puppeteer";
import { bundledChromeVersion, collectorDir, collectorVersion, puppeteerVersion, repoDir } from "./devices";
import type { InvalidLine } from "./input";
import type { DeviceName } from "./options";


/**
 * Reads `! Version:` and `! Last modified:` from an Adblock Plus list header.
 * Only the first lines are read; the header sits at the top.
 */
export function parseBlocklistHeader(text: string): { version: string | null; lastModified: string | null } {
  const header = text.slice(0, 2000);
  const field = (name: string) => header.match(new RegExp(`^!\\s*${name}:\\s*(.+?)\\s*$`, "mi"))?.[1] ?? null;
  return { version: field("Version"), lastModified: field("Last modified") };
}

function readBlocklist(file: string) {
  return parseBlocklistHeader(fs.readFileSync(join(collectorDir, "data", "blocklists", file), "utf8"));
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export interface ToolVersions {
  collector: string;
  puppeteer: string;
  chromium: string;
  easylist: ReturnType<typeof parseBlocklistHeader>;
  easyprivacy: ReturnType<typeof parseBlocklistHeader>;
  git: { sha: string | null; dirty: boolean | null };
}

/**
 * This checkout's commit, and whether tracked files have local changes.
 * Nulls unless the tool's own folder is the repo root, so a copy inside some
 * other repository doesn't record that repository's commit.
 */
function gitState(): ToolVersions["git"] {
  const top = git(["rev-parse", "--show-toplevel"]);
  if (!top || fs.realpathSync(top) !== fs.realpathSync(repoDir)) return { sha: null, dirty: null };
  const status = git(["status", "--porcelain", "--untracked-files=no"]);
  return { sha: git(["rev-parse", "HEAD"]), dirty: status === null ? null : status.length > 0 };
}

/** Versions of everything that affects scan results. Read once per invocation. */
export function readToolVersions(): ToolVersions {
  return {
    collector: collectorVersion,
    puppeteer: puppeteerVersion,
    chromium: bundledChromeVersion,
    easylist: readBlocklist("easylist.txt"),
    easyprivacy: readBlocklist("easyprivacy.txt"),
    git: gitState(),
  };
}

/** The contents of `run.json`. Written when a run starts and again when it ends. */
export interface RunMetadata {
  device: DeviceName;
  emulateDevice: Device;
  run: number;
  runs: number;
  startedAt: Date;
  /** null while the run is in progress, or if it was interrupted. */
  endedAt: Date | null;
  location: string | null;
  waitMs: number;
  input: { path: string; sha256: string; urls: number; invalid: InvalidLine[] };
  /** null until the run ends. */
  results: { scanned: number; failed: number } | null;
  versions: ToolVersions;
}
