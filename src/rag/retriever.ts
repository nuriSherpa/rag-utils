import { Embedder } from "./embedder.js";
import { VectorStore } from "./vectorStore.js";
import type { SearchResult } from "../types.js";

/**
 * Top-level entry point for Flow 3 (querying). Embeds the user's
 * natural-language query with the same model used during indexing,
 * then asks VectorStore for the closest functions.
 */
export class Retriever {
  private readonly embedder: Embedder;
  private readonly store: VectorStore;

  constructor(store: VectorStore, embedder: Embedder = new Embedder()) {
    this.store = store;
    this.embedder = embedder;
  }

  /** Must be called once before `query()` (loads the embedding model). */
  async init(): Promise<void> {
    await this.embedder.init();
  }

  /** Returns the top-K functions most relevant to `query`. */
  async query(query: string, topK: number): Promise<SearchResult[]> {
    const queryEmbedding = await this.embedder.embed(query);
    return this.store.search(queryEmbedding, topK);
  }
}
