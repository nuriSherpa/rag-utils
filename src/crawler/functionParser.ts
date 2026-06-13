import { readFileSync } from "node:fs";
import { extname, relative } from "node:path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import { sha256 } from "../utils/hash.js";
import type { FunctionRecord, SupportedLanguage } from "../types.js";

/** Maps file extensions to the tree-sitter grammar + our SupportedLanguage label. */
const LANGUAGE_BY_EXT: Record<string, { grammar: unknown; language: SupportedLanguage }> = {
  ".js": { grammar: JavaScript, language: "javascript" },
  ".mjs": { grammar: JavaScript, language: "javascript" },
  ".cjs": { grammar: JavaScript, language: "javascript" },
  ".jsx": { grammar: JavaScript, language: "jsx" },
  ".ts": { grammar: TypeScript.typescript, language: "typescript" },
  ".tsx": { grammar: TypeScript.tsx, language: "tsx" },
};

/** AST node types we treat as "a function worth indexing". */
const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
  "generator_function_declaration",
]);

/**
 * Parses a single source file with tree-sitter and extracts one
 * FunctionRecord per top-level/method-level function found.
 *
 * Design notes for the implementation pass:
 * - `projectRoot` is used so FunctionRecord.filePath is repo-relative
 *   (stable across machines, good for display in the extension).
 * - We walk the tree once with `cursor`-based traversal (faster than
 *   recursive `node.children` access for large files).
 * - For `arrow_function` / `function_expression`, the "name" usually
 *   comes from the *parent* node (e.g. a variable_declarator or
 *   assignment_expression's left-hand side, or an object property key
 *   for `{ foo: () => {} }`). Fall back to "<anonymous>" otherwise.
 * - `record.code` is the exact source slice for [startLine, endLine],
 *   used both for embedding and for display in the extension.
 */
export class FunctionParser {
  private readonly projectRoot: string;
  private readonly parsers: Map<SupportedLanguage, Parser>;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.parsers = new Map();

    for (const { grammar, language } of Object.values(LANGUAGE_BY_EXT)) {
      if (!this.parsers.has(language)) {
        const parser = new Parser();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parser.setLanguage(grammar as any);
        this.parsers.set(language, parser);
      }
    }
  }

  /**
   * Parses `absFilePath` and returns one FunctionRecord per function
   * found in the file. Returns an empty array for unsupported
   * extensions or files that fail to parse.
   */
  parseFile(absFilePath: string): FunctionRecord[] {
    const ext = extname(absFilePath);
    const config = LANGUAGE_BY_EXT[ext];
    if (!config) {
      return [];
    }

    const parser = this.parsers.get(config.language);
    if (!parser) {
      return [];
    }

    const source = readFileSync(absFilePath, "utf8");
    const tree = parser.parse(source);
    const relPath = relative(this.projectRoot, absFilePath).split("\\").join("/");

    return this.extractFunctions(tree.rootNode, source, relPath, config.language);
  }

  /**
   * Walks the AST and builds a FunctionRecord for every node whose
   * type is in FUNCTION_NODE_TYPES.
   *
   * TODO (next implementation pass):
   *  1. Use a TreeCursor to walk the whole tree.
   *  2. For each FUNCTION_NODE_TYPES match, resolve a human-readable
   *     name (see class doc above for the naming heuristics).
   *  3. Slice `source` from node.startIndex to node.endIndex for `code`.
   *  4. Build the FunctionRecord (id = `${relPath}::${name}::${startLine}`,
   *     hash = sha256(code)).
   *  5. Skip nodes nested inside another function we've already recorded
   *     (or decide deliberately to include nested helpers - TBD).
   */
  private extractFunctions(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _rootNode: any,
    _source: string,
    _relPath: string,
    _language: SupportedLanguage,
  ): FunctionRecord[] {
    // Placeholder until the AST walk is implemented.
    void FUNCTION_NODE_TYPES;
    void sha256;
    return [];
  }
}
