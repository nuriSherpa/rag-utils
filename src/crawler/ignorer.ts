import { readFileSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import ignore, { type Ignore } from "ignore";

/**
 * Loads `.gitignore` and `.ragignore` (if present) from the project root
 * and exposes a single `shouldIgnore(path)` check.
 *
 * - `.gitignore` patterns are always respected.
 * - `.ragignore` adds *extra* exclusions on top (e.g. fixtures, docs)
 *   without you having to duplicate everything from .gitignore.
 * - A small built-in default list (node_modules, .git, dist, .rag-utils)
 *   is always applied, even if the user has no ignore files at all.
 */
export class Ignorer {
  private readonly ig: Ignore;
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.ig = ignore();

    // Sensible defaults so a fresh repo with no .gitignore still works.
    this.ig.add([
      "node_modules/",
      ".git/",
      "dist/",
      "build/",
      ".rag-utils/",
      "*.lock",
      "*.log",
    ]);

    this.loadIgnoreFile(".gitignore");
    this.loadIgnoreFile(".ragignore");
  }

  private loadIgnoreFile(filename: string): void {
    const fullPath = join(this.projectRoot, filename);
    if (!existsSync(fullPath)) {
      return;
    }

    const contents = readFileSync(fullPath, "utf8");
    this.ig.add(contents);
  }

  /**
   * Returns true if `targetPath` should be skipped by the crawler/watcher.
   * `targetPath` may be absolute or already relative to projectRoot.
   */
  shouldIgnore(targetPath: string): boolean {
    const relPath = isAbsolute(targetPath)
      ? relative(this.projectRoot, targetPath)
      : targetPath;

    // Paths outside the project root, or empty (project root itself),
    // are never "ignored" in the .gitignore sense.
    if (relPath === "" || relPath.startsWith("..")) {
      return false;
    }

    // `ignore` expects POSIX-style separators.
    const posixPath = relPath.split("\\").join("/");
    return this.ig.ignores(posixPath);
  }
}
