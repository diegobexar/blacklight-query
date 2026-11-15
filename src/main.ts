import * as fs from "fs";
import * as progress from "ts-progress";
import { join, resolve } from "path";
import { collect } from "@themarkup/blacklight-collector";
import { deviceFor, repoDir } from "./devices";
import { parseUrlList, readInput } from "./input";
import { readToolVersions, RunMetadata } from "./metadata";
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

  const source = resolveInputSource(options.input, Boolean(process.stdin.isTTY));
  if (!source) fail(USAGE);

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

  for (let run = 1; run <= options.runs; run++) {
    const runDir = runDirs[run - 1];
    console.log(`Run ${run} of ${options.runs}: ${urls.length} URLs, ${options.device}, writing to ${runDir}`);
    fs.mkdirSync(runDir, { recursive: true });

    // Written at the start and updated as the run goes, so an interrupted run
    // still records how it was made and which URLs failed.
    const metadata: RunMetadata = {
      device: options.device,
      emulateDevice,
      run,
      runs: options.runs,
      startedAt: new Date(),
      endedAt: null,
      location: options.location,
      waitMs: options.wait,
      input: { path: input.path, sha256: input.sha256, urls: urls.length, invalid },
      results: null,
      versions,
    };
    const runJson = join(runDir, "run.json");
    const failuresJson = join(runDir, "failures.json");
    writeJson(runJson, metadata);
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
      const failure = await collectWithRetry(url, config, collect);
      if (failure) {
        failures.push(failure);
        writeJson(failuresJson, failures);
      }
      progressBar.update();
    }

    metadata.endedAt = new Date();
    metadata.results = { scanned: urls.length - failures.length, failed: failures.length };
    writeJson(runJson, metadata);

    reportFailures(failures.map(f => f.url), urls.length);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
