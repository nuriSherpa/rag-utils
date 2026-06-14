#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { FileCrawler } from '../src/crawler/fileCrawler.js';
import { FunctionParser } from '../src/crawler/functionParser.js';
import { FileWatcher } from '../src/crawler/fileWatcher.js';
import { Embedder } from '../src/rag/embedder.js';
import { VectorStore } from '../src/rag/vectorStore.js';
import { Retriever } from '../src/rag/retriever.js';
import { startServer } from '../src/server/server.js';
import { logger } from '../src/utils/logger.js';
import type { RagConfig } from '../src/types.js';

const program = new Command();

program
  .name('rag')
  .description('Local RAG-powered code context for AI chat assistants')
  .version('0.1.0');

function resolveConfig(cwd: string, overrides: Partial<RagConfig> = {}): RagConfig {
  const projectRoot = resolve(cwd);
  return {
    projectRoot,
    dbPath: join(projectRoot, '.rag-utils', 'vectors.db'),
    port: 3301,
    topK: 5,
    ...overrides,
  };
}

/** Prompt helper — asks a question and returns the trimmed answer. */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Paths for PID and log files, relative to the RAG data dir. */
function ragDataDir(projectRoot: string) {
  return join(projectRoot, '.rag-utils');
}
function pidFile(projectRoot: string) {
  return join(ragDataDir(projectRoot), 'server.pid');
}
function logFile(projectRoot: string) {
  return join(ragDataDir(projectRoot), 'server.log');
}
/** Config snapshot persisted so `stop` knows which root was used. */
function configFile(projectRoot: string) {
  return join(ragDataDir(projectRoot), 'config.json');
}

/**
 * `rag start`
 * Interactive setup → index codebase → launch server in background.
 */
program
  .command('start')
  .description('Prompt for a codebase path, index it, and start the RAG server in the background')
  .option('-p, --port <port>', 'port to listen on', '3301')
  .action(async (opts: { port: string }) => {
    // ── 1. Ask for the codebase path ──────────────────────────────────────
    let rawPath = await prompt('Enter the path to your codebase: ');
    if (!rawPath) rawPath = process.cwd();

    const projectRoot = resolve(rawPath.replace(/^~/, process.env.HOME ?? '~'));

    if (!existsSync(projectRoot)) {
      logger.error(`Path not found: ${projectRoot}`);
      process.exit(1);
    }

    // ── 2. Confirm ────────────────────────────────────────────────────────
    const port = Number(opts.port);
    console.log();
    console.log(`  Project : ${projectRoot}`);
    console.log(`  Port    : ${port}`);
    console.log(`  Logs    : ${logFile(projectRoot)}`);
    console.log();

    const confirm = await prompt('Index and start server? [Y/n] ');
    if (confirm.toLowerCase() === 'n') {
      logger.info('Aborted.');
      process.exit(0);
    }

    // ── 3. Ensure .rag-utils/ exists ──────────────────────────────────────
    const dataDir = ragDataDir(projectRoot);
    mkdirSync(dataDir, { recursive: true });

    // ── 4. Index the codebase (inline, so the user sees progress) ────────
    console.log();
    logger.info(`Indexing ${projectRoot} …`);

    const config = resolveConfig(projectRoot, { port });
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
      `Indexed ${store.countFunctions()} functions across ${store.countFiles()} files.`,
    );
    store.close();

    // ── 5. Persist config so `stop` can find the right data dir ──────────
    writeFileSync(configFile(projectRoot), JSON.stringify({ projectRoot, port }, null, 2));

    // ── 6. Spawn the server as a detached background process ─────────────
    const logPath = logFile(projectRoot);
    const pidPath = pidFile(projectRoot);

    // We re-invoke this same script with the internal __serve__ sub-command,
    // passing projectRoot and port as env vars so no extra CLI parsing is needed.
    // Resolve tsx binary path so the detached process can run TypeScript directly
    const { execSync } = await import('node:child_process');
    const tsxPath = execSync('which tsx', { encoding: 'utf8' }).trim();

    const child = spawn(
      tsxPath, // tsx instead of node
      [process.argv[1], '__serve__'],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          RAG_PROJECT_ROOT: projectRoot,
          RAG_PORT: String(port),
          RAG_LOG_FILE: logPath,
        },
      },
    );

    // Pipe child stdout/stderr to the log file
    const { createWriteStream } = await import('node:fs');
    const logStream = createWriteStream(logPath, { flags: 'a' });
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);

    child.unref(); // let the parent exit without waiting for the child

    writeFileSync(pidPath, String(child.pid));

    console.log();
    logger.success(`RAG server started (PID ${child.pid}) on http://localhost:${port}`);
    logger.info(`Logs → ${logPath}`);
    logger.info(`Stop with: rag stop ${projectRoot}`);
  });

