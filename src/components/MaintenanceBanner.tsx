import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, Wifi, WifiOff } from 'lucide-react';

interface PriceFeedStatus {
  isConnected: boolean;
  isTradeFrozen: boolean;
  isMaintenanceWarning: boolean;
  maintenanceCountdownMinutes: number | null;
  reconnectAttempts: number;
  lastPriceUpdate: number;
  connectionUptime: number;
  symbolsTracked: number;
}

export function MaintenanceBanner() {
  const [status, setStatus] = useState<PriceFeedStatus | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [wasWarning, setWasWarning] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/price-feed/status');
        const data = await res.json();
        if (data.status === 'success') {
          const newStatus: PriceFeedStatus = {
            isConnected: data.isConnected,
            isTradeFrozen: data.isTradeFrozen,
            isMaintenanceWarning: data.isMaintenanceWarning,
            maintenanceCountdownMinutes: data.maintenanceCountdownMinutes,
            reconnectAttempts: data.reconnectAttempts,
            lastPriceUpdate: data.lastPriceUpdate,
            connectionUptime: data.connectionUptime,
            symbolsTracked: data.symbolsTracked,
          };

          // Detect when maintenance clears → show success briefly
          if (wasWarning && !newStatus.isMaintenanceWarning && !newStatus.isTradeFrozen) {
            setShowSuccess(true);
            setTimeout(() => setShowSuccess(false), 5000);
          }

          setWasWarning(newStatus.isMaintenanceWarning || newStatus.isTradeFrozen);
          setStatus(newStatus);
        }
      } catch {
        // Silent fail
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [wasWarning]);

  // Don't render anything if everything is normal
  if (!status) return null;
  if (!status.isMaintenanceWarning && !status.isTradeFrozen && !showSuccess && status.isConnected) {
    return null;
  }

  return (
    <AnimatePresence>
      {/* Disconnected Banner */}
      {!status.isConnected && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          className="fixed top-0 left-0 right-0 z-50 bg-red-950/95 backdrop-blur-md border-b border-red-500/40 px-6 py-3 flex items-center justify-center gap-3"
        >
          <WifiOff className="w-4 h-4 text-red-400 animate-pulse" />
          <span className="text-sm font-medium text-red-200">
            Market data feed disconnected — reconnecting (attempt {status.reconnectAttempts})...
          </span>
          <div className="w-4 h-4 border-2 border-red-400/40 border-t-red-400 rounded-full animate-spin" />
        </motion.div>
      )}

      {/* Maintenance Warning (T-20 to T-10 minutes) */}
      {status.isMaintenanceWarning && !status.isTradeFrozen && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          className="fixed top-0 left-0 right-0 z-50 bg-amber-950/95 backdrop-blur-md border-b border-amber-500/40 px-6 py-3 flex items-center justify-center gap-3"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="text-sm font-medium text-amber-200">
            ⚠️ SCHEDULED MAINTENANCE IN {status.maintenanceCountdownMinutes} MINUTES — 
            No new trades will be opened after 3:20 AM IST. Active positions are still protected.
          </span>
        </motion.div>
      )}

      {/* Trade Freeze Active (T-10 to T-0 minutes) */}
      {status.isTradeFrozen && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          className="fixed top-0 left-0 right-0 z-50 bg-orange-950/95 backdrop-blur-md border-b border-orange-500/50 px-6 py-3 flex items-center justify-center gap-3"
        >
          <AlertTriangle className="w-4 h-4 text-orange-400 animate-pulse" />
          <span className="text-sm font-semibold text-orange-200">
            🧊 TRADE FREEZE ACTIVE — Connection refreshing in {status.maintenanceCountdownMinutes} min. 
            No new trades will be executed. Existing positions are still monitored.
          </span>
          <div className="w-4 h-4 border-2 border-orange-400/40 border-t-orange-400 rounded-full animate-spin" />
        </motion.div>
      )}

      {/* Success Banner (after maintenance completes) */}
      {showSuccess && (
        <motion.div
          initial={{ opacity: 0, y: -40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -40 }}
          className="fixed top-0 left-0 right-0 z-50 bg-emerald-950/95 backdrop-blur-md border-b border-emerald-500/40 px-6 py-3 flex items-center justify-center gap-3"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-200">
            ✅ Connection refreshed successfully. All systems operational.
          </span>
          <Wifi className="w-4 h-4 text-emerald-400" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
