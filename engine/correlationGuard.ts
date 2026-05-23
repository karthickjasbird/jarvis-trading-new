/**
 * Correlation Guard — Prevents betting on the same direction in correlated assets
 * 
 * If you already have a BTC long open, you shouldn't also long ETH and SOL
 * because they're 85%+ correlated. If BTC drops, they ALL drop.
 * 
 * Rule: Maximum 1 open position per correlation group.
 */

// Define correlation groups — assets that move together
const CORRELATION_GROUPS: Record<string, string[]> = {
  'layer1': ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'AVAX/USDT', 'BNB/USDT', 'NEAR/USDT', 'APT/USDT', 'SUI/USDT'],
  'memecoins': ['DOGE/USDT', 'SHIB/USDT', 'PEPE/USDT'],
  'infrastructure': ['LINK/USDT', 'DOT/USDT', 'ATOM/USDT'],
  'layer2': ['MATIC/USDT', 'ARB/USDT', 'OP/USDT'],
  'defi': ['INJ/USDT', 'SEI/USDT', 'TIA/USDT'],
  'xrp': ['XRP/USDT', 'ADA/USDT'],  // Payment tokens
};

export class CorrelationGuard {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Get the correlation group for a given symbol
   */
  getGroup(symbol: string): { groupName: string; members: string[] } | null {
    // Normalize symbol format
    const normalized = symbol.includes('/') ? symbol : symbol.replace('USDT', '/USDT');
    
    for (const [groupName, members] of Object.entries(CORRELATION_GROUPS)) {
      if (members.includes(normalized)) {
        return { groupName, members };
      }
    }
    return null; // Symbol not in any group — no restriction
  }

  /**
   * Check if a new trade is allowed based on existing open positions
   * Returns { allowed: boolean, reason: string, existingTrade?: any }
   */
  async checkTradeAllowed(symbol: string, side: 'buy' | 'sell', userId?: string): Promise<{
    allowed: boolean;
    reason: string;
    group?: string;
    existingSymbol?: string;
  }> {
    const group = this.getGroup(symbol);
    
    // If the symbol isn't in any group, allow it
    if (!group) {
      return { allowed: true, reason: 'Symbol not in any correlation group — no restriction.' };
    }

    try {
      // Fetch open trades for THIS user only
      let q = this.db.collection('trades')
        .where('status', '==', 'open');
      
      if (userId) {
        q = q.where('userId', '==', userId);
      }
      
      const openTradesSnapshot = await q.get();

      for (const doc of openTradesSnapshot.docs) {
        const trade = doc.data();
        const tradeSymbol = trade.symbol;
        
        // Normalize the symbol
        const normalizedTradeSymbol = tradeSymbol.includes('/') ? tradeSymbol : tradeSymbol.replace('USDT', '/USDT');
        
        // Check if any open trade is in the same correlation group AND same direction
        if (group.members.includes(normalizedTradeSymbol) && trade.side === side) {
          return {
            allowed: false,
            reason: `Blocked: Already have a ${side.toUpperCase()} position in ${normalizedTradeSymbol} (same '${group.groupName}' correlation group). Opening ${symbol} in the same direction would double your risk.`,
            group: group.groupName,
            existingSymbol: normalizedTradeSymbol,
          };
        }
      }

      return { allowed: true, reason: `No conflicting positions in '${group.groupName}' group.`, group: group.groupName };
    } catch (err: any) {
      console.error('[CORRELATION GUARD] Error checking trades:', err.message);
      // Fail-open: allow the trade if we can't check
      return { allowed: true, reason: 'Correlation check failed — allowing trade (fail-open).' };
    }
  }
}
