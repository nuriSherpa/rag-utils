import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { logger } from '../utils/logger.js';

const MODEL_NAME = 'Xenova/bge-small-en-v1.5';

/**
 * Wraps a local sentence-embedding model (all-MiniLM-L6-v2, 384 dims)
 * via transformers.js. Everything runs on-device - no API key, no
 * network calls after the model is cached on first run.
 *
 * Usage:
 *   const embedder = new Embedder();
 *   await embedder.init();
 *   const vector = await embedder.embed("function login(user) { ... }");
 *   const vectors = await embedder.embedBatch([codeA, codeB, codeC]);
 */
export class Embedder {
  private pipe: FeatureExtractionPipeline | null = null;

  /** Loads the model (downloads + caches on first run). Idempotent. */
  async init(): Promise<void> {
    if (this.pipe) {
      return;
    }
    logger.debug(`Loading embedding model: ${MODEL_NAME}`);
    this.pipe = await pipeline('feature-extraction', MODEL_NAME);
  }

  /** Embeds a single string, returning a normalized 384-dim vector. */
  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  /**
   * Embeds multiple strings in one pass. More efficient than calling
   * `embed` in a loop for `rag init`, which may process thousands
   * of functions.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.pipe) {
      await this.init();
    }
    if (!this.pipe) {
      throw new Error('Embedder failed to initialize.');
    }

    const output = await this.pipe(texts, {
      pooling: 'mean',
      normalize: true,
    });

    // `output` is a Tensor with shape [batch, dims]; `.tolist()` gives
    // a plain number[][] we can store directly in SQLite.
    return output.tolist() as number[][];
  }
}
