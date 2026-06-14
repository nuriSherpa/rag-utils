import { readFileSync } from 'node:fs';
import { extname, relative } from 'node:path';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import { sha256 } from '../utils/hash.js';
import type { FunctionRecord, SupportedLanguage } from '../types.js';

/** Maps file extensions to the tree-sitter grammar + our SupportedLanguage label. */
const LANGUAGE_BY_EXT: Record<string, { grammar: unknown; language: SupportedLanguage }> = {
  '.js': { grammar: JavaScript, language: 'javascript' },
  '.mjs': { grammar: JavaScript, language: 'javascript' },
  '.cjs': { grammar: JavaScript, language: 'javascript' },
  '.jsx': { grammar: JavaScript, language: 'jsx' },
  '.ts': { grammar: TypeScript.typescript, language: 'typescript' },
  '.tsx': { grammar: TypeScript.tsx, language: 'tsx' },
};

/** AST node types we treat as "a function worth indexing". */
const FUNCTION_NODE_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
]);

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

  parseFile(absFilePath: string): FunctionRecord[] {
    const ext = extname(absFilePath);
    const config = LANGUAGE_BY_EXT[ext];
    if (!config) return [];

    const parser = this.parsers.get(config.language);
    if (!parser) return [];

    let source: string;
    try {
      source = readFileSync(absFilePath, 'utf8');
    } catch {
      return [];
    }

    const tree = parser.parse(source);
    const relPath = relative(this.projectRoot, absFilePath).split('\\').join('/');

    return this.extractFunctions(tree.rootNode, source, relPath, config.language);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractFunctions(
    rootNode: any,
    source: string,
    relPath: string,
    language: SupportedLanguage,
  ): FunctionRecord[] {
    const records: FunctionRecord[] = [];
    // Track byte ranges of functions already recorded so we can skip
    // functions nested inside them.
    const recordedRanges: Array<{ start: number; end: number }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any) => {
      if (FUNCTION_NODE_TYPES.has(node.type)) {
        // Skip if this node is nested inside an already-recorded function.
        const isNested = recordedRanges.some(
          (r) => node.startIndex >= r.start && node.endIndex <= r.end,
        );

        if (!isNested) {
          const record = this.buildRecord(node, source, relPath, language);
          if (record) {
            records.push(record);
            recordedRanges.push({ start: node.startIndex, end: node.endIndex });
          }
        }
      }

      // Always recurse into children so we reach top-level arrow functions
      // assigned to variables, exported functions, class methods, etc.
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i));
      }
    };

    walk(rootNode);
    return records;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildRecord(
    node: any,
    source: string,
    relPath: string,
    language: SupportedLanguage,
  ): FunctionRecord | null {
    const code = source.slice(node.startIndex, node.endIndex);
    if (!code.trim()) return null;

    const startLine = node.startPosition.row + 1; // 1-based
    const endLine = node.endPosition.row + 1;
    const name = this.resolveName(node) ?? '<anonymous>';
    const id = `${relPath}::${name}::${startLine}`;

    return {
      id,
      name,
      filePath: relPath,
      startLine,
      endLine,
      code,
      language,
      hash: sha256(code),
    };
  }

  /**
   * Resolves a human-readable name for a function node.
   *
   * Naming heuristics (in priority order):
   *  1. `function_declaration` / `generator_function_declaration`: use the
   *     `name` child node directly (e.g. `function foo()` → "foo").
   *  2. `method_definition`: use the `name` child (e.g. `class Foo { bar() }` → "bar").
   *  3. `function_expression` / `arrow_function` assigned via
   *     `variable_declarator` (e.g. `const foo = () => {}`): use the
   *     declarator's `name` child.
   *  4. Object property / pair (e.g. `{ foo: function() {} }`): use the
   *     property key.
   *  5. `assignment_expression` LHS (e.g. `module.exports.foo = () => {}`):
   *     use the last identifier on the left-hand side.
   *  6. Fall back to "<anonymous>".
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolveName(node: any): string | null {
    // 1 & 2: nodes that carry their name as a direct child
    if (
      node.type === 'function_declaration' ||
      node.type === 'generator_function_declaration' ||
      node.type === 'method_definition'
    ) {
      const nameNode = node.childForFieldName('name');
      return nameNode?.text ?? null;
    }

    // For expressions we have to look at the parent
    const parent = node.parent;
    if (!parent) return null;

    // 3: const/let/var foo = () => {} or const foo = function() {}
    if (parent.type === 'variable_declarator') {
      const nameNode = parent.childForFieldName('name');
      return nameNode?.text ?? null;
    }

    // 4a: { foo: () => {} }  — tree-sitter calls this "pair"
    if (parent.type === 'pair') {
      const key = parent.childForFieldName('key');
      return key?.text ?? null;
    }

    // 4b: shorthand method in object { foo() {} } — "method_definition" already
    //     handled above, but some grammars use "property" with a value
    if (parent.type === 'property') {
      const key = parent.childForFieldName('key') ?? parent.child(0);
      return key?.text ?? null;
    }

    // 5: module.exports.foo = () => {}
    if (parent.type === 'assignment_expression') {
      const lhs = parent.childForFieldName('left');
      if (lhs) {
        // Take the last identifier in the chain (e.g. "foo" from "module.exports.foo")
        const text = lhs.text;
        const parts = text.split('.');
        return parts[parts.length - 1] ?? null;
      }
    }

    // 6: export default function() {}  — parent is export_statement
    if (parent.type === 'export_statement') {
      return '<default>';
    }

    return null;
  }
}
