/**
 * AuraOS Headless Browser API - BrowserContext Pool
 * Manages a pool of reusable Playwright BrowserContexts to avoid
 * spawning a new browser process per request.
 *
 * Architecture:
 *   - One shared chromium Browser instance (single process).
 *   - Up to N isolated BrowserContexts (each has its own cookies, storage, history).
 *   - Contexts are checked out on demand and returned after each action batch.
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import type { ContextPoolConfig } from './types.js';
import { DEFAULT_POOL_CONFIG } from './types.js';

interface PooledContext {
  id: string;
  context: BrowserContext;
  inUse: boolean;
  createdAt: number;
}

class BrowserContextPool {
  private browser: Browser | null = null;
  private pool: PooledContext[] = [];
  private config: ContextPoolConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<ContextPoolConfig> = {}) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  /**
   * Initialize the shared browser process. Idempotent.
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      if (this.browser) return;

      console.log('[Browser Pool] Launching Chromium...');
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      console.log(`[Browser Pool] Browser ready. Pool capacity: ${this.config.maxContexts} contexts.`);
    })();

    return this.initPromise;
  }

  /**
   * Acquire an available BrowserContext from the pool.
   * Creates a new one if capacity allows. Throws if pool is full.
   */
  async acquire(sessionId?: string): Promise<{ contextId: string; context: BrowserContext }> {
    await this.init();

    // Try to find an available (not in-use) context
    const available = this.pool.find(p => !p.inUse);
    if (available) {
      available.inUse = true;
      console.log(`[Browser Pool] Context ${available.id} acquired from pool (${this.countInUse()}/${this.pool.length} in use)`);
      return { contextId: available.id, context: available.context };
    }

    // Create a new context if under capacity
    if (this.pool.length < this.config.maxContexts) {
      const context = await this.browser!.newContext({
        viewport: this.config.viewport,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        javaScriptEnabled: true,
      });

      context.setDefaultTimeout(this.config.defaultTimeoutMs);

      const pooled: PooledContext = {
        id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        context,
        inUse: true,
        createdAt: Date.now(),
      };

      this.pool.push(pooled);
      console.log(`[Browser Pool] New context ${pooled.id} created (${this.countInUse()}/${this.pool.length} in use)`);
      return { contextId: pooled.id, context };
    }

    throw new Error(`Browser context pool is at capacity (${this.config.maxContexts}). Try again later.`);
  }

  /**
   * Return a context back to the pool (close all pages but keep context alive).
   */
  async release(contextId: string): Promise<void> {
    const pooled = this.pool.find(p => p.id === contextId);
    if (!pooled) return;

    // Close all open pages inside this context
    for (const page of pooled.context.pages()) {
      await page.close().catch(() => {});
    }

    pooled.inUse = false;
    console.log(`[Browser Pool] Context ${contextId} released (${this.countInUse()}/${this.pool.length} in use)`);
  }

  /**
   * Destroy a specific context (removes from pool entirely).
   */
  async destroy(contextId: string): Promise<void> {
    const idx = this.pool.findIndex(p => p.id === contextId);
    if (idx === -1) return;

    const pooled = this.pool[idx];
    await pooled.context.close().catch(() => {});
    this.pool.splice(idx, 1);
    console.log(`[Browser Pool] Context ${contextId} destroyed.`);
  }

  /**
   * Gracefully shut down all contexts and the browser process.
   */
  async shutdown(): Promise<void> {
    console.log('[Browser Pool] Shutting down...');

    for (const pooled of this.pool) {
      await pooled.context.close().catch(() => {});
    }
    this.pool = [];

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    this.initPromise = null;
    console.log('[Browser Pool] Shutdown complete.');
  }

  private countInUse(): number {
    return this.pool.filter(p => p.inUse).length;
  }

  get stats() {
    return {
      total: this.pool.length,
      inUse: this.countInUse(),
      available: this.pool.filter(p => !p.inUse).length,
      capacity: this.config.maxContexts,
    };
  }
}

// Singleton pool instance
export const browserPool = new BrowserContextPool();
