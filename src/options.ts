import { parseArgs } from "node:util";

export const DEVICES = ["mobile", "desktop"] as const;
export type DeviceName = (typeof DEVICES)[number];

export interface CliOptions {
  /** URL list path, `-` for stdin, or null when none was given. */
  input: string | null;
  device: DeviceName;
  runs: number;
  /** Base output folder; each run is written to `<out>/r<n>/`. */
  out: string | null;
  location: string | null;
  /** Extra wait in ms after the page has loaded and scrolled. */
  wait: number;
  help: boolean;
}

export const USAGE = `Usage: blacklight-query [options] [urls.txt | -]

Scans each URL in the list with Blacklight Collector. With no file argument,
URLs are read from stdin when it's piped; "-" reads stdin explicitly.

Options:
  --device <mobile|desktop>  Device to emulate (default: mobile)
  --runs <n>                 Scan the whole list n times (default: 1)
  --out <dir>                Output folder (default: outputs/<YYYYMMDD-HHMM>-<device>)
  --location <text>          Free-text location recorded with each scan
  --wait <ms>                Extra wait after load and scroll (default: 0)
  -h, --help                 Show this help

Examples:
  blacklight-query urls.txt
  blacklight-query --device desktop --runs 2 urls.txt
  echo "https://example.com" | blacklight-query`;

export class UsageError extends Error {}

/** Longest delay Node's setTimeout supports; larger values fire after 1 ms. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const MAX_RUNS = 1000;

function parseInteger(name: string, value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim()) || Number(value) < min || Number(value) > max) {
    throw new UsageError(`--${name} must be a whole number from ${min} to ${max}, got "${value}"`);
  }
  return Number(value);
}

/** Parses CLI arguments (without the node/script prefix). Throws UsageError. */
export function parseCliArgs(argv: string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        device: { type: "string", default: "mobile" },
        runs: { type: "string", default: "1" },
        out: { type: "string" },
        location: { type: "string" },
        wait: { type: "string", default: "0" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { values, positionals } = parsed;

  if (positionals.length > 1) {
    throw new UsageError(`Expected one URL list, got ${positionals.length}: ${positionals.join(" ")}`);
  }
  const device = values.device as string;
  if (!(DEVICES as readonly string[]).includes(device)) {
    throw new UsageError(`--device must be one of ${DEVICES.join(", ")}, got "${device}"`);
  }
  const location = values.location?.trim();

  return {
    input: positionals[0] ?? null,
    device: device as DeviceName,
    runs: parseInteger("runs", values.runs as string, 1, MAX_RUNS),
    out: values.out?.trim() || null,
    location: location || null,
    wait: parseInteger("wait", values.wait as string, 0, MAX_TIMEOUT_MS),
    help: values.help as boolean,
  };
}

/**
 * Picks where to read URLs from: the file argument if there is one, otherwise
 * stdin when it's piped. Returns null when there's nothing to read (show usage).
 */
export function resolveInputSource(input: string | null, stdinIsTTY: boolean): string | null {
  if (input) return input;
  return stdinIsTTY ? null : "-";
}
