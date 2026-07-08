/**
 * AuraOS Headless Browser API - Type Definitions
 * Contracts for browser actions, scraping results, and session management.
 */

// ─── Browser Action Types ───

export type BrowserActionType =
  | 'navigate'
  | 'get_html'
  | 'get_text'
  | 'click'
  | 'type'
  | 'select'
  | 'submit'
  | 'screenshot'
  | 'evaluate'
  | 'wait_for_selector'
  | 'get_attribute'
  | 'save_session'
  | 'load_session'
  | 'clear_session';

export interface BrowserAction {
  type: BrowserActionType;
  /** CSS selector or XPath for targeted actions */
  selector?: string;
  /** URL for navigation */
  url?: string;
  /** Text to type */
  text?: string;
  /** Option value for select dropdowns */
  value?: string;
  /** JavaScript to evaluate in page context */
  script?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Wait for navigation after action */
  waitForNavigation?: boolean;
}

export interface BrowserActionResult {
  action: BrowserActionType;
  success: boolean;
  /** Returned data (HTML string, text, attribute value, screenshot base64, eval result) */
  data?: string | Record<string, unknown> | null;
  /** Error message if action failed */
  error?: string;
  /** Page URL after the action completes */
  currentUrl?: string;
  /** Duration of the action in ms */
  durationMs: number;
}

export interface BrowserSession {
  /** Session key scoped to agent or user ID */
  sessionId: string;
  /** Serialized localStorage contents */
  localStorage: Record<string, string>;
  /** Serialized sessionStorage contents */
  sessionStorage: Record<string, string>;
  /** Serialized cookies */
  cookies: SerializedCookie[];
  /** When session was last saved */
  savedAt: string;
}

export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

// ─── Context Pool Types ───

export interface ContextPoolConfig {
  /** Maximum number of simultaneous browser contexts */
  maxContexts: number;
  /** Default page timeout in ms */
  defaultTimeoutMs: number;
  /** Launch browser in headless mode */
  headless: boolean;
  /** Default viewport */
  viewport?: { width: number; height: number };
}

export const DEFAULT_POOL_CONFIG: ContextPoolConfig = {
  maxContexts: 5,
  defaultTimeoutMs: 30_000,
  headless: true,
  viewport: { width: 1280, height: 720 },
};
