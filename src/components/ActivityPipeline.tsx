import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
export interface PipelineActivity {
  jarvis: 'idle' | 'thinking' | 'speaking' | 'listening';
  memory: 'idle' | 'recalling' | 'storing' | 'complete';
  action: 'idle' | 'web-learning' | 'trading' | 'market-analysis' |
          'sentiment' | 'whale-tracking' | 'backtesting' |
          'sentry' | 'portfolio-review';
  actionLabel?: string;
  actionColor?: string;
  memoryProgress?: number;
  memoryLabel?: string;
}

interface ActivityPipelineProps {
  activity: PipelineActivity;
  isConnected: boolean;
}

// --- Activity Config ---
const ACTIVITY_CONFIG: Record<string, { icon: string; color: string; glowColor: string }> = {
  'web-learning':     { icon: 'globe',       color: '#22d3ee', glowColor: 'rgba(34,211,238,0.5)' },
  'trading':          { icon: 'candlestick', color: '#f59e0b', glowColor: 'rgba(245,158,11,0.5)' },
  'market-analysis':  { icon: 'trend',       color: '#22c55e', glowColor: 'rgba(34,197,94,0.5)' },
  'sentiment':        { icon: 'news',        color: '#a855f7', glowColor: 'rgba(168,85,247,0.5)' },
  'whale-tracking':   { icon: 'whale',       color: '#3b82f6', glowColor: 'rgba(59,130,246,0.5)' },
  'backtesting':      { icon: 'clock',       color: '#f97316', glowColor: 'rgba(249,115,22,0.5)' },
  'sentry':           { icon: 'shield',      color: '#ef4444', glowColor: 'rgba(239,68,68,0.5)' },
  'portfolio-review': { icon: 'briefcase',   color: '#14b8a6', glowColor: 'rgba(20,184,166,0.5)' },
  'idle':             { icon: 'diamond',     color: '#52525b', glowColor: 'rgba(82,82,91,0.3)' },
};

