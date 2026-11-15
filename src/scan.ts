import * as fs from "fs";
import { join } from "path";

export interface Failure {
  url: string;
  error: string;
  attempts: number;
}

/** `outputs/<YYYYMMDD-HHMM>-<device>`, in local time. */
export function defaultOutDir(root: string, device: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return join(root, "outputs", `${stamp}-${device}`);
}

/**
 * Folder name for one URL's results inside a run folder: its hostname, with
 * `-2`, `-3`… when the list has several URLs on the same host.
 */
export function urlFolderName(url: string, used: Set<string>): string {
  const host = new URL(url).hostname;
  let name = host;
  for (let n = 2; used.has(name); n++) name = `${host}-${n}`;
  used.add(name);
  return name;
}

const MAX_ATTEMPTS = 2;

/**
 * Runs `collect` and retries once on error. The
 * collector reports some failures by returning `status: "failed"` instead of
 * throwing; those count as errors too. On final failure the URL's partial
 * output folder is removed and a Failure is returned.
 */
export async function collectWithRetry<Config extends { outDir: string }>(
  url: string,
  config: Config,
  collect: (url: string, config: Config) => Promise<{ status?: string; page_response?: unknown }>,
): Promise<Failure | null> {
  let error = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await collect(url, config);
      if (result?.status === "success") return null;
      error = `collector returned status "${result?.status}": ${String(result?.page_response ?? "")}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    console.log(`${url} failed (attempt ${attempt} of ${MAX_ATTEMPTS}): ${error}`);
  }
  fs.rmSync(config.outDir, { recursive: true, force: true });
  return { url, error, attempts: MAX_ATTEMPTS };
}
