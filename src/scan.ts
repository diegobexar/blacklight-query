import * as fs from "fs";
import { join } from "path";

/**
 * Why the last attempt failed: `dns` for an unresolvable hostname, `status`
 * when the collector returned a non-success status, `error` for anything else.
 */
export type FailureReason = "dns" | "status" | "error";

export interface Failure {
  url: string;
  error: string;
  attempts: number;
  reason: FailureReason;
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
/** Pause before the retry, so a brief network or server hiccup can clear. */
export const RETRY_DELAY_MS = 5000;
/**
 * Longer pause after a DNS failure: a dead domain fails again either way, but
 * a brief resolver outage needs more time to clear.
 */
export const DNS_RETRY_DELAY_MS = 30_000;
/** Chrome's errors for a name that didn't resolve, or a resolver that failed. */
const DNS_ERROR = /net::ERR_NAME_(NOT_RESOLVED|RESOLUTION_FAILED)/;

/** The collector's `collect`, or a stand-in for tests. */
type Collect<Config> = (url: string, config: Config) => Promise<{ status?: string; page_response?: unknown }>;

/** One collector attempt: null on success, otherwise the error and its reason. */
async function attemptCollect<Config>(
  url: string,
  config: Config,
  collect: Collect<Config>,
): Promise<{ error: string; reason: FailureReason } | null> {
  try {
    const result = await collect(url, config);
    if (result?.status === "success") return null;
    return {
      error: `collector returned status "${result?.status}": ${String(result?.page_response ?? "")}`,
      reason: "status",
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { error, reason: DNS_ERROR.test(error) ? "dns" : "error" };
  }
}

/**
 * Runs `collect`, and retries once if it fails: after DNS_RETRY_DELAY_MS for
 * a DNS failure, RETRY_DELAY_MS otherwise. The collector reports some failures
 * by returning `status: "failed"` instead of throwing; those count as errors
 * too. On final failure the URL's partial output folder is removed and a
 * Failure is returned, with the last attempt's error and reason.
 */
export async function collectWithRetry<Config extends { outDir: string }>(
  url: string,
  config: Config,
  collect: Collect<Config>,
): Promise<Failure | null> {
  for (let attempt = 1; ; attempt++) {
    const failed = await attemptCollect(url, config, collect);
    if (!failed) return null;
    const last = attempt >= MAX_ATTEMPTS;
    const delayMs = failed.reason === "dns" ? DNS_RETRY_DELAY_MS : RETRY_DELAY_MS;
    console.log(
      `${url} failed (attempt ${attempt} of ${MAX_ATTEMPTS}): ${failed.error}` +
        (last ? "" : `; retrying in ${delayMs / 1000} s`),
    );
    if (last) {
      fs.rmSync(config.outDir, { recursive: true, force: true });
      return { url, error: failed.error, attempts: attempt, reason: failed.reason };
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
