import chokidar, { type FSWatcher } from "chokidar";
import { FunctionParser } from "./functionParser.js";
import { Ignorer } from "./ignorer.js";
import { SUPPORTED_EXTENSIONS } from "./fileCrawler.js";
import { logger } from "../utils/logger.js";
import type { FunctionRecord } from "../types.js";

export interface FileWatcherEvents {
  /** Functions that are new or whose hash changed since last index. */
  onFunctionsChanged: (filePath: string, functions: FunctionRecord[]) => void;
  /** Functions that no longer exist in the file (by id) and should be deleted. */
  onFunctionsRemoved: (filePath: string, removedIds: string[]) => void;
  /** File was deleted entirely - remove all of its functions. */
  onFileRemoved: (filePath: string) => void;
}

/**
 * Watches the project for file changes and re-parses only the files
 * that changed, diffing at the *function* level via FunctionRecord.hash
 * so VectorStore only re-embeds functions whose source actually changed.
 *
 * Implementation outline:
 *  - On 'add'/'change': parseFile(path) -> new FunctionRecord[]
 *    - Compare against the last-known records for this file
 *      (keyed by FunctionRecord.id) using `.hash`.
 *    - New or changed-hash records -> onFunctionsChanged
 *    - Previously-known ids missing from the new parse -> onFunctionsRemoved
 *  - On 'unlink': onFileRemoved(path)
 *  - Maintain an in-memory `Map<filePath, FunctionRecord[]>` snapshot
 *    so diffs don't require re-reading vectors.db on every save.
 */
export class FileWatcher {
  private readonly projectRoot: string;
  private readonly parser: FunctionParser;
  private readonly ignorer: Ignorer;
  private readonly lastKnown: Map<string, FunctionRecord[]> = new Map();
  private watcher: FSWatcher | null = null;

  constructor(projectRoot: string, parser: FunctionParser = new FunctionParser(projectRoot)) {
    this.projectRoot = projectRoot;
    this.parser = parser;
    this.ignorer = new Ignorer(projectRoot);
  }

  /** Starts watching. Resolves once the initial scan completes ('ready'). */
  start(events: FileWatcherEvents): Promise<void> {
    return new Promise((resolve) => {
      this.watcher = chokidar.watch(this.projectRoot, {
        ignored: (path: string) => this.ignorer.shouldIgnore(path),
        ignoreInitial: true, // `rag init` already handled the first pass
        persistent: true,
      });

      this.watcher
        .on("add", (path) => this.handleChange(path, events))
        .on("change", (path) => this.handleChange(path, events))
        .on("unlink", (path) => this.handleRemove(path, events))
        .on("ready", () => {
          logger.info("File watcher ready.");
          resolve();
        })
        .on("error", (err) => logger.error("Watcher error", err));
    });
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  private handleChange(filePath: string, events: FileWatcherEvents): void {
    if (!this.isSupported(filePath)) {
      return;
    }

    logger.debug(`File changed: ${filePath}`);

    let updated: FunctionRecord[];
    try {
      updated = this.parser.parseFile(filePath);
    } catch (err) {
      logger.warn(`Failed to parse ${filePath}, skipping.`);
      logger.debug(String(err));
      return;
    }

    const previous = this.lastKnown.get(filePath) ?? [];
    const previousById = new Map(previous.map((fn) => [fn.id, fn]));
    const updatedById = new Map(updated.map((fn) => [fn.id, fn]));

    const changed = updated.filter((fn) => {
      const prev = previousById.get(fn.id);
      return !prev || prev.hash !== fn.hash;
    });

    const removedIds = previous
      .map((fn) => fn.id)
      .filter((id) => !updatedById.has(id));

    this.lastKnown.set(filePath, updated);

    if (changed.length > 0) {
      events.onFunctionsChanged(filePath, changed);
    }
    if (removedIds.length > 0) {
      events.onFunctionsRemoved(filePath, removedIds);
    }
  }

  private handleRemove(filePath: string, events: FileWatcherEvents): void {
    this.lastKnown.delete(filePath);
    events.onFileRemoved(filePath);
  }

  private isSupported(filePath: string): boolean {
    const ext = filePath.slice(filePath.lastIndexOf("."));
    return SUPPORTED_EXTENSIONS.has(ext);
  }
}
