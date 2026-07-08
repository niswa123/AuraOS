/**
 * AuraOS Headless Browser API - Session Manager
 * Persists and restores browser session data (cookies, localStorage,
 * sessionStorage) to enable stateful automated login routines
 * that survive across separate executions.
 */

import path from 'path';
import fs from 'fs/promises';
import { BrowserContext } from 'playwright';
import type { BrowserSession, SerializedCookie } from './types.js';

const SESSIONS_DIR = path.join(process.cwd(), '.auraos', 'browser-sessions');

/**
 * Ensure the sessions directory exists.
 */
async function ensureDir() {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

/**
 * Save the full browser session (cookies + storage) to disk.
 * Associates the session with a sessionId (e.g., agent ID or user key).
 */
export async function saveSession(
  context: BrowserContext,
  sessionId: string
): Promise<BrowserSession> {
  await ensureDir();

  // 1. Capture cookies from the context
  const rawCookies = await context.cookies();
  const cookies: SerializedCookie[] = rawCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires ?? -1,
    httpOnly: c.httpOnly ?? false,
    secure: c.secure ?? false,
    sameSite: c.sameSite as SerializedCookie['sameSite'],
  }));

  // 2. Capture localStorage and sessionStorage from the active page
  let localStorage: Record<string, string> = {};
  let sessionStorage: Record<string, string> = {};

  const pages = context.pages();
  if (pages.length > 0) {
    const page = pages[0];
    try {
      localStorage = await page.evaluate(() => {
        const data: Record<string, string> = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i)!;
          data[key] = window.localStorage.getItem(key)!;
        }
        return data;
      });

      sessionStorage = await page.evaluate(() => {
        const data: Record<string, string> = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i)!;
          data[key] = window.sessionStorage.getItem(key)!;
        }
        return data;
      });
    } catch {
      // Page may be on about:blank or restricted origin — silently skip
    }
  }

  const session: BrowserSession = {
    sessionId,
    localStorage,
    sessionStorage,
    cookies,
    savedAt: new Date().toISOString(),
  };

  // Persist to disk as JSON
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');

  console.log(
    `[Browser Session] Session "${sessionId}" saved — ` +
    `${cookies.length} cookies, ` +
    `${Object.keys(localStorage).length} localStorage keys`
  );

  return session;
}

/**
 * Restore a previously saved session into a BrowserContext.
 * Injects cookies and localStorage so subsequent requests are authenticated.
 */
export async function loadSession(
  context: BrowserContext,
  sessionId: string
): Promise<BrowserSession | null> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);

  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const session: BrowserSession = JSON.parse(raw);

    // 1. Restore cookies
    if (session.cookies.length > 0) {
      await context.addCookies(session.cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      })));
    }

    // 2. Restore localStorage via page init script
    // This script runs before every page load in this context
    if (Object.keys(session.localStorage).length > 0) {
      await context.addInitScript((storageData: Record<string, string>) => {
        for (const [key, value] of Object.entries(storageData)) {
          try { window.localStorage.setItem(key, value); } catch {}
        }
      }, session.localStorage);
    }

    console.log(
      `[Browser Session] Session "${sessionId}" loaded — ` +
      `${session.cookies.length} cookies, ` +
      `${Object.keys(session.localStorage).length} localStorage keys`
    );

    return session;
  } catch {
    console.warn(`[Browser Session] No session found for "${sessionId}". Starting fresh.`);
    return null;
  }
}

/**
 * Delete a saved session file from disk.
 */
export async function clearSession(sessionId: string): Promise<boolean> {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  try {
    await fs.unlink(filePath);
    console.log(`[Browser Session] Session "${sessionId}" cleared.`);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all saved session IDs.
 */
export async function listSessions(): Promise<string[]> {
  await ensureDir();
  const files = await fs.readdir(SESSIONS_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}
