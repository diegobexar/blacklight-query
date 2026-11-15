import { createHash } from "crypto";
import * as fs from "fs";
import { resolve } from "path";
import { buffer } from "stream/consumers";

export interface InvalidLine {
  /** 1-based line number in the input. */
  line: number;
  text: string;
  reason: string;
}

export interface UrlList {
  urls: string[];
  invalid: InvalidLine[];
}

/**
 * Parses a newline-separated URL list. Blank lines and lines starting with
 * `#` are skipped. Lines that aren't absolute http(s) URLs are returned in
 * `invalid` instead of throwing, so one bad line doesn't stop a scan.
 */
export function parseUrlList(text: string): UrlList {
  const urls: string[] = [];
  const invalid: InvalidLine[] = [];

  text
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;

      let url: URL;
      try {
        url = new URL(line);
      } catch {
        invalid.push({ line: i + 1, text: line, reason: "not an absolute URL" });
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        invalid.push({ line: i + 1, text: line, reason: `unsupported protocol ${url.protocol}` });
        return;
      }
      urls.push(line);
    });

  return { urls, invalid };
}

export interface InputFile {
  /** Absolute path, or `-` for stdin. */
  path: string;
  text: string;
  sha256: string;
}

/**
 * Reads the URL list from a file path, or from stdin when `source` is `-`.
 * Stdin is read as a stream: `readFileSync(0)` throws EAGAIN when stdin is
 * non-blocking.
 */
export async function readInput(source: string, cwd = process.cwd(), stdin: NodeJS.ReadableStream = process.stdin): Promise<InputFile> {
  const path = source === "-" ? "-" : resolve(cwd, source);
  const bytes = path === "-" ? await buffer(stdin) : fs.readFileSync(path);
  return {
    path,
    text: bytes.toString("utf8"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
