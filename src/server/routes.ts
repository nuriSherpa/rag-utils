import { Router, type Request, type Response } from "express";
import { Retriever } from "../rag/retriever.js";
import { VectorStore } from "../rag/vectorStore.js";
import type { QueryResponse, RagConfig, StatusResponse } from "../types.js";

export interface RouteDeps {
  config: RagConfig;
  store: VectorStore;
  retriever: Retriever;
  /** Whether fileWatcher is currently active (set by `rag serve`). */
  isWatching: () => boolean;
}

/**
 * Builds the Express router for the local server.
 *
 *  GET  /health -> { ok: true }                 - liveness check for the extension
 *  GET  /status -> StatusResponse                - index size, watch state, db path
 *  POST /query  -> QueryResponse                 - { query: string, topK?: number }
 */
export function createRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get("/status", (_req: Request, res: Response) => {
    const status: StatusResponse = {
      indexedFunctions: deps.store.countFunctions(),
      indexedFiles: deps.store.countFiles(),
      watching: deps.isWatching(),
      dbPath: deps.config.dbPath,
    };
    res.json(status);
  });

  router.post("/query", async (req: Request, res: Response) => {
    const { query, topK } = req.body as { query?: string; topK?: number };

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Request body must include a `query` string." });
      return;
    }

    const results = await deps.retriever.query(query, topK ?? deps.config.topK);
    const response: QueryResponse = { query, results };
    res.json(response);
  });

  return router;
}