/**
 * `rag stop [projectRoot]`
 * Reads the PID file and kills the background server.
 */
program
  .command('stop [projectRoot]')
  .description('Stop the background RAG server')
  .action(async (projectRootArg?: string) => {
    const projectRoot = resolve(projectRootArg ?? process.cwd());
    const pidPath = pidFile(projectRoot);

    if (!existsSync(pidPath)) {
      logger.error(`No running server found for ${projectRoot}`);
      logger.info(`(looked for PID file at ${pidPath})`);
      process.exit(1);
    }

    const pid = parseInt(readFileSync(pidPath, 'utf8'), 10);

    try {
      process.kill(pid, 'SIGTERM');
      unlinkSync(pidPath);
      logger.success(`Stopped server (PID ${pid}).`);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ESRCH') {
        // Process already dead — clean up stale PID file
        unlinkSync(pidPath);
        logger.info(`Server (PID ${pid}) was not running. Cleaned up stale PID file.`);
      } else {
        logger.error(`Failed to stop server: ${String(err)}`);
        process.exit(1);
      }
    }
  });

/**
 * `rag __serve__`
 * Internal command — launched by `rag start` as a detached background process.
 * Not shown in --help. Reads config from env vars.
 */
program.command('__serve__', { hidden: true }).action(async () => {
  const projectRoot = process.env.RAG_PROJECT_ROOT;
  const port = Number(process.env.RAG_PORT ?? 3301);

  if (!projectRoot) {
    console.error('[rag] __serve__ requires RAG_PROJECT_ROOT env var');
    process.exit(1);
  }

  const config = resolveConfig(projectRoot, { port });
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
      console.log(`[rag] Re-indexing ${functions.length} function(s) in ${filePath}`);
      const vectors = await embedder.embedBatch(functions.map((fn) => fn.code));
      store.upsertMany(functions.map((fn, i) => ({ ...fn, embedding: vectors[i] })));
    },
    onFunctionsRemoved: (_filePath, removedIds) => store.deleteByIds(removedIds),
    onFileRemoved: (filePath) => store.deleteByFile(filePath),
  });

  watching = true;
  console.log(`[rag] Server + watcher running for ${projectRoot} on port ${port}`);
});

// ── Original commands (unchanged) ────────────────────────────────────────────

program
  .command('init')
  .description('Index the current project: crawl files, parse functions, and embed them')
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

program
  .command('serve')
  .description('Start the local query server and live file watcher')
  .option('-p, --port <port>', 'port to listen on', '3301')
  .action(async (opts: { port: string }) => {
    const config = resolveConfig(process.cwd(), { port: Number(opts.port) });

    const store = new VectorStore(config.dbPath);
    const embedder = new Embedder();
    const retriever = new Retriever(store, embedder);
    await retriever.init();

    let watching = false;

    startServer({ config, store, retriever, isWatching: () => watching });

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

    watching = true;
  });

program
  .command('query <text>')
  .description('Run a one-off query against the local index')
  .option('-k, --top-k <n>', 'number of results to return', '5')
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

program
  .command('watch')
  .description('Watch the project and keep the index up to date (no server)')
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

    logger.info('Watching for changes. Press Ctrl+C to stop.');
  });

program.parseAsync(process.argv);
