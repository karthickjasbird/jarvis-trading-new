/**
 * Market Intelligence Feed — Real-World Context for Trading Decisions
 * 
 * Fetches live data that no amount of candlestick analysis can provide:
 * - Fear & Greed Index (investor sentiment)
 * - Funding Rates (leverage imbalance on futures)
 * - BTC Dominance (altcoin season detector)
 * - Top Gainers/Losers (momentum shifts)
 * 
 * This data is injected into the Scholar agent's context
 * so it can make informed fundamental assessments.
 */

export interface MarketIntelligence {
  fearGreed: {
    value: number;
    label: string;          // "Extreme Fear", "Fear", "Neutral", "Greed", "Extreme Greed"
    trend: string;          // "rising", "falling", "stable"
    yesterday: number;
  };
  fundingRates: Array<{
    symbol: string;
    rate: number;           // positive = longs pay shorts, negative = shorts pay longs
    interpretation: string; // "overleveraged_long", "overleveraged_short", "balanced"
  }>;
  btcDominance: {
    value: number;
    trend: string;          // "rising" = alts bleeding, "falling" = alt season
  };
  topMovers: {
    gainers: Array<{ symbol: string; change: number }>;
    losers: Array<{ symbol: string; change: number }>;
  };
  timestamp: string;
  summary: string;
}

export class MarketIntelligenceEngine {

  /**
   * Fetch the Fear & Greed Index from Alternative.me
   */
  async fetchFearGreed(): Promise<MarketIntelligence['fearGreed']> {
    try {
      const res = await fetch('https://api.alternative.me/fng/?limit=2');
      const data = await res.json();

      if (data?.data?.length >= 2) {
        const today = data.data[0];
        const yesterday = data.data[1];
        const value = parseInt(today.value);
        const yesterdayValue = parseInt(yesterday.value);

        let label = 'Neutral';
        if (value <= 20) label = 'Extreme Fear';
        else if (value <= 40) label = 'Fear';
        else if (value <= 60) label = 'Neutral';
        else if (value <= 80) label = 'Greed';
        else label = 'Extreme Greed';

        const diff = value - yesterdayValue;
        let trend = 'stable';
        if (diff > 5) trend = 'rising';
        else if (diff < -5) trend = 'falling';

        return { value, label, trend, yesterday: yesterdayValue };
      }
    } catch (err: any) {
      console.error('[INTEL] Failed to fetch Fear & Greed:', err.message);
    }

    return { value: 50, label: 'Neutral', trend: 'stable', yesterday: 50 };
  }

  /**
   * Fetch Funding Rates from Binance Futures (public, no auth needed)
   */
  async fetchFundingRates(): Promise<MarketIntelligence['fundingRates']> {
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
    const rates: MarketIntelligence['fundingRates'] = [];

    try {
      const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex');
      const data = await res.json();

      if (Array.isArray(data)) {
        for (const item of data) {
          if (symbols.includes(item.symbol)) {
            const rate = parseFloat(item.lastFundingRate) * 100; // Convert to percentage
            let interpretation = 'balanced';
            if (rate > 0.03) interpretation = 'overleveraged_long';
            else if (rate < -0.03) interpretation = 'overleveraged_short';

            rates.push({
              symbol: item.symbol.replace('USDT', '/USDT'),
              rate: parseFloat(rate.toFixed(4)),
              interpretation,
            });
          }
        }
      }
    } catch (err: any) {
      console.error('[INTEL] Failed to fetch funding rates:', err.message);
    }

    return rates;
  }

  /**
   * Fetch BTC Dominance from CoinGecko (public, no auth)
   */
  async fetchBTCDominance(): Promise<MarketIntelligence['btcDominance']> {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/global');
      const data = await res.json();

      if (data?.data?.market_cap_percentage?.btc) {
        const value = parseFloat(data.data.market_cap_percentage.btc.toFixed(2));
        // We can't reliably get historical for trend without more calls,
        // so we'll infer from the value itself
        let trend = 'stable';
        if (value > 55) trend = 'rising'; // BTC dominant = alts weak
        else if (value < 45) trend = 'falling'; // Alts gaining = alt season

        return { value, trend };
      }
    } catch (err: any) {
      console.error('[INTEL] Failed to fetch BTC dominance:', err.message);
    }

