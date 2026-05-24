/**
 * Jarvis Trading Curriculum — Phase 4
 *
 * 20 dense, principles-focused lessons designed to be embedded into the
 * user's vector memory so Scholar's recall surfaces them during decisions.
 *
 * Each lesson is keyword-rich on purpose — cosine similarity against
 * queries like "RSI overbought trending market" or "counter-trend bearish
 * regime" needs to find the relevant principle reliably.
 *
 * Tagged with `[CURRICULUM ...]` prefix so JarvisMemories UI can detect
 * them and the user can re-enroll / clear curriculum independently of
 * other memories (web intel, trade lessons, user rules).
 *
 * To add: append to CURRICULUM array. To re-deliver: POST /api/memory/learn-curriculum.
 */

export interface CurriculumLesson {
  id: string;
  class: number;
  title: string;
  category: 'foundation' | 'ta' | 'risk' | 'entry' | 'exit' | 'psych' | 'regime' | 'crypto' | 'meta';
  keywords: string[];
  body: string;
}

export const CURRICULUM: CurriculumLesson[] = [
  // ─── Class 1: Foundation ──────────────────────────────────────
  {
    id: 'foundation-1',
    class: 1,
    title: 'Candlesticks are the story of supply and demand',
    category: 'foundation',
    keywords: ['candlestick', 'OHLC', 'price action', 'wick', 'body', 'rejection'],
    body: `A candlestick is four numbers: Open, High, Low, Close. The BODY shows the battle's net result (green = buyers won, red = sellers won). The WICKS show the price levels that were tested but rejected. A long upper wick on a green candle means buyers couldn't hold the highs — sellers stepped in and pushed price back down. A long lower wick on a green candle means sellers tried to push down but buyers absorbed everything and reclaimed control. The size of the body relative to wicks tells you conviction: large body + small wicks = strong directional move; small body + large wicks = indecision (often near reversal points). Doji (open=close) at swing highs or lows are particularly significant — they're the market saying "we're not sure anymore."`,
  },
  {
    id: 'foundation-2',
    class: 1,
    title: 'Trend identification: higher highs and lower lows',
    category: 'foundation',
    keywords: ['trend', 'higher high', 'lower low', 'uptrend', 'downtrend', 'range', 'TRENDING_UP', 'TRENDING_DOWN'],
    body: `A market is in one of three states: TRENDING_UP (higher highs + higher lows), TRENDING_DOWN (lower highs + lower lows), or RANGING (sideways within a band). The biggest mistake retail traders make is fighting the trend — buying in a downtrend hoping for a "bounce" or shorting in an uptrend looking for a "top." The trend is your friend until it bends. A trend ends only when price clearly breaks the prior swing high (in downtrend) or swing low (in uptrend) AND establishes a counter-direction structure. Two failed higher highs in a row is a warning. A break of a clearly defined trendline with high volume is confirmation. Until then, trade WITH the trend.`,
  },

  // ─── Class 2: Indicators ──────────────────────────────────────
  {
    id: 'ta-1',
    class: 2,
    title: 'RSI lies in trending markets',
    category: 'ta',
    keywords: ['RSI', 'overbought', 'oversold', 'trending', 'momentum', 'mean reversion'],
    body: `RSI > 70 = "overbought" and RSI < 30 = "oversold" is only true in RANGING markets. In TRENDING_UP, RSI can stay above 70 for weeks while price keeps making new highs. Selling because RSI hit 75 in an uptrend is a classic retail mistake. Use RSI levels conditionally on regime: in RANGING markets, fade extremes; in TRENDING_UP, RSI > 70 is CONFIRMATION of momentum, not a sell signal — look for entry on dips back toward 50. In TRENDING_DOWN, RSI < 30 is confirmation, not a buy signal. The actionable RSI signal in trends is DIVERGENCE (price makes new high, RSI does not — momentum weakening) — and even that is a warning, not a trigger.`,
  },
  {
    id: 'ta-2',
    class: 2,
    title: 'MACD is confirmation, not a trigger',
    category: 'ta',
    keywords: ['MACD', 'histogram', 'divergence', 'momentum', 'crossover', 'confirmation'],
    body: `MACD crossovers fire LATE. By the time the signal line crosses the MACD line, the move is often half over. Treat crossovers as confirmation that a move is underway, not as your entry signal. The most useful MACD information is the HISTOGRAM rate of change: histogram expanding = momentum accelerating; histogram contracting = momentum fading even if price still moves. Divergence (price new high but MACD histogram new lower high) is a real warning signal worth respecting. Bullish setup: histogram bottomed and is now contracting (less negative) while price still falling. Don't use MACD in isolation — combine with price structure and at least one other confluence factor.`,
  },
  {
    id: 'ta-3',
    class: 2,
    title: 'ATR-based stops: let volatility size your risk',
    category: 'ta',
    keywords: ['ATR', 'volatility', 'stop loss', 'position sizing', 'noise'],
    body: `A fixed-percent stop (e.g., 2% from entry) ignores market volatility. In a quiet market, 2% is far from price action — stop never gets hit. In a volatile market, 2% is normal noise — stop hits constantly. Use ATR (Average True Range) over 14 periods. Standard practice: stop = 1.5× to 2× ATR from entry. Take-profit at 3× to 4× ATR (which naturally gives you 2:1 R/R minimum). In TRENDING markets, stops can be tighter (1.5× ATR) because retracements are shallower. In RANGING or VOLATILE regimes, widen to 2.5× ATR — noise will stop you out otherwise. The principle: your stop should be at a level where, if hit, the trade thesis is genuinely invalidated — not just noise.`,
  },

  // ─── Class 3: Risk Management ─────────────────────────────────
  {
    id: 'risk-1',
    class: 3,
    title: 'Kelly Criterion: how much to bet on each trade',
    category: 'risk',
    keywords: ['Kelly', 'position sizing', 'win rate', 'edge', 'risk of ruin'],
    body: `Kelly formula: f = (p × b - q) / b, where p = win rate, q = 1 - p, b = avg_win / avg_loss. At 56% win rate with 2:1 reward-to-risk: f = (0.56 × 2 - 0.44) / 2 = 0.34, meaning Kelly says risk 34% per trade. NEVER use full Kelly — variance is brutal. Standard practice: half-Kelly or quarter-Kelly (17% or 8% per trade for the above stats). Most pros risk 1-2% per trade — far below Kelly — because survival matters more than optimization. The lesson: your position size should be derived from your stats (win rate, R:R), not from a feeling. If you don't know your own win rate, you can't size correctly. Track every trade.`,
  },
  {
    id: 'risk-2',
    class: 3,
    title: 'The R:R math: why 1:1 loses at 56% win rate',
    category: 'risk',
    keywords: ['risk reward', 'R/R', 'expectancy', 'breakeven', 'edge'],
    body: `Expectancy = (win_rate × avg_win) - (loss_rate × avg_loss). At 56% win rate with 1:1 R/R (avg_win = avg_loss = $X), expectancy = 0.56X - 0.44X = 0.12X per trade. Look profitable? You forgot fees and slippage. Round-trip fees are typically 0.1-0.2% on crypto. On a $7000 position that's $7-14 in fees per trade. If your avg win is $5, you're underwater after fees. At 1.5:1 R/R (avg_win = 1.5X, avg_loss = X), expectancy = 0.56 × 1.5X - 0.44X = 0.40X per trade — 3x better. At 2:1 R/R, expectancy = 0.68X — 5x better. The takeaway: tight TP/SL ratios destroy edge even at decent win rates. Always require minimum 1.5:1 R/R; prefer 2:1 or better.`,
  },
  {
    id: 'risk-3',
    class: 3,
    title: 'Counter-trend traps in bearish regimes',
    category: 'risk',
    keywords: ['counter-trend', 'bearish', 'TRENDING_DOWN', 'bounce', 'fakeout', 'momentum trap'],
    body: `In a TRENDING_DOWN market, individual coins often produce "STRONG_BUY" technical signals as they bounce off oversold levels or test broken support from above. These look great in isolation — confluence across timeframes, bullish patterns, etc. They're usually TRAPS. In a bearish overall market, the path of least resistance is DOWN, and counter-trend rallies typically retrace 38-61% before resuming the downtrend. Take counter-trend trades only when: (1) the bounce has CLEAR resistance levels with definable risk, (2) you're targeting a small piece of the bounce (not the next leg up), and (3) your conviction is high (≥75%) because you're fighting the dominant flow. Default in TRENDING_DOWN: skip longs, prefer shorts, or sit out. Don't be the bag holder.`,
  },

  // ─── Class 4: Entry Discipline ────────────────────────────────
  {
    id: 'entry-1',
    class: 4,
    title: 'A+ setups: would you bet your own money on this?',
    category: 'entry',
    keywords: ['A+ setup', 'conviction', 'selectivity', 'skip', 'high probability'],
    body: `Professional traders skip 90%+ of "signals." The difference between A+, B+, and C setups is conviction across multiple factors. An A+ setup has: (1) trend alignment across at least 2 of 3 timeframes (1H, 4H, 1D), (2) volume confirming the move (not faded), (3) regime supporting the strategy type (momentum strategy in trending, mean reversion in ranging), (4) no major news event in the next 24h, (5) clear invalidation level (defined SL with reasonable distance). A B+ has 3-4 of these. A C has 1-2. The hardest skill in trading isn't finding setups — it's saying "no" to B and C setups. If you don't have the conviction to bet your own money on this trade, set confidence below 60 and let the swarm skip it. Skipping marginal trades is how losing systems become winning ones.`,
  },
  {
    id: 'entry-2',
    class: 4,
    title: 'Confluence beats any single indicator',
    category: 'entry',
    keywords: ['confluence', 'multi-timeframe', 'alignment', 'signal', 'high probability'],
    body: `A single indicator firing is a guess. Three independent indicators firing in the same direction is a setup. Multi-timeframe confluence: trend on 1D + trend on 4H + reversal pattern on 1H = high-probability entry. Indicator confluence: RSI divergence + MACD histogram inflection + price bouncing off prior support + volume spike. Never enter on a single signal. Ask: "What needs to be true on multiple timeframes and from multiple data sources for this trade to work?" If you can list 3-4 independent confirming factors, you have a setup. If you can list only 1, you have a guess. The market punishes guesses.`,
  },

  // ─── Class 5: Exit Discipline ─────────────────────────────────
  {
    id: 'exit-1',
    class: 5,
    title: 'Cut losses fast, let winners run',
    category: 'exit',
    keywords: ['stop loss', 'cut losses', 'let winners run', 'asymmetric', 'exit'],
    body: `The single most important rule in trading. Most retail traders do the OPPOSITE: they cut winners early (locking in tiny profits to "feel" the win) and let losers run (refusing to admit a mistake, hoping it'll come back). This produces a "win-rate-high-but-profit-low" trap. To break it: define your stop BEFORE entry, never move it against you, and let your winner trail. The mathematical reason: in a normal distribution of outcomes, the rare big winners are what produce edge. If you cut every winner at +0.5R, you'll never capture the +5R home runs that make the system profitable. Asymmetric outcomes (small losses, large wins) is the structural definition of a winning system. Be willing to take many small losses to catch the few big wins.`,
  },
  {
    id: 'exit-2',
    class: 5,
    title: 'Partial profits + breakeven shift + trailing stops',
    category: 'exit',
    keywords: ['partial close', 'breakeven', 'trailing stop', 'TP1', 'TP2', 'scaling out'],
    body: `Pro exit structure: when position hits first target (~1R or fixed dollar amount), close 50% to lock partial profit. Simultaneously move stop loss to breakeven (entry price) on remainder — the remaining 50% now has ZERO risk. Activate a trailing stop on the remainder (usually 2-3× ATR distance). The remaining 50% can either retrace to breakeven (exit for free) or run to multi-R home run. This structure produces asymmetric outcomes: every trade either nets at least 0.5R (if remainder stops at breakeven) or 0.5R + multi-R (if it runs). The expected value of "let remainder ride with trailing" beats "close 100% at first target" in any market with non-trivial trend persistence.`,
  },
  {
    id: 'exit-3',
    class: 5,
    title: 'Never move a stop against you',
    category: 'exit',
    keywords: ['stop loss', 'discipline', 'risk management', 'hoping', 'averaging down'],
    body: `Once a stop is set, it moves only in your favor (trailing up on longs, down on shorts) — never AGAINST you. Widening a stop because price is approaching it is admitting your thesis was wrong AND adding more risk. "It'll come back" is the most expensive sentence in trading. Similarly, averaging down on a losing trade ("doubling down") is increasing risk on a position the market has already told you is wrong. The discipline: when you set the stop, you've defined the price level at which your thesis is invalidated. If price reaches that level, the thesis IS invalidated. Exit. Take the loss. Move on. The trader who never moves stops against themselves survives long enough to find the wins.`,
  },

  // ─── Class 6: Psychology ──────────────────────────────────────
  {
    id: 'psych-1',
    class: 6,
    title: 'Process over outcome',
    category: 'psych',
    keywords: ['process', 'outcome', 'discipline', 'long-term', 'sample size'],
    body: `A good trade is one taken with a positive expected value and proper risk management — REGARDLESS of whether it wins. A bad trade is one taken without edge or without discipline — regardless of whether it wins. In the short term, luck dominates results. A bad process can win for weeks (luck). A good process can lose for weeks (variance). Judge yourself on PROCESS: did I take only A+ setups? Did I size correctly? Did I respect my stops? Did I let winners run? If yes, you traded well, even on losing days. If no, you traded poorly, even on winning days. Sample size matters: at 50+ trades, process quality starts to dominate luck. Track your process metrics, not just P&L.`,
  },
  {
    id: 'psych-2',
    class: 6,
    title: 'The patience to skip — most signals are noise',
    category: 'psych',
    keywords: ['patience', 'overtrading', 'discipline', 'skip', 'wait'],
    body: `Pro traders make 1-3 trades per week. Retail traders make 10+ per day. Why the difference? Pros wait for setups that align across multiple factors. Retail chases anything that moves. The math is brutal: every additional trade adds variance, fees, and emotional fatigue. If you have an edge of 0.4R per trade, taking 10 trades a week yields 4R; taking 50 trades a week yields 20R but with 5x the variance and 5x the fees. Net: similar return, much worse experience. The strongest trading skill is the ability to do NOTHING. To watch markets all day and not trade. To see a setup that's 70% there and skip it because it's not 90% there. Patience is the differentiator.`,
  },

  // ─── Class 7: Regimes ─────────────────────────────────────────
  {
    id: 'regime-1',
    class: 7,
    title: 'Match strategy to regime: momentum vs mean-reversion',
    category: 'regime',
    keywords: ['regime', 'momentum', 'mean reversion', 'trending', 'ranging', 'ADX', 'strategy selection'],
    body: `Two strategy archetypes dominate: MOMENTUM (buy strength, sell weakness — works in TRENDING regimes) and MEAN_REVERSION (buy weakness, sell strength — works in RANGING regimes). Using the wrong strategy for the regime is how systems blow up. In TRENDING markets, mean-reversion fails — every "overbought" is a buy opportunity (you'll keep losing if you fade strength). In RANGING markets, momentum fails — every breakout is a fakeout (you'll keep losing if you buy breakouts). ADX is the regime classifier: ADX > 25 = trending (use momentum); ADX < 20 = ranging (use mean-reversion); 20-25 = transition (reduce size or skip). Always check regime FIRST, then pick strategy. The right strategy in the wrong regime is the wrong strategy.`,
  },
  {
    id: 'regime-2',
    class: 7,
    title: 'TRENDING_DOWN: prefer shorts or sit out — do not force longs',
    category: 'regime',
    keywords: ['bear market', 'TRENDING_DOWN', 'shorts', 'sit out', 'long bias', 'crypto winter'],
    body: `In a TRENDING_DOWN regime (often called "bear market"), longs face structural headwinds. Bounces are sold. Support levels break. Sentiment is fearful. The natural edge is on the SHORT side or in cash. Retail traders fight this — they're conditioned to "buy the dip" and lose progressively because every dip in a downtrend is just a stop on the way lower. If your system can only go long, the right move in TRENDING_DOWN is to SIT OUT (no positions = no losses). If you can short, that's where the edge is. Counter-trend longs in bear regimes require exceptional conviction (≥75%), tight risk, and small targets (don't expect a bottom). Default position in TRENDING_DOWN: reduce trade count by 50-80%.`,
  },

  // ─── Class 8: Crypto-specific ─────────────────────────────────
  {
    id: 'crypto-1',
    class: 8,
    title: 'Funding rates are a contra-indicator',
    category: 'crypto',
    keywords: ['funding rate', 'perpetual', 'long squeeze', 'short squeeze', 'contrarian', 'crowded'],
    body: `On crypto perpetual futures, the funding rate balances long vs short demand. Persistently HIGH positive funding (> 0.05% per 8h or so) means longs are paying shorts — too many longs are crowded in, signaling local complacency and risk of a long squeeze (cascade liquidations down). Persistently NEGATIVE funding (more than -0.03% per 8h) means shorts are paying longs — too many shorts, signaling capitulation fear and potential for a short squeeze (cascade liquidations up). Treat extreme funding as a contra-indicator: very high funding = look for shorts; very negative funding = look for longs. Combined with price structure, funding is one of the strongest crypto-specific signals — it's data on POSITIONING that traditional markets don't expose.`,
  },
  {
    id: 'crypto-2',
    class: 8,
    title: 'BTC dominance dictates altcoin behavior',
    category: 'crypto',
    keywords: ['BTC dominance', 'BTC.D', 'altcoin', 'alt season', 'capital rotation'],
    body: `BTC dominance (BTC.D) measures BTC's share of total crypto market cap. RISING BTC.D = capital is rotating INTO BTC, OUT of alts. Alts underperform in this regime — even alts with bullish individual setups will lag. FALLING BTC.D with rising total market cap = "alt season" — alts outperform BTC. When BTC.D is rising and you have a "STRONG_BUY" signal on an alt, dampen your conviction — you're fighting capital rotation. When BTC.D is falling and alts are strong, your alt trades benefit from a tailwind. Rule of thumb: in TRENDING_UP overall market + falling BTC.D, alt longs are highest-EV. In TRENDING_DOWN + rising BTC.D, alt longs are lowest-EV — capital is fleeing to BTC.`,
  },
  {
    id: 'crypto-3',
    class: 8,
    title: 'Fear & Greed index — use it inversely',
    category: 'crypto',
    keywords: ['fear and greed', 'sentiment', 'contrarian', 'extremes', 'capitulation'],
    body: `The Crypto Fear & Greed Index aggregates volatility, momentum, social sentiment, dominance, and survey data into a 0-100 score. Extremes are tradeable: < 20 (Extreme Fear) historically marks LOCAL BOTTOMS — exactly when retail is too scared to buy; > 80 (Extreme Greed) marks LOCAL TOPS — exactly when retail is FOMO-ing in. The lesson: when the index is at 28 (Fear), the market is fearful — but THAT is when high-conviction longs have the best entry prices. When index is at 75 (Greed), longs are riskiest because everyone's already long. Don't confuse "Greed" with "uptrend" — greed at 75 in a strong uptrend can still go higher, but the risk/reward asymmetry deteriorates as greed climbs.`,
  },

  // ─── Class 9: Meta — The System Over The Trade ────────────────
  {
    id: 'meta-1',
    class: 10,
    title: 'The system over the trade',
    category: 'meta',
    keywords: ['system', 'process', 'long term', 'edge', 'discipline'],
    body: `Trading is not about predicting the future — it's about executing a positive-expectancy system consistently over many trades. ANY individual trade is a coin-flip-with-edge: you can be right about the analysis and still lose. You can be wrong about the analysis and still win. The system over 100, 500, 1000 trades is what determines your wealth, not any single decision. This means: (1) follow your rules even when they feel wrong, (2) accept that variance produces losing streaks within a winning system, (3) judge yourself on rule-adherence not on individual P&L. The trader who follows a 1.4-expectancy system through a 10-loss streak becomes wealthy. The trader who abandons a 1.4-expectancy system after a 3-loss streak stays broke. Discipline > intelligence in trading.`,
  },
];

/** Convert a lesson into the canonical memory format for embedding. */
export function lessonToMemoryText(lesson: CurriculumLesson): string {
  return `[CURRICULUM Class ${lesson.class} · ${lesson.category}] ${lesson.title}\n\nKeywords: ${lesson.keywords.join(', ')}\n\n${lesson.body}`;
}
