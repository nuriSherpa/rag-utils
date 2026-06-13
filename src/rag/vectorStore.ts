import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { cosineSimilarity } from "../utils/similarity.js";
import type { EmbeddingRecord, FunctionRecord, SearchResult } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS functions (
  id         TEXT PRIMARY KEY,
  file_path  TEXT NOT NULL,
  name       TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line   INTEGER NOT NULL,
  code       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  language   TEXT NOT NULL,
  embedding  TEXT NOT NULL -- JSON-encoded number[]
);

CREATE INDEX IF NOT EXISTS idx_functions_file_path ON functions(file_path);
`;

/**
 * SQLite-backed store for FunctionRecord + embedding pairs.
 *
 * Embeddings are stored as JSON text (simple, portable, fine for the
 * "thousands of functions" scale this tool targets). Cosine search is
 * done in JS after loading rows - for repos large enough that this
 * becomes slow, swap in sqlite-vec or a brute-force loop with a cap.
 */
export class VectorStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  /** Insert or update a function + its embedding (keyed by FunctionRecord.id). */
  upsert(record: EmbeddingRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO functions (id, file_path, name, start_line, end_line, code, hash, language, embedding)
      VALUES (@id, @filePath, @name, @startLine, @endLine, @code, @hash, @language, @embedding)
      ON CONFLICT(id) DO UPDATE SET
        file_path = excluded.file_path,
        name = excluded.name,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        code = excluded.code,
        hash = excluded.hash,
        language = excluded.language,
        embedding = excluded.embedding
    `);

    stmt.run({
      id: record.id,
      filePath: record.filePath,
      name: record.name,
      startLine: record.startLine,
      endLine: record.endLine,
      code: record.code,
      hash: record.hash,
      language: record.language,
      embedding: JSON.stringify(record.embedding),
    });
  }

  /** Convenience for batch inserts during `rag init` (wraps in a transaction). */
  upsertMany(records: EmbeddingRecord[]): void {
    const tx = this.db.transaction((rows: EmbeddingRecord[]) => {
      for (const row of rows) {
        this.upsert(row);
      }
    });
    tx(records);
  }

  /** Remove specific function ids (used when fileWatcher detects deletions). */
  deleteByIds(ids: string[]): void {
    if (ids.length === 0) return;
    const stmt = this.db.prepare(`DELETE FROM functions WHERE id = ?`);
    const tx = this.db.transaction((rows: string[]) => {
      for (const id of rows) stmt.run(id);
    });
    tx(ids);
  }

  /** Remove all functions belonging to a file (used when the file itself is deleted). */
  deleteByFile(filePath: string): void {
    this.db.prepare(`DELETE FROM functions WHERE file_path = ?`).run(filePath);
  }

  /** Returns the top-K most similar functions to `queryEmbedding`. */
  search(queryEmbedding: number[], topK: number): SearchResult[] {
    const rows = this.db
      .prepare(`SELECT * FROM functions`)
      .all() as Array<Record<string, unknown>>;

    const results: SearchResult[] = rows.map((row) => {
      const embedding = JSON.parse(row.embedding as string) as number[];
      const record: FunctionRecord = {
        id: row.id as string,
        filePath: row.file_path as string,
        name: row.name as string,
        startLine: row.start_line as number,
        endLine: row.end_line as number,
        code: row.code as string,
        hash: row.hash as string,
        language: row.language as FunctionRecord["language"],
      };
      return { record, score: cosineSimilarity(queryEmbedding, embedding) };
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Total number of indexed functions. */
  countFunctions(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM functions`).get() as {
      count: number;
    };
    return row.count;
  }

  /** Total number of distinct indexed files. */
  countFiles(): number {
    const row = this.db
      .prepare(`SELECT COUNT(DISTINCT file_path) as count FROM functions`)
      .get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
