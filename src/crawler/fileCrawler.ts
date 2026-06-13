import { readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { Ignorer } from "./ignorer.js";
import { logger } from "../utils/logger.js";

/** Extensions functionParser.ts knows how to handle. */
export const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
]);

/**
 * Recursively walks `projectRoot`, skipping anything matched by
 * `.gitignore` / `.ragignore` (via Ignorer), and returns absolute
 * paths to every file with a supported source extension.
 *
 * This is intentionally synchronous and simple - `rag init` runs once
 * and doesn't need to be parallelized for typical repo sizes.
 */
export class FileCrawler {
  private readonly projectRoot: string;
  private readonly ignorer: Ignorer;

  constructor(projectRoot: string, ignorer: Ignorer = new Ignorer(projectRoot)) {
    this.projectRoot = projectRoot;
    this.ignorer = ignorer;
  }

  /** Returns absolute paths to all indexable source files. */
  collectFiles(): string[] {
    const results: string[] = [];
    this.walk(this.projectRoot, results);
    return results;
  }

  private walk(dir: string, results: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (err) {
      logger.warn(`Skipping unreadable directory: ${dir}`);
      logger.debug(String(err));
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relPath = relative(this.projectRoot, fullPath);

      if (this.ignorer.shouldIgnore(relPath)) {
        continue;
      }

      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        this.walk(fullPath, results);
        continue;
      }

      if (stats.isFile() && SUPPORTED_EXTENSIONS.has(extname(fullPath))) {
        results.push(fullPath);
      }
    }
  }
}
