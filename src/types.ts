/**
 * Shared types used across crawler, rag, and server modules.
 * Keeping these in one place avoids circular imports and keeps
 * the "shape" of a function record consistent end-to-end.
 */

export type SupportedLanguage = "javascript" | "typescript" | "tsx" | "jsx";

/**
 * A single function/method extracted from source code by functionParser.ts
 */
export interface FunctionRecord {
  /** Stable id, e.g. `${filePath}::${name}::${startLine}` */
  id: string;
  /** Path relative to project root, e.g. "src/auth/login.ts" */
  filePath: string;
  /** Function or method name (or "<anonymous>") */
  name: string;
  /** 1-indexed start line in the source file */
  startLine: number;
  /** 1-indexed end line in the source file */
  endLine: number;
  /** Raw source text of the function, used for embedding + display */
  code: string;
  /** SHA256 of `code`, used to detect changes between watcher runs */
  hash: string;
  /** Language tree-sitter parsed this file as */
  language: SupportedLanguage;
}

/**
 * A FunctionRecord plus its embedding vector, as stored in vectors.db
 */
export interface EmbeddingRecord extends FunctionRecord {
  /** Embedding vector (e.g. 384-dim for all-MiniLM-L6-v2) */
  embedding: number[];
}

/**
 * A single ranked result returned from retriever.ts
 */
export interface SearchResult {
  record: FunctionRecord;
  /** Cosine similarity score, 0..1 (higher = more relevant) */
  score: number;
}

/**
 * Response shape for POST /query
 */
export interface QueryResponse {
  query: string;
  results: SearchResult[];
}

/**
 * Response shape for GET /status
 */
export interface StatusResponse {
  indexedFunctions: number;
  indexedFiles: number;
  watching: boolean;
  dbPath: string;
}

/** Resolved runtime config for the CLI / server */
export interface RagConfig {
  /** Absolute path to the project root being indexed */
  projectRoot: string;
  /** Absolute path to .rag-utils/vectors.db */
  dbPath: string;
  /** Port the local server listens on */
  port: number;
  /** Number of results to return per query */
  topK: number;
}