// --- SVG Icons ---
function OrbIcon({ active }: { active: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28">
      <defs>
        <radialGradient id="orb-grad" cx="40%" cy="40%">
          <stop offset="0%" stopColor={active ? '#67e8f9' : '#71717a'} />
          <stop offset="100%" stopColor={active ? '#0891b2' : '#3f3f46'} />
        </radialGradient>
        {active && (
          <filter id="orb-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>
      <circle cx="14" cy="14" r="10" fill="url(#orb-grad)" filter={active ? 'url(#orb-glow)' : undefined} />
    </svg>
  );
}

function BrainIcon({ active, progress }: { active: boolean; progress?: number }) {
  const circumference = 2 * Math.PI * 16;
  const dashOffset = progress !== undefined ? circumference - (circumference * progress / 100) : circumference;

  return (
    <svg width="40" height="40" viewBox="0 0 40 40">
      <defs>
        {active && (
          <filter id="brain-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        )}
      </defs>
      {/* Progress ring background */}
      <circle cx="20" cy="20" r="16" fill="none" stroke="#27272a" strokeWidth="2.5" />
      {/* Progress ring fill */}
      {progress !== undefined && (
        <circle
          cx="20" cy="20" r="16" fill="none"
          stroke={progress >= 100 ? '#22c55e' : '#22d3ee'}
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
          style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s ease' }}
        />
      )}
      {/* Brain SVG path */}
      <g transform="translate(12, 10)" filter={active ? 'url(#brain-glow)' : undefined}>
        <path
          d="M8 0C5.5 0 3.5 1.5 3 3.5C1.5 4 0 5.5 0 7.5C0 9 0.8 10.3 2 11v4c0 2.5 2 4.5 4.5 5h3c2.5-.5 4.5-2.5 4.5-5v-4c1.2-.7 2-2 2-3.5c0-2-1.5-3.5-3-4C12.5 1.5 10.5 0 8 0z"
          fill={active ? '#c4b5fd' : '#52525b'}
          stroke={active ? '#a78bfa' : '#3f3f46'}
          strokeWidth="0.5"
        />
        <path
          d="M8 3v14M5 6h6M5 10h6"
          fill="none"
          stroke={active ? '#7c3aed' : '#27272a'}
          strokeWidth="0.7"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

function ActivityIcon({ type, color }: { type: string; color: string }) {
  const iconProps = { width: 28, height: 28, viewBox: '0 0 28 28' };

  switch (type) {
    case 'globe':
      return (
        <svg {...iconProps}>
          <circle cx="14" cy="14" r="10" fill="none" stroke={color} strokeWidth="1.5" />
          <ellipse cx="14" cy="14" rx="5" ry="10" fill="none" stroke={color} strokeWidth="1" />
          <line x1="4" y1="14" x2="24" y2="14" stroke={color} strokeWidth="0.8" />
          <line x1="14" y1="4" x2="14" y2="24" stroke={color} strokeWidth="0.8" />
          <path d="M5.5 9h17M5.5 19h17" fill="none" stroke={color} strokeWidth="0.6" />
        </svg>
      );
    case 'candlestick':
      return (
        <svg {...iconProps}>
          {/* 3 candlesticks */}
          <line x1="8" y1="6" x2="8" y2="22" stroke={color} strokeWidth="1" />
          <rect x="6" y="10" width="4" height="6" fill={color} rx="0.5" />
          <line x1="14" y1="8" x2="14" y2="20" stroke={color} strokeWidth="1" />
          <rect x="12" y="11" width="4" height="5" fill="none" stroke={color} strokeWidth="1" rx="0.5" />
          <line x1="20" y1="5" x2="20" y2="23" stroke={color} strokeWidth="1" />
          <rect x="18" y="8" width="4" height="8" fill={color} rx="0.5" />
        </svg>
      );
    case 'trend':
      return (
        <svg {...iconProps}>
          <polyline points="4,20 10,15 16,17 24,6" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="20,6 24,6 24,10" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'news':
      return (
        <svg {...iconProps}>
          <rect x="5" y="5" width="18" height="18" rx="2" fill="none" stroke={color} strokeWidth="1.5" />
          <line x1="8" y1="10" x2="20" y2="10" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          <line x1="8" y1="14" x2="17" y2="14" stroke={color} strokeWidth="1" strokeLinecap="round" />
          <line x1="8" y1="18" x2="15" y2="18" stroke={color} strokeWidth="1" strokeLinecap="round" />
        </svg>
      );
    case 'whale':
      return (
        <svg {...iconProps}>
          <path
            d="M6 16c0-4 3-8 8-8s8 4 8 8c0 2-2 4-4 4h-8c-2 0-4-2-4-4z"
            fill="none" stroke={color} strokeWidth="1.5"
          />
          <circle cx="10" cy="14" r="1" fill={color} />
          <path d="M18 18c1 1 3 0 3-1" fill="none" stroke={color} strokeWidth="1" />
          <path d="M4 12c-1-3 0-5 2-6" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'clock':
      return (
        <svg {...iconProps}>
          <circle cx="14" cy="14" r="10" fill="none" stroke={color} strokeWidth="1.5" />
          <polyline points="14,8 14,14 18,16" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="6,6 4,4" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
          <polyline points="4,4 4,7 7,4" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...iconProps}>
          <path
            d="M14 4L6 8v5c0 5 3.5 9.5 8 10.5c4.5-1 8-5.5 8-10.5V8L14 4z"
            fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"
          />
          <polyline points="10,14 13,17 19,11" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'briefcase':
      return (
        <svg {...iconProps}>
          <rect x="4" y="10" width="20" height="12" rx="2" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M10 10V8c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2" fill="none" stroke={color} strokeWidth="1.5" />
          <line x1="4" y1="16" x2="24" y2="16" stroke={color} strokeWidth="1" />
        </svg>
      );
    case 'diamond':
    default:
      return (
        <svg {...iconProps}>
          <rect x="10" y="10" width="8" height="8" rx="1" fill={color} transform="rotate(45 14 14)" opacity={0.5} />
        </svg>
      );
  }
}

// --- Particle System ---
interface ParticleProps {
  direction: 'right' | 'left';
  color: string;
  segmentKey: 'left' | 'right';
  count?: number;
}

function Particles({
  direction,
  color,
  segmentKey,
  count = 4,
}: ParticleProps) {
  // Segment positions: left segment = x 0→50%, right segment = x 50→100%
  const xStart = segmentKey === 'left' ? 0 : 50;
  const xEnd   = segmentKey === 'left' ? 50 : 100;

  const from = direction === 'right' ? xStart : xEnd;
  const to   = direction === 'right' ? xEnd : xStart;

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <motion.circle
          key={`${segmentKey}-${direction}-${i}`}
          cy="50%"
          r={2.5}
          fill={color}
          filter="url(#particle-blur)"
          initial={{ cx: `${from}%`, opacity: 0 }}
          animate={{ cx: `${to}%`, opacity: [0, 1, 1, 0] }}
          transition={{
            duration: 1.2,
            delay: i * (1.2 / count),
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </>
  );
}

// --- Main Component ---
export function ActivityPipeline({ activity, isConnected }: ActivityPipelineProps) {
  const [phase, setPhase] = useState<'idle' | 'outbound-1' | 'outbound-2' | 'inbound' | 'complete'>('idle');
  const isActive = activity.action !== 'idle';
  const config = ACTIVITY_CONFIG[activity.action] || ACTIVITY_CONFIG['idle'];
  const hasProgress = activity.action === 'web-learning' && activity.memoryProgress !== undefined;

  // Phase state machine
  useEffect(() => {
    if (activity.action === 'idle') {
      setPhase('idle');
      return;
    }

    if (activity.memory === 'complete') {
      setPhase('complete');
      const timer = setTimeout(() => setPhase('idle'), 3000);
      return () => clearTimeout(timer);
    }

    // Outbound phase 1: Orb → Brain
    setPhase('outbound-1');
    const t1 = setTimeout(() => {
      // Phase 2: Brain → Activity icon
      setPhase('outbound-2');
    }, 1000);

    const t2 = setTimeout(() => {
      // If web-learning, switch to inbound when data comes back
      if (activity.action === 'web-learning') {
        setPhase('inbound');
      }
    }, 2000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [activity.action, activity.memory]);

  // For non-web-learning activities that are brief, auto-transition to inbound
  useEffect(() => {
    if (
      isActive &&
      activity.action !== 'web-learning' &&
      activity.action !== 'sentry' &&
      activity.action !== 'trading' &&
      phase === 'outbound-2'
    ) {
      const timer = setTimeout(() => setPhase('inbound'), 1200);
      return () => clearTimeout(timer);
    }
  }, [phase, activity.action, isActive]);

  // Globe rotation for web-learning
  const isGlobeSpinning = activity.action === 'web-learning' && (phase === 'outbound-2' || phase === 'inbound');

  // Determine particle rendering
  const particles = useMemo(() => {
    const result: { segment: 'left' | 'right'; direction: 'right' | 'left'; color: string }[] = [];

    if (phase === 'outbound-1') {
      result.push({ segment: 'left', direction: 'right', color: '#22d3ee' }); // cyan outbound
    } else if (phase === 'outbound-2') {
      result.push({ segment: 'left', direction: 'right', color: '#22d3ee' });
      result.push({ segment: 'right', direction: 'right', color: '#22d3ee' });
    } else if (phase === 'inbound') {
      result.push({ segment: 'right', direction: 'left', color: config.color });
      // For analysis-type tools, also show particles going into brain from left (results stored)
    }

    return result;
  }, [phase, config.color]);

  // Sentry persistent glow
  const [sentryPulse, setSentryPulse] = useState(false);
  useEffect(() => {
    if (activity.action !== 'sentry') return;
    const interval = setInterval(() => {
      setSentryPulse(true);
      setTimeout(() => setSentryPulse(false), 1000);
    }, 5000);
    return () => clearInterval(interval);
  }, [activity.action]);

  return (
    <AnimatePresence>
      {isConnected && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          className="w-full max-w-xl mb-4"
        >
          <div
            style={{
              background: 'rgba(24, 24, 27, 0.6)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(63, 63, 70, 0.5)',
              borderRadius: '16px',
              padding: '12px 20px',
            }}
          >
            {/* SVG defs for particle blur */}
            <svg width="0" height="0" style={{ position: 'absolute' }}>
              <defs>
                <filter id="particle-blur">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
                </filter>
              </defs>
            </svg>

            <div style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative' }}>
              {/* LEFT NODE: Jarvis Orb */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 44, flexShrink: 0 }}>
                <motion.div
                  animate={{
                    scale: phase === 'outbound-1' ? [1, 1.15, 1] : 1,
                    opacity: phase === 'inbound' ? 0.5 : 1,
                  }}
                  transition={{ duration: 1.5, repeat: phase === 'outbound-1' ? Infinity : 0 }}
                >
                  <OrbIcon active={isActive || phase === 'complete'} />
                </motion.div>
                <span style={{ fontSize: 9, color: '#71717a', marginTop: 2, fontFamily: 'monospace' }}>
                  JARVIS
                </span>
              </div>

              {/* LEFT LINE + PARTICLES */}
              <div style={{ flex: 1, height: 6, position: 'relative' }}>
                <svg width="100%" height="6" style={{ display: 'block' }}>
                  <line
                    x1="0" y1="3" x2="100%" y2="3"
                    stroke={isActive ? config.color : '#3f3f46'}
                    strokeWidth={isActive ? 1.5 : 1}
                    strokeOpacity={isActive ? 0.6 : 0.3}
                    style={{ transition: 'stroke 0.3s, stroke-opacity 0.3s' }}
                  />
                  {particles
                    .filter(p => p.segment === 'left')
                    .map((p, i) => (
                      <g key={`left-${i}`}>
                        <Particles direction={p.direction} color={p.color} segmentKey="left" />
                      </g>
                    ))}
                </svg>
              </div>

              {/* CENTER NODE: Brain */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 52, flexShrink: 0 }}>
                <motion.div
                  animate={{
                    scale: phase === 'complete' ? [1, 1.2, 1] : 1,
                  }}
                  transition={{ duration: 0.6 }}
                >
                  <BrainIcon
                    active={isActive || activity.memory !== 'idle'}
                    progress={hasProgress ? activity.memoryProgress : (phase === 'complete' ? 100 : undefined)}
                  />
                </motion.div>
                <AnimatePresence mode="wait">
                  {activity.memoryLabel ? (
                    <motion.span
                      key="memory-label"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      style={{
                        fontSize: 9,
                        color: phase === 'complete' ? '#22c55e' : '#a78bfa',
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {activity.memoryLabel}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="memory-idle"
                      style={{ fontSize: 9, color: '#52525b', fontFamily: 'monospace' }}
                    >
                      MEMORY
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              {/* RIGHT LINE + PARTICLES */}
              <div style={{ flex: 1, height: 6, position: 'relative' }}>
                <svg width="100%" height="6" style={{ display: 'block' }}>
                  <line
                    x1="0" y1="3" x2="100%" y2="3"
                    stroke={isActive ? config.color : '#3f3f46'}
                    strokeWidth={isActive ? 1.5 : 1}
                    strokeOpacity={isActive ? 0.6 : 0.3}
                    style={{ transition: 'stroke 0.3s, stroke-opacity 0.3s' }}
                  />
                  {particles
                    .filter(p => p.segment === 'right')
                    .map((p, i) => (
                      <g key={`right-${i}`}>
                        <Particles direction={p.direction} color={p.color} segmentKey="right" />
                      </g>
                    ))}
                </svg>
              </div>

              {/* RIGHT NODE: Dynamic Activity Icon */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 44, flexShrink: 0 }}>
                <motion.div
                  animate={{
                    scale: isActive ? [1, 1.08, 1] : 1,
                    rotate: isGlobeSpinning ? 360 : 0,
                  }}
                  transition={{
                    scale: { duration: 2, repeat: isActive ? Infinity : 0 },
                    rotate: { duration: 3, repeat: isGlobeSpinning ? Infinity : 0, ease: 'linear' },
                  }}
                  style={{
                    filter: isActive
                      ? `drop-shadow(0 0 8px ${config.glowColor})`
                      : 'none',
                    transition: 'filter 0.3s ease',
                  }}
                >
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activity.action}
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <ActivityIcon type={config.icon} color={config.color} />
                    </motion.div>
                  </AnimatePresence>
                </motion.div>

                {/* Activity label */}
                <AnimatePresence mode="wait">
                  {activity.actionLabel ? (
                    <motion.span
                      key="action-label"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      style={{
                        fontSize: 8,
                        color: config.color,
                        fontFamily: 'monospace',
                        fontWeight: 600,
                        maxWidth: 80,
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {activity.actionLabel}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="action-idle"
                      style={{ fontSize: 9, color: '#52525b', fontFamily: 'monospace' }}
                    >
                      {activity.action === 'sentry' ? 'SENTRY' : 'ACTIVITY'}
                    </motion.span>
                  )}
                </AnimatePresence>

                {/* Sentry persistent pulse */}
                {activity.action === 'sentry' && (
                  <motion.div
                    animate={{
                      boxShadow: sentryPulse
                        ? '0 0 20px rgba(239,68,68,0.6)'
                        : '0 0 6px rgba(239,68,68,0.2)',
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: '#ef4444',
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
