import { motion } from 'motion/react';

export type OrbVariant = 'hologram' | 'liquid' | 'ethereal';

interface OrbProps {
  state: 'idle' | 'listening' | 'speaking' | 'connecting';
  volume?: number;
  variant?: OrbVariant;
}

export function Orb({ state, volume = 0, variant = 'hologram' }: OrbProps) {
  const isReactive = (state === 'listening' || state === 'speaking') && volume > 0.01;
  
  // Dynamic values based on volume
  const scale = isReactive ? 1 + (volume * 0.3) : 1;
  const opacity = isReactive ? 0.7 + (volume * 0.3) : 0.5;

  // Colors based on state
  const colors = {
    idle: 'rgba(6, 182, 212, 0.4)', // Dim Cyan
    connecting: 'rgba(245, 158, 11, 0.8)', // Amber
    listening: 'rgba(16, 185, 129, 0.9)', // Emerald
    speaking: 'rgba(59, 130, 246, 0.9)', // Blue
  };
  
  const glowColors = {
    idle: 'rgba(6, 182, 212, 0.15)',
    connecting: 'rgba(245, 158, 11, 0.3)',
    listening: 'rgba(16, 185, 129, 0.4)',
    speaking: 'rgba(59, 130, 246, 0.4)',
  };

  const activeColor = colors[state];
  const activeGlow = glowColors[state];

  if (variant === 'liquid') {
    return (
      <div className="relative flex items-center justify-center w-64 h-64">
        <motion.div
          className="absolute inset-0 rounded-full blur-3xl"
          animate={{ backgroundColor: activeGlow, scale: scale * 1.2 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
        <motion.div
          className="absolute w-40 h-40 mix-blend-screen"
          style={{ 
            background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), ${activeColor} 50%, rgba(0,0,0,0.5) 100%)`,
            boxShadow: `0 0 60px ${activeColor}` 
          }}
          animate={{
            borderRadius: ["40% 60% 70% 30% / 40% 50% 60% 50%", "60% 40% 30% 70% / 60% 30% 70% 40%", "40% 60% 70% 30% / 40% 50% 60% 50%"],
            rotate: [0, 360],
            scale: scale,
            opacity: opacity
          }}
          transition={{
            borderRadius: { duration: 8, repeat: Infinity, ease: "easeInOut" },
            rotate: { duration: 20, repeat: Infinity, ease: "linear" },
            scale: { type: 'spring', stiffness: 300, damping: 20 }
          }}
        />
        <motion.div
          className="absolute w-32 h-32 mix-blend-screen opacity-70"
          style={{ background: `radial-gradient(circle at 70% 70%, rgba(255,255,255,0.9), ${activeColor} 40%, transparent 80%)` }}
          animate={{
            borderRadius: ["60% 40% 30% 70% / 60% 30% 70% 40%", "40% 60% 70% 30% / 40% 50% 60% 50%", "60% 40% 30% 70% / 60% 30% 70% 40%"],
            rotate: [360, 0],
            scale: scale * 1.1,
          }}
          transition={{
            borderRadius: { duration: 6, repeat: Infinity, ease: "easeInOut" },
            rotate: { duration: 15, repeat: Infinity, ease: "linear" },
            scale: { type: 'spring', stiffness: 300, damping: 20 }
          }}
        />
      </div>
    );
  }

  if (variant === 'ethereal') {
    return (
      <div className="relative flex items-center justify-center w-64 h-64">
        <motion.div
          className="absolute inset-0 rounded-full blur-3xl"
          animate={{ backgroundColor: activeGlow, scale: scale * 1.5 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
        
        {/* Core */}
        <motion.div
          className="absolute w-20 h-20 rounded-full bg-white blur-md"
          style={{ boxShadow: `0 0 40px ${activeColor}, 0 0 80px ${activeColor}` }}
          animate={{ scale: scale, opacity: opacity }}
          transition={{ type: 'spring', stiffness: 400, damping: 15 }}
        />

        {/* Soundwave Ripples */}
        <motion.div
          className="absolute w-20 h-20 rounded-full border-2"
          style={{ borderColor: activeColor }}
          animate={{ 
            scale: isReactive ? [1, 1 + volume * 3] : [1, 2], 
            opacity: [0.8, 0] 
          }}
          transition={{ duration: isReactive ? 0.5 : 2, repeat: Infinity, ease: "easeOut" }}
        />
        <motion.div
          className="absolute w-20 h-20 rounded-full border-2"
          style={{ borderColor: activeColor }}
          animate={{ 
            scale: isReactive ? [1, 1 + volume * 3] : [1, 2], 
            opacity: [0.8, 0] 
          }}
          transition={{ duration: isReactive ? 0.5 : 2, repeat: Infinity, ease: "easeOut", delay: isReactive ? 0.25 : 1 }}
        />
      </div>
    );
  }

  // Default: Hologram
  return (
    <div className="relative flex items-center justify-center w-64 h-64">
      {/* Ambient Background Glow */}
      <motion.div
        className="absolute inset-0 rounded-full blur-3xl"
        animate={{
          backgroundColor: activeGlow,
          scale: scale * 1.2,
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      />

      {/* Outer HUD Ring - Dashed */}
      <motion.div
        className="absolute w-60 h-60 rounded-full border-[1px] border-dashed"
        style={{ borderColor: activeColor }}
        animate={{
          rotate: 360,
          scale: scale,
          opacity: opacity,
        }}
        transition={{
          rotate: { duration: 20, repeat: Infinity, ease: 'linear' },
          scale: { type: 'spring', stiffness: 300, damping: 20 },
        }}
      />

      {/* Middle HUD Ring - Segmented */}
      <motion.div
        className="absolute w-52 h-52 rounded-full border-4"
        style={{ 
          borderTopColor: activeColor, 
          borderBottomColor: activeColor,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent'
        }}
        animate={{
          rotate: -360,
          scale: scale * 1.02,
          opacity: opacity * 0.8,
        }}
        transition={{
          rotate: { duration: 15, repeat: Infinity, ease: 'linear' },
          scale: { type: 'spring', stiffness: 300, damping: 20 },
        }}
      />

      {/* Inner HUD Ring - Dotted */}
      <motion.div
        className="absolute w-40 h-40 rounded-full border-[3px] border-dotted"
        style={{ borderColor: activeColor }}
        animate={{
          rotate: 360,
          scale: scale * 0.95,
          opacity: opacity,
        }}
        transition={{
          rotate: { duration: 10, repeat: Infinity, ease: 'linear' },
          scale: { type: 'spring', stiffness: 300, damping: 20 },
        }}
      />

      {/* Crosshair Accents */}
      <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
        <div className="w-full h-[1px]" style={{ backgroundColor: activeColor }} />
        <div className="h-full w-[1px]" style={{ backgroundColor: activeColor }} />
        <div className="w-48 h-48 absolute rounded-full border border-white/10" />
      </div>

      {/* Core Energy Sphere */}
      <motion.div
        className="absolute w-24 h-24 rounded-full"
        style={{
          background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.9), ${activeColor} 40%, rgba(0,0,0,0.8) 90%)`,
          boxShadow: `0 0 40px ${activeColor}, inset 0 0 20px rgba(255,255,255,0.6)`,
        }}
        animate={{
          scale: scale,
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 15 }}
      />

      {/* Core Pulse (Audio Reactive) */}
      <motion.div
        className="absolute w-16 h-16 rounded-full bg-white blur-md"
        animate={{
          scale: isReactive ? 1 + volume * 1.5 : [1, 1.1, 1],
          opacity: isReactive ? 0.5 + volume * 0.5 : [0.2, 0.4, 0.2],
        }}
        transition={
          isReactive 
            ? { type: 'spring', stiffness: 500, damping: 20 } 
            : { duration: 2, repeat: Infinity, ease: 'easeInOut' }
        }
      />
    </div>
  );
}
