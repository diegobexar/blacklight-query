# Blacklight Query

A command-line tool to fetch [Blacklight](https://themarkup.org/series/blacklight) scans for a list of urls. Directly queries the open-source [Blacklight Collector](https://github.com/the-markup/blacklight-collector) tool and runs entirely locally.

## Prerequisites

- [`nvm`](https://www.linode.com/docs/guides/how-to-install-use-node-version-manager-nvm/)
- [`npm`](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

## Getting Started

- `nvm use`
- `npm install` (this also applies the collector patches; see [Collector patches](#collector-patches))
- `./blacklight-query urls.txt` where `urls.txt` has newline-separated absolute URLs to scan

`npm ci --omit=dev` is enough to run scans, for example on a server. The dev dependencies are only needed for [Testing](#testing).

## Usage

```text
blacklight-query [options] [urls.txt | -]

Options:
  --device <mobile|desktop>  Device to emulate (default: mobile)
  --runs <n>                 Scan the whole list n times (default: 1)
  --out <dir>                Output folder (default: outputs/<YYYYMMDD-HHMM>-<device>)
  --location <text>          Free-text location recorded with each scan
  --wait <ms>                Extra wait after load and scroll (default: 0)
  -h, --help                 Show this help
```

Examples:

- `./blacklight-query urls.txt`
- `./blacklight-query --device desktop --runs 3 urls.txt`
- `./blacklight-query --out scans/2026-test --wait 5000 urls.txt`

### Options in detail

- `--device mobile` emulates an iPhone 13 Mini, the collector's default. `--device desktop` uses a 1440×900 viewport without touch and a standard desktop Chrome user agent for the bundled Chromium's major version and the **host OS** (macOS, Windows or Linux), plus matching client-hint metadata. That way the user agent, `navigator.platform` (which this tool doesn't override) and the `Sec-CH-UA-Platform` header agree. Desktop results therefore depend on the OS the scan runs on. The device used is recorded in each scan's `inspection.json` (`config.emulateDevice`), and the device and user agent are recorded in `run.json`.
- `--runs n` scans the full list `n` times in a row. Each run gets its own folder (`r1/`, `r2/`, …), so repeated runs can be compared.
- `--out dir` sets the base folder. Runs go in `dir/r1/`, `dir/r2/`, and so on. The tool won't write into a run folder that already exists.
- `--location text` is passed to the collector's `location` option, so it appears in each `inspection.json`, and is recorded in `run.json`. It's free text, e.g. where the scan was run from.
- `--wait ms` waits this long after the collector has loaded and scrolled each page and before it collects results, for pages that load trackers late. The default of `0` matches a standard Blacklight scan.

If a scan fails, the URL is retried once after 5 seconds. A DNS failure (`net::ERR_NAME_NOT_RESOLVED` or `net::ERR_NAME_RESOLUTION_FAILED`) is retried after 30 seconds instead, so a brief DNS outage doesn't mark live sites as failed. URLs that still fail are listed in the run's `failures.json`, with the error, the number of attempts and a `reason`: `dns` (DNS failure), `status` (the collector returned a failed status) or `error` (anything else).

Ctrl-C (SIGINT) or SIGTERM stops the scan. The current run's `run.json` is marked `interrupted: true`, with the signal and the URL being scanned. That URL's partial folder is removed, and the tool exits with 130 or 143.

## Inputs

Write all URLs you wish to scan as **absolute URLs** (including protocol, domain, and path). Separate each URL with a newline. Blank lines and lines starting with `#` are ignored.

Lines that aren't `http://` or `https://` URLs are reported and skipped, and are listed in `run.json`. They don't stop the scan.

### Sample `urls.txt` file

```text
# News sites
https://www.themarkup.org
https://www.calmatters.org
```

### You can use pipes

You can also pipe your list of URLs. With no file argument, the list is read from stdin if it's piped; `-` reads stdin explicitly. The tool prints `reading URLs from stdin...` to stderr first, so a pipe that never closes is easy to spot.

- `echo "https://themarkup.org/" | ./blacklight-query`
- `./blacklight-query < urls.txt`
- `./blacklight-query --device desktop - < urls.txt`

A file argument always wins over stdin, so `./blacklight-query urls.txt` also works from scripts and cron, where stdin isn't a terminal.

### Collector Options

Other [`blacklight-collector`](https://github.com/the-markup/blacklight-collector?tab=readme-ov-file#collector-configuration) options can be set by editing the `config` object in `src/main.ts`.

Out of the box, this tool sets the following options:

- `headless: true`, this sets the collector to use a headless, behind-the-scenes browser
- `outDir`, the URL's folder inside the run folder (see [Outputs](#outputs))
- `numPages: 0`, tells the collector not to scan an additional page. Setting this to `1`, `2`, or `3` scans that number of randomly chosen pages that are accessible from the homepage
- `emulateDevice`, from `--device`
- `postLoadWaitMs`, from `--wait` (added by the patches below)
- `location`, from `--location`

Read the [`blacklight-collector` README](https://github.com/the-markup/blacklight-collector/) for a full list of options and their defaults.

## Outputs

```text
outputs/20260102-0930-mobile/     # or the --out folder
  r1/
    run.json                      # how this run was made (see below)
    failures.json                 # URLs that failed: url, error, attempts, reason
    example.com/                  # one folder per scanned URL, named for its hostname
      inspection.json
      requests.har
      ...
    example.com-2/                # a second URL on the same host
  r2/
    ...
```

`run.json` and `failures.json` are written when a run starts and updated after each URL. A run that was killed outright has `endedAt: null` in `run.json`; one stopped by Ctrl-C or SIGTERM has `interrupted: true` (see above). `run.json` records:

- the device name and settings, the user agent, and the run number
- start and end times, whether the run was interrupted, the `--location` text and the `--wait` value
- the input file path (or `-` for stdin), its SHA-256, the URL count and any skipped lines
- how many URLs were scanned and how many failed
- `patched: true`: the collector patch was verified at startup (see [Collector patches](#collector-patches))
- under `versions`:
  - the collector and puppeteer versions, and `collectorPatch`: the patch marker, file name and SHA-256 of the patch that was applied
  - `bundledChromium`, the Chromium build puppeteer downloads. The browser a scan actually used is in each `inspection.json` as `browser.version`. They differ if `PUPPETEER_EXECUTABLE_PATH` is set; the tool warns when it is, and records it as `executablePath`.
  - the EasyList and EasyPrivacy versions from their list headers
  - this repo's git commit, and `dirty: true` if there are local changes or untracked files that aren't gitignored

## Collector patches

`patches/@themarkup+blacklight-collector+3.11.0.patch` is applied by [`patch-package`](https://github.com/ds300/patch-package) (a regular dependency, so the patch is applied even with `--omit=dev`) on every `npm install`. It changes the collector's built code in `node_modules`:

- **Google Analytics report no longer hides trackers.** The GA report deleted `url` from the shared event objects, so `stats.g.doubleclick.net` requests then disappeared from `third_party_trackers`. The patch copies the event instead.
- **Canvas font check counts every font.** The font regex had the `/g` flag, so `.test()` kept `lastIndex` between calls and skipped every other font. That could keep a script under the 50-font threshold. The flag is removed.
- **Canvas text-measure check counts and filters correctly.** Counting `measureText` calls gave `NaN` for every text after a script's first. The 50-call threshold tested `.size` on a plain object, so it never filtered anything. Now a script is kept only if it measured the same text at least 50 times, the published criterion (Englehardt & Narayanan, 2016).
- **Device emulation is awaited.** `page.emulate` (and `setExtraHTTPHeaders`) weren't awaited, so a failed emulation was ignored and the scan silently used the headless defaults. Now the scan fails. A device's `userAgentMetadata`, when given, is applied with `page.setUserAgent`, so Chrome sends matching `Sec-CH-UA-*` headers. Without the metadata it sends none once the user agent is overridden.
- **The 10 s navigation timer is cleared.** It used to keep running after navigation finished, then logged a false "timeout" during a later scan and held the process open.
- **New `postLoadWaitMs` option** (default `0`): an extra wait after each page's auto-scroll. Used by `--wait`.

The patch is for collector 3.11.0, so `package.json` pins that exact version. `postinstall` runs `patch-package --error-on-fail`, so `npm install` stops if the patch no longer applies, for example after a collector upgrade, and `npm test` fails if a fix is missing. After patching, `postinstall` records the patch file's name and SHA-256 in `node_modules/@themarkup/blacklight-collector/.blacklight-query-patch.json` (`src/collector-patch.ts`). Each patched file also carries a `// blacklight-query-patch:1` marker line. At startup the tool refuses to scan if a marker is missing, the record is missing, or the record doesn't match the patch file in `patches/` (for example, a pull that changed the patch). Then run `npm ci`: `npm install` can't apply a changed patch over the old one.

To update the patch:
1. Edit the files in `node_modules/@themarkup/blacklight-collector/build/`. A newly patched file also needs the `// blacklight-query-patch:1` line (after `"use strict";`) and an entry in `PATCHED_FILES` in `src/collector-patch.ts`.
2. Run `npx patch-package @themarkup/blacklight-collector`.
3. Run `npm ci` to reinstall the collector from the new patch and record it. The marker number doesn't change.

The tests in `__tests__/collector-patches.test.ts` check each fix, and `__tests__/patch-check.test.ts` checks the marker and the install-time record.

## Notes

Be aware that the Collector is fairly resource-heavy, and may slow down your computer. We recommend scanning smaller lists if hardware becomes overtaxed.

## Testing

`npm test` and `npm run typecheck`

The collector-patch tests launch the bundled headless Chromium against a local test page. `__tests__/cli.test.ts` runs the launcher itself.
