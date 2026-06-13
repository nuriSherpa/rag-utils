import { createHash } from "node:crypto";

/**
 * Returns the SHA256 hex digest of `content`.
 *
 * Used by functionParser/fileWatcher to detect whether an individual
 * function's source text changed between watcher runs, so we only
 * re-embed functions that actually changed.
 */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
