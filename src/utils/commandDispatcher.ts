/**
 * CommandDispatcher — Unified, thread-safe input serializer for the Jarvis Live API.
 *
 * Solves:
 *  1. Race condition between voice (sendRealtimeInput) and text (sendClientContent)
 *  2. Micro-task flooding from Promise-chained audio sends
 *  3. Interleaving of audio and text on the Gemini Live session
 *
 * Architecture:
 *  - Stores the RESOLVED session, not a Promise
 *  - Enforces mutual exclusion: voice and text cannot fire simultaneously
 *  - Drains buffered audio before switching to text mode
 *  - Provides a clean public API consumed by useJarvisLive
 */

export type InputMode = 'idle' | 'voice' | 'text';

export interface DispatcherCallbacks {
  onModeChange?: (mode: InputMode) => void;
}

export class CommandDispatcher {
  private session: any | null = null;
  private _mode: InputMode = 'idle';
  private drainResolve: (() => void) | null = null;
  private pendingAudioChunks = 0;
  private destroyed = false;
  private callbacks: DispatcherCallbacks;

  constructor(callbacks: DispatcherCallbacks = {}) {
    this.callbacks = callbacks;
  }

  // ─── Session Lifecycle ───────────────────────────────────────────

  /**
   * Store the RESOLVED session object (not a Promise).
   * Call this once from the `onopen` callback.
   */
  setSession(session: any): void {
    this.session = session;
  }

  get hasSession(): boolean {
    return this.session !== null && !this.destroyed;
  }

  get mode(): InputMode {
    return this._mode;
  }

  // ─── Mode Switching ──────────────────────────────────────────────

  /**
   * Switch input mode with clean drain semantics.
   * - idle → voice: immediate
   * - idle → text: immediate
   * - voice → text: waits for pending audio chunks to flush, then switches
   * - text → voice: immediate (text is synchronous send)
   * - any → idle: immediate
   */
  async switchMode(newMode: InputMode): Promise<void> {
    if (this.destroyed) return;
    if (this._mode === newMode) return;

    // If switching from voice → text, drain pending audio
    if (this._mode === 'voice' && newMode === 'text' && this.pendingAudioChunks > 0) {
      await this.drainAudio();
    }

    this._mode = newMode;
    this.callbacks.onModeChange?.(newMode);
  }

  /**
   * Wait for all in-flight audio sends to complete.
   * Resolves immediately if no audio is pending.
   */
  private drainAudio(): Promise<void> {
    if (this.pendingAudioChunks <= 0) {
      this.pendingAudioChunks = 0;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
      // Safety timeout — don't block forever
      setTimeout(() => {
        if (this.drainResolve) {
          this.drainResolve();
          this.drainResolve = null;
          this.pendingAudioChunks = 0;
        }
      }, 500);
    });
  }

  // ─── Audio (Voice) ───────────────────────────────────────────────

  /**
   * Send a raw PCM audio chunk to the Live API.
   * Only sends if current mode is 'voice'.
   */
  sendAudio(base64Data: string): void {
    if (this.destroyed || !this.session) return;
    if (this._mode !== 'voice') return;

    this.pendingAudioChunks++;
    try {
      this.session.sendRealtimeInput({
        audio: { data: base64Data, mimeType: 'audio/pcm;rate=16000' },
      });
    } catch (e) {
      console.error('[CommandDispatcher] Failed to send audio:', e);
    } finally {
      this.pendingAudioChunks--;
      if (this.pendingAudioChunks <= 0 && this.drainResolve) {
        this.drainResolve();
        this.drainResolve = null;
        this.pendingAudioChunks = 0;
      }
    }
  }

  // ─── Text ────────────────────────────────────────────────────────

  /**
   * Send a text message to the Live API with proper Content format.
   * Enforces drain-before-send if switching from voice mode.
   */
  async sendText(text: string): Promise<void> {
    if (this.destroyed || !this.session) return;

    // If currently in voice mode, drain first
    if (this._mode === 'voice') {
      await this.switchMode('text');
    } else {
      this._mode = 'text';
      this.callbacks.onModeChange?.('text');
    }

    try {
      this.session.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      });
    } catch (e) {
      console.error('[CommandDispatcher] Failed to send text:', e);
    }
  }

  // ─── Video (Screen Share) ───────────────────────────────────────

  /**
   * Send a video frame to the Live API.
   * Video is independent of voice/text mode (it's a separate data channel).
   */
  sendVideo(base64Data: string): void {
    if (this.destroyed || !this.session) return;

    try {
      this.session.sendRealtimeInput({
        video: { data: base64Data, mimeType: 'image/jpeg' },
      });
    } catch (e) {
      console.error('[CommandDispatcher] Failed to send video frame:', e);
    }
  }

  // ─── Tool Responses ─────────────────────────────────────────────

  /**
   * Send a function/tool response back to the Live API.
   * Tool responses are always allowed regardless of current mode.
   */
  sendToolResponse(response: {
    functionResponses: Array<{ name: string; id: string; response: any }>;
  }): void {
    if (this.destroyed || !this.session) return;

    try {
      this.session.sendToolResponse(response);
    } catch (e) {
      console.error('[CommandDispatcher] Failed to send tool response:', e);
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────

  destroy(): void {
    this.destroyed = true;
    this.session = null;
    this._mode = 'idle';
    this.pendingAudioChunks = 0;
    if (this.drainResolve) {
      this.drainResolve();
      this.drainResolve = null;
    }
  }
}