    return { value: 50, trend: 'stable' };
  }

  /**
   * Fetch top gainers and losers from Binance 24h ticker
   */
  async fetchTopMovers(): Promise<MarketIntelligence['topMovers']> {
    try {
      const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
      const data = await res.json();

      // Filter to USDT pairs only, exclude stablecoins
      const usdtPairs = data
        .filter((t: any) =>
          t.symbol.endsWith('USDT') &&
          !['USDCUSDT', 'BUSDUSDT', 'DAIUSDT', 'TUSDUSDT', 'FDUSDUSDT'].includes(t.symbol) &&
          parseFloat(t.quoteVolume) > 10_000_000 // Min $10M volume
        )
        .map((t: any) => ({
          symbol: t.symbol.replace('USDT', '/USDT'),
          change: parseFloat(t.priceChangePercent),
        }));

      // Sort for gainers and losers
      const sorted = [...usdtPairs].sort((a: any, b: any) => b.change - a.change);

      return {
        gainers: sorted.slice(0, 3),
        losers: sorted.slice(-3).reverse(),
      };
    } catch (err: any) {
      console.error('[INTEL] Failed to fetch top movers:', err.message);
    }

    return { gainers: [], losers: [] };
  }

  /**
   * Run the full intelligence gathering pipeline
   */
  async gather(): Promise<MarketIntelligence> {
    console.log('[INTEL] 📡 Gathering market intelligence...');

    // Fetch all data in parallel for speed
    const [fearGreed, fundingRates, btcDominance, topMovers] = await Promise.all([
      this.fetchFearGreed(),
      this.fetchFundingRates(),
      this.fetchBTCDominance(),
      this.fetchTopMovers(),
    ]);

    // Build human-readable summary
    const summary = this.buildSummary(fearGreed, fundingRates, btcDominance, topMovers);

    console.log(`[INTEL] ✅ Fear: ${fearGreed.value} (${fearGreed.label}) | BTC.D: ${btcDominance.value}% | Funding: ${fundingRates.map(f => `${f.symbol}=${f.rate}%`).join(', ')}`);

    return {
      fearGreed,
      fundingRates,
      btcDominance,
      topMovers,
      timestamp: new Date().toISOString(),
      summary,
    };
  }

  /**
   * Build summary string for injection into Scholar agent
   */
  private buildSummary(
    fg: MarketIntelligence['fearGreed'],
    fr: MarketIntelligence['fundingRates'],
    btcD: MarketIntelligence['btcDominance'],
    movers: MarketIntelligence['topMovers']
  ): string {
    const lines: string[] = ['=== LIVE MARKET INTELLIGENCE ==='];

    // Fear & Greed
    lines.push(`Fear & Greed Index: ${fg.value}/100 (${fg.label}) — ${fg.trend} trend (yesterday: ${fg.yesterday})`);

    // Interpretation
    if (fg.value <= 25) {
      lines.push('  ⚠️ EXTREME FEAR — historically a good buying zone (contrarian signal)');
    } else if (fg.value >= 75) {
      lines.push('  ⚠️ EXTREME GREED — historically a selling zone (potential top)');
    }

    // BTC Dominance
    lines.push(`BTC Dominance: ${btcD.value}% (${btcD.trend})`);
    if (btcD.trend === 'falling') {
      lines.push('  📊 Falling BTC.D = potential alt season — altcoins may outperform');
    } else if (btcD.trend === 'rising') {
      lines.push('  📊 Rising BTC.D = capital flowing to BTC — altcoins may bleed');
    }

    // Funding Rates
    const overleveraged = fr.filter(f => f.interpretation !== 'balanced');
    if (overleveraged.length > 0) {
      lines.push(`Funding Rate Alerts:`);
      for (const f of overleveraged) {
        if (f.interpretation === 'overleveraged_long') {
          lines.push(`  ⚠️ ${f.symbol}: +${f.rate}% — heavily long (potential squeeze DOWN)`);
        } else {
          lines.push(`  ⚠️ ${f.symbol}: ${f.rate}% — heavily short (potential squeeze UP)`);
        }
      }
    } else {
      lines.push('Funding Rates: All balanced — no extreme leverage detected');
    }

    // Top Movers
    if (movers.gainers.length > 0) {
      lines.push(`Top Gainers: ${movers.gainers.map(g => `${g.symbol} +${g.change.toFixed(1)}%`).join(', ')}`);
    }
    if (movers.losers.length > 0) {
      lines.push(`Top Losers: ${movers.losers.map(l => `${l.symbol} ${l.change.toFixed(1)}%`).join(', ')}`);
    }

    return lines.join('\n');
  }
}
