import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Circle, AlertTriangle, X, Copy, ExternalLink, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface SetupStatus {
  geminiKey: boolean;
  binanceKey: boolean;
  binanceSecret: boolean;
  telegramBot: boolean;
  groqKey: boolean;
  ownerUserId: boolean;
  ownerIdValue: string;
}

/**
 * OnboardingWizard — shows a floating setup checklist for new users.
 * Only appears when critical items (GEMINI_API_KEY, OWNER_USER_ID) are missing.
 * Can be dismissed and won't reappear for the current session.
 */
export function OnboardingWizard({ userId }: { userId: string }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Don't show if already dismissed this session
    if (sessionStorage.getItem('onboarding-dismissed')) {
      setDismissed(true);
      return;
    }

    const checkStatus = async () => {
      try {
        const res = await fetch('/api/setup-status');
        const data = await res.json();
        setStatus(data);
      } catch {
        // Server not ready yet
      }
    };

    checkStatus();
  }, [userId]);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('onboarding-dismissed', 'true');
  };

  if (dismissed || !status) return null;

  // Don't show if everything critical is configured
  const criticalComplete = status.geminiKey && status.ownerUserId;
  if (criticalComplete && !expanded) return null;

  const items = [
    {
      key: 'gemini',
      label: 'Gemini API Key',
      done: status.geminiKey,
      required: true,
      help: 'Add GEMINI_API_KEY to your .env file',
      link: 'https://aistudio.google.com/apikey',
    },
    {
      key: 'owner',
      label: 'Owner User ID',
      done: status.ownerUserId,
      required: true,
      help: status.ownerIdValue ? `Auto-detected: ${status.ownerIdValue}` : 'Settings → Copy your User ID → paste in .env',
    },
    {
      key: 'binance',
      label: 'Binance API Keys',
      done: status.binanceKey && status.binanceSecret,
      required: false,
      help: 'Optional — needed only for live trading',
      link: 'https://www.binance.com/en/my/settings/api-management',
    },
    {
      key: 'telegram',
      label: 'Telegram Bot Token',
      done: status.telegramBot,
      required: false,
      help: 'Optional — for trade alerts via Telegram',
    },
    {
      key: 'groq',
      label: 'Groq API Key',
      done: status.groqKey,
      required: false,
      help: 'Optional — fast Llama fallback model',
      link: 'https://console.groq.com',
    },
  ];

  const doneCount = items.filter(i => i.done).length;
  const requiredDone = items.filter(i => i.required && i.done).length;
  const requiredTotal = items.filter(i => i.required).length;
  const allCriticalDone = requiredDone === requiredTotal;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20, scale: 0.95 }}
        animate={{ opacity: 1, x: 0, scale: 1 }}
        exit={{ opacity: 0, x: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed bottom-24 right-4 z-50 w-80"
      >
        <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700/50 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden">
          {/* Header */}
          <div 
            className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-zinc-800/50 transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-semibold text-zinc-200">
                {allCriticalDone ? 'Setup Complete' : 'Setup Checklist'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono">
                {doneCount}/{items.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {!allCriticalDone && (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-0.5 bg-zinc-800">
            <motion.div
              className="h-full bg-gradient-to-r from-amber-500 to-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${(doneCount / items.length) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>

          {/* Items */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="p-3 space-y-1">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className={`flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors ${
                        item.done ? 'opacity-50' : 'hover:bg-zinc-800/50'
                      }`}
                    >
                      {item.done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Circle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          item.required ? 'text-amber-400' : 'text-zinc-600'
                        }`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-medium ${item.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                            {item.label}
                          </span>
                          {item.required && !item.done && (
                            <span className="text-[9px] px-1 py-0.5 bg-amber-500/20 text-amber-400 rounded font-bold">
                              REQUIRED
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{item.help}</p>
                        {item.link && !item.done && (
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 mt-1"
                          >
                            Get it here <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {!allCriticalDone && (
                  <div className="px-4 pb-3">
                    <p className="text-[11px] text-zinc-500 text-center">
                      After editing <code className="text-zinc-400">.env</code>, restart the server with <code className="text-zinc-400">npm run dev</code>
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Click to expand hint */}
          {!expanded && !allCriticalDone && (
            <div className="px-4 py-2 text-center">
              <span className="text-[11px] text-zinc-500">Click to expand setup checklist</span>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
