/**
 * TradingView Bridge — Project NEXUS Phase 4
 *
 * Attaches to a running Chrome instance (started with --remote-debugging-port=9222)
 * via Chrome DevTools Protocol and drives a TradingView tab: change symbol,
 * timeframe, screenshot the chart, and run arbitrary JS in the page context.
 *
 * Foundation for Phases 5 (TV-native indicators), 6 (Vision chart analysis),
 * and 7 (on-chart trade visualization).
 *
 * ── Launching Chrome with remote debugging ─────────────────────────────────
 * macOS — separate profile (so it doesn't clash with your normal Chrome):
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 \
 *     --user-data-dir="$HOME/chrome-debug"
 *
 * The --user-data-dir flag is REQUIRED if a normal Chrome is already running,
 * because Chrome refuses to enable remote debugging when another instance
 * holds the default profile. Open tradingview.com/chart in that new window
 * and log in once; the profile persists across launches.
 *
 * Override the URL with the CHROME_DEBUG_URL env var (default http://localhost:9222).
 */
import puppeteer, { Browser, Page } from 'puppeteer-core';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '1d' | '1w';

const TF_CODES: Record<Timeframe, string> = {
  '1m':  '1',   '5m':  '5',   '15m': '15',  '30m': '30',
  '1h':  '60',  '2h':  '120', '4h':  '240',
  '1d':  '1D',  '1w':  '1W',
};

export interface BridgeStatus {
  connected: boolean;
  browserURL: string;
  tradingViewURL: string | null;
  tabTitle: string | null;
  lastError: string | null;
}

export interface ScreenshotOptions {
  chartOnly?: boolean;            // Crop to the chart pane, no UI chrome
  type?: 'png' | 'jpeg';
  quality?: number;               // jpeg only
  fullPage?: boolean;
}

/**
 * One entry from the TradingView chart legend (top-left of the chart pane).
 * The first entry is usually the symbol's OHLC pane; subsequent entries are
 * indicators added to the chart (RSI, Ichimoku, Supertrend, Pine Scripts, ...).
 */
export interface ChartLegendItem {
  title: string;        // e.g. "RSI" / "Ichimoku Cloud" / "ETHUSDT"
  isSymbol: boolean;    // true for the main price pane (not an indicator)
  values: string[];     // Per-series values, e.g. ["Conversion 2073.50", "Base 2084.20"]
  rawText: string;      // Full text content — fallback for ad-hoc parsing
}

const TV_URL_PATTERNS = ['tradingview.com', 'tradingview.'];
// Tried in order — first match wins. TV changes its DOM occasionally;
// keep this list current as Phase 5 evolves.
const CHART_SELECTORS = [
  '.chart-container',
  '.chart-markup-table',
  '[data-name="legend-source-item"]',
];

/**
 * "BTC/USDT" → "BINANCE:BTCUSDT" (TradingView's symbol format).
 * Pass an already-prefixed symbol (e.g. "COINBASE:BTCUSD") and it's returned as-is.
 */
export function toTradingViewSymbol(symbol: string, exchange: string = 'BINANCE'): string {
  const cleaned = symbol.replace('/', '').toUpperCase();
  if (cleaned.includes(':')) return cleaned;
  return `${exchange}:${cleaned}`;
}

/**
 * "BINANCE:BTCUSDT" → "BTC/USDT" (ccxt/Binance format).
 */
