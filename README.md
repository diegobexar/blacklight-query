# Blacklight Query

A command-line tool to fetch [Blacklight](https://themarkup.org/series/blacklight) scans for a list of urls. Directly queries the open-source [Blacklight Collector](https://github.com/the-markup/blacklight-collector) tool and runs entirely locally.

## Prerequisites

- [`nvm`](https://www.linode.com/docs/guides/how-to-install-use-node-version-manager-nvm/)
- [`npm`](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm)

## Getting Started

- `nvm use`
- `npm install` (this also applies the collector patches; see [Collector patches](#collector-patches))
- `./blacklight-query urls.txt` where `urls.txt` has newline-separated absolute URLs to scan

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

- `--device mobile` emulates an iPhone 13 Mini, the collector's default. `--device desktop` uses a 1440×900 viewport without touch and a standard desktop Chrome user agent for the bundled Chromium's major version. The device used is recorded in each scan's `inspection.json` (`config.emulateDevice`) and in `run.json`.
- `--runs n` scans the full list `n` times in a row. Each run gets its own folder (`r1/`, `r2/`, …), so repeated runs can be compared.
- `--out dir` sets the base folder. Runs go in `dir/r1/`, `dir/r2/`, and so on. The tool won't write into a run folder that already exists.
- `--location text` is passed to the collector's `location` option, so it appears in each `inspection.json`, and is recorded in `run.json`. It's free text, e.g. where the scan was run from.
- `--wait ms` waits this long after the collector has loaded and scrolled each page and before it collects results, for pages that load trackers late. The default of `0` matches a standard Blacklight scan.

Each URL is retried once if the scan fails. URLs that fail twice are listed in the run's `failures.json`.

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

You can also pipe your list of URLs. With no file argument, the list is read from stdin if it's piped; `-` reads stdin explicitly.

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
    failures.json                 # URLs that failed both attempts: url, error, attempts
    example.com/                  # one folder per scanned URL, named for its hostname
      inspection.json
      requests.har
      ...
    example.com-2/                # a second URL on the same host
  r2/
    ...
```

`run.json` and `failures.json` are written when a run starts and updated as it goes, so an interrupted run keeps them; its `run.json` has `endedAt: null`. `run.json` records:

- the device name and settings, and the run number
- start and end times, the `--location` text and the `--wait` value
- the input file path (or `-` for stdin), its SHA-256, the URL count and any skipped lines
- how many URLs were scanned and how many failed
- the versions of the collector, puppeteer and Chromium; the EasyList and EasyPrivacy versions from their list headers; and this repo's git commit, with whether tracked files had local changes

## Collector patches

`patches/@themarkup+blacklight-collector+3.11.0.patch` is applied by [`patch-package`](https://github.com/ds300/patch-package) on every `npm install`. It changes the collector's built code in `node_modules`:

- **Google Analytics report no longer hides trackers.** The GA report deleted `url` from the shared event objects, so `stats.g.doubleclick.net` requests then disappeared from `third_party_trackers`. The patch copies the event instead.
- **Canvas font check counts every font.** The font regex had the `/g` flag, so `.test()` kept `lastIndex` between calls and skipped every other font. That could keep a script under the 50-font threshold. The flag is removed.
- **The 10 s navigation timer is cleared.** It used to keep running after navigation finished, then logged a false "timeout" during a later scan and held the process open.
- **New `postLoadWaitMs` option** (default `0`): an extra wait after each page's auto-scroll. Used by `--wait`.

The patch is for collector 3.11.0, so `package.json` pins that exact version. `postinstall` runs `patch-package --error-on-fail`, so `npm install` stops if the patch no longer applies, for example after a collector upgrade, and `npm test` fails if a fix is missing. To update the patch, edit the files in `node_modules/@themarkup/blacklight-collector/build/`, then run `npx patch-package @themarkup/blacklight-collector`. The tests in `__tests__/collector-patches.test.ts` check each fix.

## Notes

Be aware that the Collector is fairly resource-heavy, and may slow down your computer. We recommend scanning smaller lists if hardware becomes overtaxed.

## Testing

`npm test`

The collector-patch tests launch the bundled headless Chromium against a local test page.
