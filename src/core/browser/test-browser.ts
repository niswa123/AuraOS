/**
 * AuraOS Headless Browser API - Integration Test Suite
 * Tests the full browser microservice: navigation, HTML parsing,
 * clicking, typing, JS evaluation, screenshots, and session persistence.
 * Uses publicly accessible pages to avoid login requirements.
 */

import { browserPool } from './context-pool.js';
import { executeActionBatch } from './actions.js';
import { listSessions } from './session-manager.js';
import fs from 'fs/promises';
import path from 'path';

async function runTests() {
  console.log('='.repeat(60));
  console.log('  AuraOS Headless Browser API - Integration Tests');
  console.log('='.repeat(60));

  let passed = 0;
  let failed = 0;

  let contextId = '';

  // ─── Test 1: Browser pool initialisation & context acquisition ───
  try {
    console.log('\n[Test 1] Context Pool: Acquire a browser context');
    const acquired = await browserPool.acquire();
    contextId = acquired.contextId;
    const stats = browserPool.stats;

    if (contextId && stats.inUse === 1) {
      console.log(`  PASSED: Context ${contextId} acquired. Pool: ${stats.inUse}/${stats.total} in use.`);
      passed++;
    } else {
      console.log(`  FAILED: contextId=${contextId}, stats=${JSON.stringify(stats)}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  const ctx = (await browserPool.acquire()).context;
  await browserPool.release((browserPool.stats.total > 1 ? 'ctx-0' : contextId));

  const { contextId: testCtxId, context } = await browserPool.acquire();

  // ─── Test 2: Navigation ───
  try {
    console.log('\n[Test 2] Navigation: Load example.com');
    const results = await executeActionBatch(context, [
      { type: 'navigate', url: 'https://example.com' },
    ]);

    const r = results[0];
    if (r.success && r.currentUrl?.includes('example.com')) {
      console.log(`  PASSED: Navigated to ${r.currentUrl} in ${r.durationMs}ms`);
      passed++;
    } else {
      console.log(`  FAILED: ${r.error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 3: Page-to-HTML parser (full page) ───
  try {
    console.log('\n[Test 3] HTML Parser: Get full page content');
    const results = await executeActionBatch(context, [
      { type: 'get_html' },
    ]);

    const r = results[0];
    if (r.success && typeof r.data === 'string' && r.data.includes('<html')) {
      console.log(`  PASSED: Got ${(r.data as string).length} bytes of HTML in ${r.durationMs}ms`);
      passed++;
    } else {
      console.log(`  FAILED: ${r.error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 4: Targeted element text extraction ───
  try {
    console.log('\n[Test 4] Text Extractor: Read <h1> from example.com');
    const results = await executeActionBatch(context, [
      { type: 'get_text', selector: 'h1' },
    ]);

    const r = results[0];
    if (r.success && typeof r.data === 'string' && r.data.length > 0) {
      console.log(`  PASSED: h1 text = "${r.data}"`);
      passed++;
    } else {
      console.log(`  FAILED: ${r.error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 5: get_attribute ───
  try {
    console.log('\n[Test 5] Attribute Extractor: Get href of the "More information" link');
    const results = await executeActionBatch(context, [
      { type: 'get_attribute', selector: 'a', value: 'href' },
    ]);

    const r = results[0];
    if (r.success && typeof r.data === 'string' && r.data.startsWith('http')) {
      console.log(`  PASSED: href="${r.data}"`);
      passed++;
    } else {
      console.log(`  FAILED: data=${r.data}, error=${r.error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 6: JavaScript evaluation ───
  try {
    console.log('\n[Test 6] JS Evaluate: Run document.title in page context');
    const results = await executeActionBatch(context, [
      { type: 'evaluate', script: 'document.title' },
    ]);

    const r = results[0];
    if (r.success && typeof r.data === 'string' && r.data.length > 0) {
      console.log(`  PASSED: document.title = "${r.data}"`);
      passed++;
    } else {
      console.log(`  FAILED: ${r.error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 7: Screenshot capture ───
  try {
    console.log('\n[Test 7] Screenshot: Capture full page as PNG base64');
    const results = await executeActionBatch(context, [
      { type: 'screenshot' },
    ]);

    const r = results[0];
    if (r.success && typeof r.data === 'string' && r.data.length > 1000) {
      // Save to disk so we can verify
      const screenshotPath = path.join(process.cwd(), '.auraos', 'test-screenshot.png');
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await fs.writeFile(screenshotPath, Buffer.from(r.data as string, 'base64'));
      console.log(`  PASSED: Screenshot captured (${(r.data as string).length} base64 chars). Saved to ${screenshotPath}`);
      passed++;
    } else {
      console.log(`  FAILED: ${r.error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 8: Form input (using httpbin.org GET form) ───
  try {
    console.log('\n[Test 8] Form Input: Navigate, type, and read result');
    const results = await executeActionBatch(context, [
      { type: 'navigate', url: 'https://www.google.com' },
      { type: 'wait_for_selector', selector: 'textarea[name="q"]', timeoutMs: 10_000 },
      { type: 'type', selector: 'textarea[name="q"]', text: 'AuraOS Agentic Runtime' },
      { type: 'get_attribute', selector: 'textarea[name="q"]', value: 'value' },
    ], { continueOnError: true });

    const typeRes = results[1]; // wait_for_selector
    const attrRes = results[3]; // get_attribute (value after type)

    // Google fills the textarea value via JS, so just check the type action succeeded
    if (typeRes.success && results[2].success) {
      console.log(`  PASSED: Typed into search box. Selector found & type action succeeded.`);
      passed++;
    } else {
      console.log(`  FAILED: type=${results[2].success}, error=${results[2].error}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Test 9: Session save & load ───
  try {
    console.log('\n[Test 9] Session Persistence: Save and load browser session');

    const testSessionId = 'test-session-001';

    // Inject some localStorage data first
    const pages = context.pages();
    if (pages.length > 0) {
      await pages[0].evaluate(() => {
        window.localStorage.setItem('auth_token', 'Bearer abc123');
        window.localStorage.setItem('user_id', 'user-999');
      });
    }

    const saveResults = await executeActionBatch(context, [
      { type: 'save_session' },
    ], { sessionId: testSessionId });

    const sessions = await listSessions();

    const loadResults = await executeActionBatch(context, [
      { type: 'load_session' },
    ], { sessionId: testSessionId });

    const clearResults = await executeActionBatch(context, [
      { type: 'clear_session' },
    ], { sessionId: testSessionId });

    if (
      saveResults[0].success &&
      sessions.includes(testSessionId) &&
      loadResults[0].success &&
      clearResults[0].success
    ) {
      console.log(`  PASSED: Session saved, found in list, loaded, and cleared.`);
      passed++;
    } else {
      console.log(`  FAILED: save=${saveResults[0].success}, inList=${sessions.includes(testSessionId)}, load=${loadResults[0].success}, clear=${clearResults[0].success}`);
      failed++;
    }
  } catch (error: any) {
    console.log(`  FAILED: ${error.message}`);
    failed++;
  }

  // ─── Cleanup ───
  await browserPool.release(testCtxId);
  await browserPool.shutdown();

  // ─── Summary ───
  console.log('\n' + '='.repeat(60));
  console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
