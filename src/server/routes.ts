import { Router, type Request, type Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Retriever } from '../rag/retriever.js';
import { VectorStore } from '../rag/vectorStore.js';
import type { QueryResponse, RagConfig, StatusResponse } from '../types.js';

export interface RouteDeps {
  config: RagConfig;
  store: VectorStore;
  retriever: Retriever;
  isWatching: () => boolean;
}

const SCORE_THRESHOLD = 0.05;

export function createRouter(deps: RouteDeps): Router {
  const router = Router();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get('/status', (_req: Request, res: Response) => {
    const status: StatusResponse = {
      indexedFunctions: deps.store.countFunctions(),
      indexedFiles: deps.store.countFiles(),
      watching: deps.isWatching(),
      dbPath: deps.config.dbPath,
    };
    res.json(status);
  });

  router.post('/query', async (req: Request, res: Response) => {
    const { query, topK } = req.body as { query?: string; topK?: number };

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Request body must include a `query` string.' });
      return;
    }

    const results = await deps.retriever.query(query, topK ?? deps.config.topK);
    const filtered = results.filter((r) => r.score >= SCORE_THRESHOLD);
    const response: QueryResponse = { query, results: filtered };
    res.json(response);
  });

  router.get('/file', (req: Request, res: Response) => {
    const filePath = req.query.path as string;

    if (!filePath) {
      res.status(400).json({ error: 'Missing ?path parameter' });
      return;
    }

    const resolvedPath = join(deps.config.projectRoot, filePath);

    try {
      const content = readFileSync(resolvedPath, 'utf-8');
      res.json({ path: filePath, content });
    } catch (err) {
      res.status(404).json({ error: 'File not found', path: filePath, resolved: resolvedPath });
    }
  });

  return router;
}
