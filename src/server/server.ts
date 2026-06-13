import express, { type Express } from "express";
import cors from "cors";
import { createRouter, type RouteDeps } from "./routes.js";
import { logger } from "../utils/logger.js";

/**
 * Builds (but does not start) the Express app.
 * Kept separate from `startServer` so tests can use `app` with
 * supertest without binding a port.
 */
export function createApp(deps: RouteDeps): Express {
  const app = express();

  // The Chrome extension's content script runs on chat sites
  // (e.g. claude.ai), so CORS must allow cross-origin requests
  // to this local server.
  app.use(cors());
  app.use(express.json());
  app.use(createRouter(deps));

  return app;
}

/** Starts listening on `deps.config.port` (default 3301). */
export function startServer(deps: RouteDeps): ReturnType<Express["listen"]> {
  const app = createApp(deps);
  const { port } = deps.config;

  return app.listen(port, () => {
    logger.success(`rag-utils server listening on http://localhost:${port}`);
  });
}
