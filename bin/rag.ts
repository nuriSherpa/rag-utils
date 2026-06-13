#!/usr/bin/env node
import { Command } from "commander";
import { resolve, join } from "node:path";
import { FileCrawler } from "../src/crawler/fileCrawler.js";
import { FunctionParser } from "../src/crawler/functionParser.js";
import { FileWatcher } from "../src/crawler/fileWatcher.js";
import { Embedder } from "../src/rag/embedder.js";
import { VectorStore } from "../src/rag/vectorStore.js";
import { Retriever } from "../src/rag/retriever.js";
import { startServer } from "../src/server/server.js";
import { logger } from "../src/utils/logger.js";
import type { RagConfig } from "../src/types.js";

const program = new Command();

program
  .name("rag")
  .description("Local RAG-powered code context for AI chat assistants")
  .version("0.1.0");

function resolveConfig(cwd: string, overrides: Partial<RagConfig> = {}): RagConfig {
  const projectRoot = resolve(cwd);
  return {
    projectRoot,
    dbPath: join(projectRoot, ".rag-utils", "vectors.db"),
    port: 3301,
    topK: 5,
    ...overrides,
  };
}

/**
 * `rag init`
 * Flow 1: crawl -> parse -> embed -> persist.
 */
program
  .command("init")
  .description("Index the current project: crawl files, parse functions, and embed them")
  .action(async () => {
    const config = resolveConfig(process.cwd());

    logger.info(`Indexing project at ${config.projectRoot}`);

    const crawler = new FileCrawler(config.projectRoot);
    const parser = new FunctionParser(config.projectRoot);
    const embedder = new Embedder();
    const store = new VectorStore(config.dbPath);

    await embedder.init();

    const files = crawler.collectFiles();
    logger.info(`Found ${files.length} source files.`);

    for (const file of files) {
      const functions = parser.parseFile(file);
      if (functions.length === 0) continue;

      const vectors = await embedder.embedBatch(functions.map((fn) => fn.code));
      store.upsertMany(functions.map((fn, i) => ({ ...fn, embedding: vectors[i] })));
    }

    logger.success(
      `Indexed ${store.countFunctions()} functions across ${store.countFiles()} files -> ${config.dbPath}`,
    );

    store.close();
  });

/**
 * `rag serve`
 * Flow 2: start the local server + file watcher together.
 */
program
  .command("serve")
  .description("Start the local query server and live file watcher")
  .option("-p, --port <port>", "port to listen on", "3301")
  .action(async (opts: { port: string }) => {
    const config = resolveConfig(process.cwd(), { port: Number(opts.port) });

    const store = new VectorStore(config.dbPath);
    const embedder = new Embedder();
    const retriever = new Retriever(store, embedder);
    await retriever.init();

    let watching = false;

    startServer({
      config,
      store,
      retriever,
      isWatching: () => watching,
    });

    const parser = new FunctionParser(config.projectRoot);
    const watcher = new FileWatcher(config.projectRoot, parser);

    await watcher.start({
      onFunctionsChanged: async (filePath, functions) => {
        logger.info(`Re-indexing ${functions.length} function(s) in ${filePath}`);
        const vectors = await embedder.embedBatch(functions.map((fn) => fn.code));
        store.upsertMany(functions.map((fn, i) => ({ ...fn, embedding: vectors[i] })));
      },
      onFunctionsRemoved: (_filePath, removedIds) => {
        store.deleteByIds(removedIds);
      },
      onFileRemoved: (filePath) => {
        store.deleteByFile(filePath);
      },
    });

    watching = true;
  });

/**
 * `rag query <text>`
 * One-off CLI query, useful for debugging without the extension.
 */
program
  .command("query <text>")
  .description("Run a one-off query against the local index")
  .option("-k, --top-k <n>", "number of results to return", "5")
  .action(async (text: string, opts: { topK: string }) => {
    const config = resolveConfig(process.cwd(), { topK: Number(opts.topK) });

    const store = new VectorStore(config.dbPath);
    const retriever = new Retriever(store);
    await retriever.init();

    const results = await retriever.query(text, config.topK);

    for (const { record, score } of results) {
      logger.info(
        `${score.toFixed(3)}  ${record.filePath}:${record.startLine}-${record.endLine}  ${record.name}`,
      );
    }

    store.close();
  });

/**
 * `rag watch`
 * Run only the file watcher (no server) - useful for debugging the
 * crawler/parser/watcher pipeline in isolation.
 */
program
  .command("watch")
  .description("Watch the project and keep the index up to date (no server)")
  .action(async () => {
    const config = resolveConfig(process.cwd());
    const store = new VectorStore(config.dbPath);
    const embedder = new Embedder();
    await embedder.init();

    const parser = new FunctionParser(config.projectRoot);
    const watcher = new FileWatcher(config.projectRoot, parser);

    await watcher.start({
      onFunctionsChanged: async (filePath, functions) => {
        logger.info(`Re-indexing ${functions.length} function(s) in ${filePath}`);
        const vectors = await embedder.embedBatch(functions.map((fn) => fn.code));
        store.upsertMany(functions.map((fn, i) => ({ ...fn, embedding: vectors[i] })));
      },
      onFunctionsRemoved: (_filePath, removedIds) => store.deleteByIds(removedIds),
      onFileRemoved: (filePath) => store.deleteByFile(filePath),
    });

    logger.info("Watching for changes. Press Ctrl+C to stop.");
  });

program.parseAsync(process.argv);