export function toBinanceSymbol(tvSymbol: string): string {
  const raw = tvSymbol.split(':').pop() ?? tvSymbol;
  const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'USD'];
  for (const q of quotes) {
    if (raw.endsWith(q)) return `${raw.slice(0, -q.length)}/${q}`;
  }
  return raw;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class TradingViewBridge {
  private browser: Browser | null = null;
  private browserURL: string;
  private lastError: string | null = null;

  constructor(browserURL: string = 'http://localhost:9222') {
    this.browserURL = browserURL;
  }

  isConnected(): boolean {
    return this.browser !== null && this.browser.connected;
  }

  /**
   * Attach to a Chrome instance running with `--remote-debugging-port=9222`.
   * No-op if already connected.
   */
  async connect(): Promise<void> {
    if (this.isConnected()) return;
    try {
      this.browser = await puppeteer.connect({
        browserURL: this.browserURL,
        defaultViewport: null, // respect the actual window viewport
      });
      this.lastError = null;
      console.log(`[TVBridge] Attached to Chrome at ${this.browserURL}`);
    } catch (err: any) {
      this.lastError = err.message;
      this.browser = null;
      throw new Error(
        `Failed to attach to Chrome at ${this.browserURL}. ` +
        `Start Chrome with --remote-debugging-port=9222 (or set CHROME_DEBUG_URL). ` +
        `Original error: ${err.message}`
      );
    }
  }

  /** Detach from the browser. Does NOT close Chrome — it's the user's browser. */
  async disconnect(): Promise<void> {
    if (this.browser) {
      this.browser.disconnect();
      this.browser = null;
    }
  }

  /** First open tab pointing at TradingView, or null. */
  async findTradingViewTab(): Promise<Page | null> {
    if (!this.browser) return null;
    const pages = await this.browser.pages();
    return pages.find(p => TV_URL_PATTERNS.some(pat => p.url().includes(pat))) ?? null;
  }

  async healthCheck(): Promise<BridgeStatus> {
    const tab = this.isConnected() ? await this.findTradingViewTab() : null;
    return {
      connected: this.isConnected(),
      browserURL: this.browserURL,
      tradingViewURL: tab ? tab.url() : null,
      tabTitle: tab ? await tab.title() : null,
      lastError: this.lastError,
    };
  }

  private async requireTVTab(): Promise<Page> {
    if (!this.isConnected()) {
      throw new Error('Bridge not connected. POST /api/tradingview/connect first.');
    }
    const tab = await this.findTradingViewTab();
    if (!tab) {
      throw new Error('No TradingView tab found. Open tradingview.com/chart in your Chrome.');
    }
    return tab;
  }

  /**
   * Change the chart symbol via TradingView's "type-on-chart" symbol search.
   * Preserves the user's chart layout (no navigation).
   *
   * @param symbol - "BTC/USDT" or "BINANCE:BTCUSDT"
   * @param exchange - Used when `symbol` lacks a "EXCHANGE:" prefix
   */
  async setSymbol(symbol: string, exchange: string = 'BINANCE'): Promise<void> {
    const page = await this.requireTVTab();
    const tvSymbol = toTradingViewSymbol(symbol, exchange);

    await page.bringToFront();
    const chart = await this.locateChart(page);
    if (chart) await chart.click().catch(() => {});

    await page.keyboard.type(tvSymbol, { delay: 50 });
    await page.keyboard.press('Enter');
    await sleep(1500);
  }

  /**
   * Change timeframe via the "," interval-input shortcut.
   */
  async setTimeframe(tf: Timeframe): Promise<void> {
    const code = TF_CODES[tf];
    if (!code) throw new Error(`Unsupported timeframe: ${tf}`);
    const page = await this.requireTVTab();

    await page.bringToFront();
    const chart = await this.locateChart(page);
    if (chart) await chart.click().catch(() => {});

    await page.keyboard.type(',', { delay: 50 });
    await sleep(200);
    await page.keyboard.type(code, { delay: 50 });
    await page.keyboard.press('Enter');
    await sleep(1000);
  }

  /**
   * Screenshot the TradingView tab — PNG/JPEG Buffer.
   * Pass `chartOnly: true` to crop to the chart pane.
   * Output feeds straight into Gemini Vision for Phase 6.
   *
   * Phase 9 (#6) — sanity-check the page state before capturing. If Chrome
   * has been switched to a non-TradingView tab, or the page hasn't loaded a
   * chart route, return `null` so the caller can skip Vision entirely
   * instead of feeding a garbage screenshot to Gemini.
   *
   * Pass `expectedSymbol` (e.g. "ATOM/USDT") to additionally verify the chart
   * is actually showing the symbol we asked for. Mismatch → null.
   */
  async screenshot(opts: ScreenshotOptions & { expectedSymbol?: string } = {}): Promise<Buffer | null> {
    const page = await this.requireTVTab();
    const type = opts.type ?? 'png';
    const quality = type === 'jpeg' ? (opts.quality ?? 80) : undefined;

    // URL sanity — must be on a TradingView chart route, not Gmail/Twitter/etc.
    try {
      const url = page.url();
      if (!/tradingview\.com\/chart/i.test(url)) {
        console.warn(`[TV-BRIDGE] screenshot skipped — page is not a TV chart route (url=${url})`);
        return null;
      }
    } catch (err: any) {
      console.warn('[TV-BRIDGE] screenshot skipped — could not read page URL:', err?.message);
      return null;
    }

    // Symbol sanity — if caller passed an expectedSymbol, verify the chart's
    // current ticker matches. Uses the legend parser (cheap; same DOM read
    // we already do for Phase 5 indicator extraction).
    if (opts.expectedSymbol) {
      try {
        const legend = await this.getChartLegend();
        const symbolItem = legend.find((it: ChartLegendItem) => it.isSymbol);
        const onChart = (symbolItem?.title || '').toUpperCase();
        const expected = opts.expectedSymbol.replace('/', '').toUpperCase();
        if (onChart && !onChart.includes(expected)) {
          console.warn(`[TV-BRIDGE] screenshot skipped — chart shows "${onChart}" but expected "${expected}"`);
          return null;
        }
      } catch (err: any) {
        console.warn('[TV-BRIDGE] symbol-sanity legend read failed (proceeding anyway):', err?.message);
      }
    }

    if (opts.chartOnly) {
      const chart = await this.locateChart(page);
      if (chart) {
        return (await chart.screenshot({ type, quality })) as Buffer;
      }
      // chart pane not found — fall through to full-page capture
    }

    return (await page.screenshot({
      fullPage: opts.fullPage ?? false,
      type,
      quality,
    })) as Buffer;
  }

  /**
   * Run arbitrary JS in the TradingView page context.
   * Phase 5 uses this to scrape native TV indicator values from the DOM.
   */
  async evaluate<T>(fn: () => T): Promise<T> {
    const page = await this.requireTVTab();
    return (await page.evaluate(fn)) as T;
  }

  /**
   * Phase 5 — Scrape the chart legend (top-left of chart pane) for current
   * indicator values. TradingView's chart is a `<canvas>`, but the legend
   * (symbol OHLC + every added indicator) is rendered in the DOM and updates
   * live with the latest bar.
   *
   * Returns an array where the first item is the main symbol pane (isSymbol=true)
   * and subsequent items are indicators the user has added to their TV chart.
   *
   * Selectors use class-prefix matching (`[class*="..."]`) because TradingView
   * suffixes most class names with per-build hashes — only the prefix is stable.
   * `chart-gui-wrapper__legend` is the one fully-stable class name.
   */
  async getChartLegend(): Promise<ChartLegendItem[]> {
    const page = await this.requireTVTab();
    return (await page.evaluate(() => {
      const items: any[] = [];

      // ── Main symbol pane (OHLC) ────────────────────────────────────────
      const main = document.querySelector('[class*="legendMainSourceWrapper"]');
      if (main) {
        const titleEl = main.querySelector('[class*="titlesWrapper"]');
        const valuesEl = main.querySelector('[class*="valuesWrapper"]');
        items.push({
          title: (titleEl?.textContent ?? '').trim() || 'Symbol',
          isSymbol: true,
          values: valuesEl ? [(valuesEl.textContent ?? '').trim()].filter(Boolean) : [],
          rawText: (main.textContent ?? '').trim(),
        });
      }

      // ── Indicator items (one per study added to the chart) ─────────────
      const indicatorEls = document.querySelectorAll(
        '[class*="sourcesWrapper"] [class*="item-"][class*="study-"]'
      );
      indicatorEls.forEach(item => {
        // Skip hidden placeholder rows
        if ((item.getAttribute('class') ?? '').includes('blockHidden-')) return;
        const titleEl = item.querySelector('[class*="noWrapWrapper"]');
        const valuesEl = item.querySelector('[class*="valuesWrapper"]');
        const title = (titleEl?.textContent ?? '').trim() || '(unnamed)';
        const rawValues = (valuesEl?.textContent ?? '').trim();
        items.push({
          title,
          isSymbol: false,
          values: rawValues ? [rawValues] : [],
          rawText: (item.textContent ?? '').trim(),
        });
      });

      return items;
    })) as ChartLegendItem[];
  }

  /**
   * Phase 5 — Get one specific indicator from the chart legend by name
   * (case-insensitive substring match). Returns null if not found.
   *
   * @example getIndicatorValue('RSI') → { title: 'RSI', values: ['65.43'], ... }
   */
  async getIndicatorValue(name: string): Promise<ChartLegendItem | null> {
    const legend = await this.getChartLegend();
    const needle = name.toLowerCase();
    return legend.find(item =>
      !item.isSymbol && item.title.toLowerCase().includes(needle)
    ) ?? null;
  }

  /**
   * Diagnostic — probes the live TV DOM for anything that looks like a legend.
   * Used when `getChartLegend()` returns nothing so we can see what selectors
   * TradingView is actually using right now.
   *
   * NOTE: everything is inlined (no inner helper functions) because tsx
   * injects `__name` wrappers around named functions, which then crash when
   * the function gets stringified and run inside the browser page.
   */
  async _debugLegend(): Promise<any> {
    const page = await this.requireTVTab();
    return await page.evaluate(() => {
      // -- top frame --
      const topDataNames = new Set<string>();
      document.querySelectorAll('[data-name]').forEach(el => {
        const n = el.getAttribute('data-name');
        if (n) topDataNames.add(n);
      });
      const topLegendNames = Array.from(topDataNames).filter(n =>
        n.toLowerCase().includes('legend') || n.toLowerCase().includes('source')
      );
      const topClassFragments = new Set<string>();
      document.querySelectorAll('[class*="legend"], [class*="Legend"]').forEach(el => {
        (el.getAttribute('class') ?? '').split(/\s+/).forEach(c => {
          if (c.toLowerCase().includes('legend')) topClassFragments.add(c);
        });
      });

      const out: any = {
        topFrame: {
          legendDataNames: topLegendNames.slice(0, 30),
          legendClassFragments: Array.from(topClassFragments).slice(0, 30),
          totalDataNameElements: document.querySelectorAll('[data-name]').length,
        },
        iframes: [],
      };

      // -- iframes --
      document.querySelectorAll('iframe').forEach(frame => {
        const f = frame as HTMLIFrameElement;
        try {
          const doc = f.contentDocument;
          if (!doc) {
            out.iframes.push({ src: f.src, error: 'no contentDocument' });
            return;
          }
          const dataNames = new Set<string>();
          doc.querySelectorAll('[data-name]').forEach(el => {
            const n = el.getAttribute('data-name');
            if (n) dataNames.add(n);
          });
          const legendNames = Array.from(dataNames).filter(n =>
            n.toLowerCase().includes('legend') || n.toLowerCase().includes('source')
          );
          const classFragments = new Set<string>();
          doc.querySelectorAll('[class*="legend"], [class*="Legend"]').forEach(el => {
            (el.getAttribute('class') ?? '').split(/\s+/).forEach(c => {
              if (c.toLowerCase().includes('legend')) classFragments.add(c);
            });
          });
          out.iframes.push({
            src: f.src,
            legendDataNames: legendNames.slice(0, 30),
            legendClassFragments: Array.from(classFragments).slice(0, 30),
            totalDataNameElements: doc.querySelectorAll('[data-name]').length,
          });
        } catch (e: any) {
          out.iframes.push({ src: f.src, error: 'cross-origin or denied' });
        }
      });

      return out;
    });
  }

  /**
   * Phase 7 diagnostic — probe the chart's coordinate system. Returns
   * candidate selectors + bounds for the chart pane and price axis labels
   * so we can build price↔pixel calibration.
   */
  async _debugChartGeometry(): Promise<any> {
    const page = await this.requireTVTab();
    return await page.evaluate(() => {
      // Find all canvas elements with their bounding rects
      const canvases = Array.from(document.querySelectorAll('canvas')).map(c => {
        const r = c.getBoundingClientRect();
        return {
          parentClasses: (c.parentElement?.getAttribute('class') ?? '').split(/\s+/).slice(0, 4),
          width: c.width,
          height: c.height,
          x: Math.round(r.x),
          y: Math.round(r.y),
          rectWidth: Math.round(r.width),
          rectHeight: Math.round(r.height),
        };
      }).filter(c => c.rectWidth > 100 && c.rectHeight > 100); // ignore tiny ones

      // Find anything on the RIGHT side of the chart that looks like a price label
      const allText = Array.from(document.querySelectorAll('*')) as HTMLElement[];
      const priceLabels: any[] = [];
      for (const el of allText) {
        if (el.children.length > 0) continue; // leaf only
        const text = (el.textContent ?? '').trim();
        if (!text) continue;
        // Price-like: digits with optional thousand-comma + decimal
        if (!/^-?\d{1,3}(?:,\d{3})*\.\d{1,4}$|^-?\d+\.\d{1,4}$/.test(text)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 5 || r.height < 5) continue;
        if (r.x < window.innerWidth * 0.7) continue; // must be on right side
        priceLabels.push({
          text,
          parsed: parseFloat(text.replace(/,/g, '')),
          x: Math.round(r.x),
          y: Math.round(r.y + r.height / 2),
          parentClasses: (el.parentElement?.getAttribute('class') ?? '').split(/\s+/).slice(0, 3),
        });
      }
      priceLabels.sort((a, b) => a.y - b.y);

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        canvases,
        priceLabelCount: priceLabels.length,
        priceLabels: priceLabels.slice(0, 20),
      };
    });
  }

  /**
   * Diagnostic v2 — walk the legend wrapper to reverse-engineer TV's current
   * child layout (classes + data-names + text content per node).
   */
  async _debugLegendChildren(): Promise<any> {
    const page = await this.requireTVTab();
    return await page.evaluate(() => {
      const wrapper = document.querySelector('[class*="chart-gui-wrapper__legend"]');
      if (!wrapper) return { error: 'No chart-gui-wrapper__legend found' };

      const stack: Array<{ el: Element; depth: number; parent: any[] }> = [
        { el: wrapper, depth: 0, parent: [] },
      ];
      const root: any[] = [];
      stack[0].parent = root;

      while (stack.length) {
        const { el, depth, parent } = stack.pop()!;
        const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 6);
        const dn = el.getAttribute('data-name');
        const text = (el.textContent ?? '').trim().slice(0, 100);
        const node: any = {
          tag: el.tagName.toLowerCase(),
          classes: cls,
          ...(dn ? { dataName: dn } : {}),
          ...(text ? { text } : {}),
        };
        parent.push(node);
        if (depth < 4 && el.children.length > 0 && el.children.length <= 12) {
          node.children = [];
          // push in reverse so we pop them in document order
          for (let i = el.children.length - 1; i >= 0; i--) {
            stack.push({ el: el.children[i], depth: depth + 1, parent: node.children });
          }
        } else if (el.children.length > 12) {
          node.childCount = el.children.length;
        }
      }

      return root[0];
    });
  }

  private async locateChart(page: Page) {
    for (const sel of CHART_SELECTORS) {
      const handle = await page.$(sel);
      if (handle) return handle;
    }
    return null;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────
let bridgeInstance: TradingViewBridge | null = null;

export function getTradingViewBridge(browserURL?: string): TradingViewBridge {
  if (!bridgeInstance) {
    bridgeInstance = new TradingViewBridge(browserURL);
  }
  return bridgeInstance;
}
