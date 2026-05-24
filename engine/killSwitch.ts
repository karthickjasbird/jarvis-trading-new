import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PROJECT_HALT_PATH = path.resolve(process.cwd(), 'HALT_TRADING');
const HOME_HALT_PATH = path.join(os.homedir(), '.jarvis-halt');

export interface HaltState {
  halted: boolean;
  reason?: string;
  since?: string;
  source?: 'project' | 'home';
}

/**
 * Synchronous check used inside hot write paths.
 * Blocks NEW EXPOSURE (entries, campaign deploys). Closes and partial-closes
 * remain unblocked — a panic button should stop fresh trades but never
 * prevent you from exiting positions you're trying to reduce.
 */
export function isHalted(): HaltState {
  for (const [filePath, source] of [
    [PROJECT_HALT_PATH, 'project'] as const,
    [HOME_HALT_PATH, 'home'] as const,
  ]) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          halted: true,
          reason: parsed.reason || 'manual halt',
          since: parsed.since,
          source,
        };
      }
    } catch {
      // empty or non-JSON file still counts as a halt
    }
    return { halted: true, reason: 'manual halt', source };
  }
  return { halted: false };
}

export function halt(reason: string = 'manual halt'): HaltState {
  const since = new Date().toISOString();
  const payload = JSON.stringify({ reason, since }, null, 2);
  fs.writeFileSync(PROJECT_HALT_PATH, payload, 'utf8');
  return { halted: true, reason, since, source: 'project' };
}

export function resume(): HaltState {
  for (const filePath of [PROJECT_HALT_PATH, HOME_HALT_PATH]) {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
  return { halted: false };
}

/**
 * Throw a HaltError when blocked — callers catch this to surface the message
 * to the user / log to Trade Diary.
 */
export class HaltError extends Error {
  constructor(public state: HaltState) {
    super(`Trading halted: ${state.reason || 'kill switch active'}`);
    this.name = 'HaltError';
  }
}

export function assertNotHalted(): void {
  const state = isHalted();
  if (state.halted) throw new HaltError(state);
}
