import { parseCliArgs, resolveInputSource, UsageError } from '../src/options';

describe('parseCliArgs', () => {
    test('defaults', () => {
        expect(parseCliArgs(['urls.list'])).toEqual({
            input: 'urls.list',
            device: 'mobile',
            runs: 1,
            out: null,
            location: null,
            wait: 0,
            help: false,
        });
    });

    test('all options, before or after the file argument', () => {
        expect(
            parseCliArgs(['--device', 'desktop', 'urls.list', '--runs', '3', '--out', 'scans/a', '--location', ' Test City ', '--wait=5000']),
        ).toEqual({
            input: 'urls.list',
            device: 'desktop',
            runs: 3,
            out: 'scans/a',
            location: 'Test City',
            wait: 5000,
            help: false,
        });
    });

    test('accepts the largest values', () => {
        expect(parseCliArgs(['--wait', String(2 ** 31 - 1), '--runs', '1000'])).toMatchObject({ wait: 2 ** 31 - 1, runs: 1000 });
    });

    test('no file argument, and "-" for stdin', () => {
        expect(parseCliArgs([]).input).toBeNull();
        expect(parseCliArgs(['-']).input).toBe('-');
    });

    test('--help and -h', () => {
        expect(parseCliArgs(['--help']).help).toBe(true);
        expect(parseCliArgs(['-h']).help).toBe(true);
    });

    test.each([
        [['--device', 'tablet']],
        [['--runs', '0']],
        [['--runs', '1.5']],
        [['--runs', 'two']],
        [['--wait', '-1']],
        [['--wait', '']],
        [['--wait', String(2 ** 31)]], // beyond setTimeout's limit, would fire after 1 ms
        [['--runs', '1001']],
        [['--bogus']],
        [['a.list', 'b.list']],
    ])('rejects %j', argv => {
        expect(() => parseCliArgs(argv)).toThrow(UsageError);
    });
});

describe('resolveInputSource', () => {
    test('a file argument wins even when stdin is not a TTY', () => {
        // e.g. `blacklight-query urls.list </dev/null`, or run from cron or a script
        expect(resolveInputSource('urls.list', false)).toBe('urls.list');
        expect(resolveInputSource('urls.list', true)).toBe('urls.list');
    });

    test('piped stdin is used when there is no file argument', () => {
        expect(resolveInputSource(null, false)).toBe('-');
    });

    test('nothing to read from an interactive terminal', () => {
        expect(resolveInputSource(null, true)).toBeNull();
    });
});
