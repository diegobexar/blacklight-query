// Checks that the installed collector carries the patch in patches/.
// `postinstall` runs this file after patch-package succeeds, to record which
// patch was applied; startup compares that record with patches/.
import { createHash } from "crypto";
import * as fs from "fs";
import { join } from "path";
import { collectorDir, repoDir } from "./devices";
import { writeJson } from "./utils";

/**
 * The marker line that patches/@themarkup+blacklight-collector+*.patch adds to
 * each patched file. It shows the files are patched at all. It doesn't need
 * bumping when the patch changes: checkCollectorPatch compares the patch
 * file's hash with the one recorded at install time.
 */
export const PATCH_MARKER = "blacklight-query-patch:1";
export const PATCHED_FILES = ["build/collector.js", "build/parser.js", "build/canvas-fingerprinting.js"];

/** Written into the collector's own folder, so reinstalling the collector removes it. */
export const STAMP_FILE = ".blacklight-query-patch.json";

export interface CollectorPatch {
  file: string;
  sha256: string;
}

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

/** The collector patch in `<repoDir>/patches`, and its SHA-256. */
export function collectorPatch(repoDir: string): CollectorPatch {
  const patchDir = join(repoDir, "patches");
  const file = fs.readdirSync(patchDir).find(f => f.startsWith("@themarkup+blacklight-collector+"));
  if (!file) throw new Error(`No @themarkup+blacklight-collector+*.patch in ${patchDir}`);
  const sha256 = createHash("sha256").update(fs.readFileSync(join(patchDir, file))).digest("hex");
  return { file, sha256 };
}

/** Writes the current patch's name and hash into the collector folder. */
export function recordCollectorPatch(repoDir: string, collectorDir: string): CollectorPatch {
  const patch = collectorPatch(repoDir);
  writeJson(join(collectorDir, STAMP_FILE), patch);
  return patch;
}

/** The patch recorded at install time, or null when there is no stamp. Throws if the stamp is unreadable. */
export function readCollectorPatchStamp(collectorDir: string): CollectorPatch | null {
  const path = join(collectorDir, STAMP_FILE);
  if (!fs.existsSync(path)) return null;
  const text = fs.readFileSync(path, "utf8");
  let stamp: { file?: unknown; sha256?: unknown } | null = null;
  try {
    stamp = JSON.parse(text);
  } catch {}
  if (typeof stamp?.file !== "string" || typeof stamp?.sha256 !== "string") throw new Error(`${path} is not a valid stamp`);
  return { file: stamp.file, sha256: stamp.sha256 };
}

export type CollectorPatchCheck = { patch: CollectorPatch } | { problem: string };

/**
 * Checks that the installed collector matches patches/: every patched file
 * carries PATCH_MARKER, and the patch recorded by `postinstall` is the one in
 * patches/ now. Returns the verified patch, or why the check failed.
 */
export function checkCollectorPatch(dir: string = collectorDir, root: string = repoDir): CollectorPatchCheck {
  const unpatched = unpatchedCollectorFiles(dir);
  if (unpatched.length) {
    return { problem: `The Blacklight Collector patch is not applied (no "${PATCH_MARKER}" in ${unpatched.join(", ")}).` };
  }
  let installed: CollectorPatch | null;
  let current: CollectorPatch;
  try {
    installed = readCollectorPatchStamp(dir);
    current = collectorPatch(root);
  } catch (err) {
    return { problem: `Could not check the collector patch: ${(err as Error).message}` };
  }
  if (!installed) {
    return { problem: `There is no record of which collector patch was applied (${join(dir, STAMP_FILE)}).` };
  }
  if (installed.file !== current.file || installed.sha256 !== current.sha256) {
    return {
      problem:
        `The applied collector patch (${installed.file}, sha256 ${installed.sha256.slice(0, 12)}) is not the one in ` +
        `patches/ (${current.file}, sha256 ${current.sha256.slice(0, 12)}): the patch changed since the collector was installed.`,
    };
  }
  return { patch: current };
}

if (require.main === module) {
  const { file, sha256 } = recordCollectorPatch(repoDir, collectorDir);
  console.log(`Recorded ${file} (sha256 ${sha256.slice(0, 12)}) in ${join(collectorDir, STAMP_FILE)}`);
}
