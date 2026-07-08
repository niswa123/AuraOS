/**
 * AuraOS Headless Browser API - Scraping Actions Executor
 * Implements the full action set agents can dispatch against
 * a live BrowserContext page: navigation, HTML parsing, clicking,
 * typing, form submission, JS evaluation, and screenshots.
 */

import { BrowserContext, Page } from 'playwright';
import type { BrowserAction, BrowserActionResult } from './types.js';
import { saveSession, loadSession, clearSession } from './session-manager.js';

/**
 * Get or create the first page in a context.
 */
async function getPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages();
  if (pages.length > 0) return pages[0];
  return await context.newPage();
}

/**
 * Execute a single browser action against a Playwright BrowserContext.
 * All actions are fully async and return a typed BrowserActionResult.
 */
export async function executeAction(
  context: BrowserContext,
  action: BrowserAction,
  sessionId?: string
): Promise<BrowserActionResult> {
  const start = Date.now();
  const timeout = action.timeoutMs ?? 30_000;

  const result = (data: Partial<BrowserActionResult>): BrowserActionResult => ({
    action: action.type,
    success: true,
    durationMs: Date.now() - start,
    currentUrl: undefined,
    ...data,
  });

  const fail = (error: string): BrowserActionResult => ({
    action: action.type,
    success: false,
    error,
    durationMs: Date.now() - start,
  });

  try {
    const page = await getPage(context);

    switch (action.type) {

      // ── Navigation ─────────────────────────────────────────────────
      case 'navigate': {
        if (!action.url) throw new Error('navigate requires a url');
        await page.goto(action.url, {
          waitUntil: 'domcontentloaded',
          timeout,
        });
        return result({ currentUrl: page.url() });
      }

      // ── Page-to-HTML Parser ────────────────────────────────────────
      case 'get_html': {
        const selector = action.selector;
        let html: string;
        if (selector) {
          const el = await page.waitForSelector(selector, { timeout });
          html = await el.innerHTML();
        } else {
          html = await page.content();
        }
        return result({ data: html, currentUrl: page.url() });
      }

      case 'get_text': {
        if (!action.selector) throw new Error('get_text requires a selector');
        const el = await page.waitForSelector(action.selector, { timeout });
        const text = await el.innerText();
        return result({ data: text.trim(), currentUrl: page.url() });
      }

      // ── Click Simulator ────────────────────────────────────────────
      case 'click': {
        if (!action.selector) throw new Error('click requires a selector');
        await page.waitForSelector(action.selector, { timeout });

        if (action.waitForNavigation) {
          await Promise.all([
            page.waitForNavigation({ timeout }),
            page.click(action.selector),
          ]);
        } else {
          await page.click(action.selector);
        }
        return result({ currentUrl: page.url() });
      }

      // ── Input Typer ────────────────────────────────────────────────
      case 'type': {
        if (!action.selector) throw new Error('type requires a selector');
        if (action.text === undefined) throw new Error('type requires text');

        await page.waitForSelector(action.selector, { timeout });
        // Clear existing content then type
        await page.fill(action.selector, action.text);
        return result({ currentUrl: page.url() });
      }

      // ── Select Dropdown ────────────────────────────────────────────
      case 'select': {
        if (!action.selector) throw new Error('select requires a selector');
        if (!action.value) throw new Error('select requires a value');

        await page.waitForSelector(action.selector, { timeout });
        await page.selectOption(action.selector, action.value);
        return result({ currentUrl: page.url() });
      }

      // ── Form Submission ────────────────────────────────────────────
      case 'submit': {
        if (!action.selector) throw new Error('submit requires a selector');

        await page.waitForSelector(action.selector, { timeout });
        await Promise.all([
          page.waitForNavigation({ timeout }).catch(() => {}), // Navigation may not occur
          page.locator(action.selector).evaluate((el: HTMLElement) => el.closest('form')?.submit()),
        ]);
        return result({ currentUrl: page.url() });
      }

      // ── Wait for Selector ──────────────────────────────────────────
      case 'wait_for_selector': {
        if (!action.selector) throw new Error('wait_for_selector requires a selector');
        await page.waitForSelector(action.selector, { timeout });
        return result({ currentUrl: page.url() });
      }

      // ── Get Attribute ──────────────────────────────────────────────
      case 'get_attribute': {
        if (!action.selector) throw new Error('get_attribute requires a selector');
        if (!action.value) throw new Error('get_attribute requires an attribute name in value field');

        await page.waitForSelector(action.selector, { timeout });
        const attr = await page.getAttribute(action.selector, action.value);
        return result({ data: attr, currentUrl: page.url() });
      }

      // ── JavaScript Evaluation ──────────────────────────────────────
      case 'evaluate': {
        if (!action.script) throw new Error('evaluate requires a script');
        const evalResult = await page.evaluate(action.script);
        return result({ data: evalResult, currentUrl: page.url() });
      }

      // ── Screenshot ─────────────────────────────────────────────────
      case 'screenshot': {
        const buffer = await page.screenshot({ fullPage: true, type: 'png' });
        const base64 = buffer.toString('base64');
        return result({ data: base64, currentUrl: page.url() });
      }

      // ── Session Save ───────────────────────────────────────────────
      case 'save_session': {
        const id = sessionId || 'default';
        const session = await saveSession(context, id);
        return result({
          data: {
            sessionId: id,
            cookieCount: session.cookies.length,
            localStorageKeys: Object.keys(session.localStorage).length,
          } as Record<string, unknown>,
          currentUrl: page.url(),
        });
      }

      // ── Session Load ───────────────────────────────────────────────
      case 'load_session': {
        const id = sessionId || 'default';
        const session = await loadSession(context, id);
        return result({
          data: session
            ? { found: true, sessionId: id, cookieCount: session.cookies.length } as Record<string, unknown>
            : { found: false } as Record<string, unknown>,
          currentUrl: page.url(),
        });
      }

      // ── Session Clear ──────────────────────────────────────────────
      case 'clear_session': {
        const id = sessionId || 'default';
        const cleared = await clearSession(id);
        return result({ data: { cleared } as Record<string, unknown> });
      }

      default:
        return fail(`Unknown action type: ${(action as any).type}`);
    }
  } catch (error: any) {
    return fail(error.message ?? String(error));
  }
}

/**
 * Execute a sequential batch of browser actions in a single context.
 * Stops on first failure unless continueOnError is set.
 */
export async function executeActionBatch(
  context: BrowserContext,
  actions: BrowserAction[],
  opts: { continueOnError?: boolean; sessionId?: string } = {}
): Promise<BrowserActionResult[]> {
  const results: BrowserActionResult[] = [];

  for (const action of actions) {
    const res = await executeAction(context, action, opts.sessionId);
    results.push(res);

    if (!res.success && !opts.continueOnError) {
      console.warn(`[Browser Actions] Stopping batch at action "${action.type}": ${res.error}`);
      break;
    }
  }

  return results;
}
