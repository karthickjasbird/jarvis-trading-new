import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpCircle, X, RefreshCw } from 'lucide-react';

/**
 * UpdateBanner — checks for new versions on GitHub and shows a
 * dismissable notification banner when an update is available.
 * Checks once on mount, then every 30 minutes.
 */
export function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<{
    current: string;
    remote: string;
    changelog?: string;
  } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const res = await fetch('/api/version');
        const data = await res.json();
        if (data.updateAvailable && data.remote) {
          setUpdateInfo({
            current: data.current.version,
            remote: data.remote.version,
            changelog: data.remote.changelog,
          });
        }
      } catch {
        // Silently ignore
      }
    };

    // Check on mount
    checkUpdate();

    // Re-check every 30 minutes
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!updateInfo || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center px-4 py-2"
      >
        <div className="flex items-center gap-3 bg-gradient-to-r from-emerald-900/90 to-teal-900/90 backdrop-blur-md border border-emerald-500/30 rounded-full px-5 py-2.5 shadow-[0_4px_24px_rgba(16,185,129,0.15)] max-w-xl">
          <ArrowUpCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 animate-pulse" />
          
          <span className="text-sm text-emerald-200">
            <span className="font-bold">v{updateInfo.remote}</span> available
            {updateInfo.changelog && (
              <span className="text-emerald-400/70 ml-1.5">— {updateInfo.changelog}</span>
            )}
          </span>

          <div className="flex items-center gap-2 ml-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText('git pull && npm install && npm run dev');
                const btn = document.getElementById('copy-update-cmd');
                if (btn) btn.textContent = 'Copied!';
                setTimeout(() => {
                  if (btn) btn.textContent = 'Copy command';
                }, 2000);
              }}
              id="copy-update-cmd"
              className="text-[11px] px-2.5 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded-full border border-emerald-500/30 transition-colors font-medium"
            >
              Copy command
            </button>

            <button
              onClick={() => setDismissed(true)}
              className="p-1 text-emerald-400/50 hover:text-emerald-300 transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
