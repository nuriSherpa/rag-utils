import chalk from "chalk";

/**
 * Small wrapper around chalk so the rest of the codebase doesn't
 * need to import chalk directly or repeat prefix formatting.
 */
export const logger = {
  info(message: string): void {
    console.log(chalk.cyan("[rag]"), message);
  },

  success(message: string): void {
    console.log(chalk.green("[rag]"), message);
  },

  warn(message: string): void {
    console.warn(chalk.yellow("[rag]"), message);
  },

  error(message: string, err?: unknown): void {
    console.error(chalk.red("[rag]"), message);
    if (err instanceof Error) {
      console.error(chalk.red(err.stack ?? err.message));
    } else if (err !== undefined) {
      console.error(err);
    }
  },

  /** For fine-grained per-file/per-function logs, gated behind RAG_DEBUG=1 */
  debug(message: string): void {
    if (process.env.RAG_DEBUG === "1") {
      console.log(chalk.gray("[rag:debug]"), message);
    }
  },
};
