import * as fs from "fs";
import * as progress from "ts-progress";
import { join, resolve } from "path";
import { collect } from "@themarkup/blacklight-collector";
import { deviceFor, repoDir } from "./devices";
import { parseUrlList, readInput } from "./input";
import { PATCH_MARKER, readToolVersions, RunMetadata, unpatchedCollectorFiles } from "./metadata";
import { parseCliArgs, resolveInputSource, USAGE, UsageError } from "./options";
import { collectWithRetry, defaultOutDir, Failure, urlFolderName } from "./scan";
import { reportFailures } from "./utils";

function writeJson(path: string, data: unknown) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) fail(`${err.message}\n\n${USAGE}`);
    throw err;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  // Scans from an unpatched collector would silently drop trackers and ignore --wait.
  const unpatched = unpatchedCollectorFiles();
  if (unpatched.length) {
    fail(
      `The Blacklight Collector patch is not applied (no "${PATCH_MARKER}" in ${unpatched.join(", ")}).\n` +
        "Run `npm install` to apply patches/, then try again.",
    );
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.warn(
      `PUPPETEER_EXECUTABLE_PATH is set: scans use ${process.env.PUPPETEER_EXECUTABLE_PATH}, not the bundled ` +
        "Chromium recorded in run.json. Each inspection.json records the browser actually used (browser.version).",
    );
  }

  const source = resolveInputSource(options.input, Boolean(process.stdin.isTTY));
  if (!source) fail(USAGE);
  // Makes a pipe that never closes visible instead of a silent hang.
  if (source === "-") console.error("reading URLs from stdin...");

  let input;
  try {
    input = await readInput(source);
  } catch (err) {
    fail(`Could not read ${source}: ${(err as Error).message}`);
  }
  const { urls, invalid } = parseUrlList(input.text);
  for (const bad of invalid) {
    console.warn(`Skipping line ${bad.line} (${bad.reason}): ${bad.text}`);
  }
  if (!urls.length) fail(`No valid URLs found in ${input.path === "-" ? "stdin" : input.path}.`);

  const baseDir = options.out ? resolve(options.out) : defaultOutDir(repoDir, options.device, new Date());
  const runDirs = Array.from({ length: options.runs }, (_, i) => join(baseDir, `r${i + 1}`));
  const existing = runDirs.filter(dir => fs.existsSync(dir));
  if (existing.length) {
    fail(`Refusing to overwrite existing run folder(s): ${existing.join(", ")}\nPass --out to choose another folder.`);
  }

  const emulateDevice = deviceFor(options.device);
  const versions = readToolVersions();

  // On Ctrl-C or kill, mark the current run as interrupted before exiting.
  let current: { metadata: RunMetadata; runJson: string; url: string | null } | null = null;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (current) {
        Object.assign(current.metadata, {
          interrupted: true,
          signal,
          urlInProgress: current.url,
          endedAt: new Date(),
        });
        writeJson(current.runJson, current.metadata);
        console.error(`\nInterrupted by ${signal}; recorded in ${current.runJson}`);
      }
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }

  for (let run = 1; run <= options.runs; run++) {
    const runDir = runDirs[run - 1];
    console.log(`Run ${run} of ${options.runs}: ${urls.length} URLs, ${options.device}, writing to ${runDir}`);
    fs.mkdirSync(runDir, { recursive: true });

    // Written at the start and updated as the run goes, so an interrupted run
    // still records how it was made and which URLs failed.
    const metadata: RunMetadata = {
      device: options.device,
      emulateDevice,
      userAgent: emulateDevice.userAgent,
      run,
      runs: options.runs,
      startedAt: new Date(),
      endedAt: null,
      interrupted: false,
      location: options.location,
      waitMs: options.wait,
      input: { path: input.path, sha256: input.sha256, urls: urls.length, invalid },
      results: { scanned: 0, failed: 0 },
      patched: true,
      versions,
    };
    const runJson = join(runDir, "run.json");
    const failuresJson = join(runDir, "failures.json");
    writeJson(runJson, metadata);
    current = { metadata, runJson, url: null };
    const failures: Failure[] = [];
    writeJson(failuresJson, failures);
    const usedFolders = new Set<string>();
    const progressBar = progress.create({ total: urls.length });

    for (const url of urls) {
      console.log(`Scanning ${url} ...`);
      const config = {
        headless: true,
        outDir: join(runDir, urlFolderName(url, usedFolders)),
        numPages: 0,
        emulateDevice,
        postLoadWaitMs: options.wait,
        location: options.location ?? undefined,
      };
      current.url = url;
      const failure = await collectWithRetry(url, config, collect);
      current.url = null;
      if (failure) {
        failures.push(failure);
        writeJson(failuresJson, failures);
        metadata.results.failed++;
      } else {
        metadata.results.scanned++;
      }
      progressBar.update();
    }

    metadata.endedAt = new Date();
    writeJson(runJson, metadata);
    current = null;

    reportFailures(failures.map(f => f.url), urls.length);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
