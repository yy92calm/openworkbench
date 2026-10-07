// Workflow pattern recognition: tracks user operation sequences and identifies
// recurring patterns that could be automated or offered as shortcuts.

import { fireEvent } from './proactive';
import { getLogger } from './logging';
import { getStore } from './store';

const log = getLogger('workflowPatterns');

const STORE_SCOPE = 'workbench.workflowPatterns';

export interface WorkflowConfig {
  /** Enable workflow pattern recognition. */
  enabled: boolean;
  /** Minimum occurrences to recognize a pattern (default: 3). */
  minOccurrences: number;
  /** Maximum pattern length (number of steps, default: 5). */
  maxPatternLength: number;
  /** Time window for pattern detection (ms, default: 24h). */
  patternWindowMs: number;
}

export interface WorkflowStep {
  /** Step type (e.g., 'session.create', 'tool.call', 'macro.query'). */
  type: string;
  /** Step detail (e.g., tool name, macro theme). */
  detail?: string;
  /** When the step occurred. */
  timestamp: string;
}

export interface WorkflowPattern {
  /** Pattern ID. */
  id: string;
  /** Sequence of steps. */
  steps: WorkflowStep[];
  /** Number of times this pattern has occurred. */
  occurrences: number;
  /** First time this pattern was seen. */
  firstSeen: string;
  /** Last time this pattern was seen. */
  lastSeen: string;
  /** Suggested name for the pattern. */
  suggestedName: string;
}

function getConfig(): WorkflowConfig {
  const store = getStore(STORE_SCOPE);
  const defaults: WorkflowConfig = {
    enabled: true,
    minOccurrences: 3,
    maxPatternLength: 5,
    patternWindowMs: 24 * 60 * 60 * 1000,
  };
  return { ...defaults, ...store.get('config') };
}

export function setWorkflowConfig(patch: Partial<WorkflowConfig>): void {
  const store = getStore(STORE_SCOPE);
  const current = getConfig();
  store.set('config', { ...current, ...patch });
}

/** Recent workflow steps (in-memory buffer). */
const recentSteps: WorkflowStep[] = [];
const MAX_RECENT_STEPS = 100;

/** Recognized patterns. */
const recognizedPatterns = new Map<string, WorkflowPattern>();

/** Record a workflow step. */
export function recordWorkflowStep(step: Omit<WorkflowStep, 'timestamp'>): void {
  const config = getConfig();
  if (!config.enabled) return;

  const fullStep: WorkflowStep = {
    ...step,
    timestamp: new Date().toISOString(),
  };

  recentSteps.push(fullStep);
  if (recentSteps.length > MAX_RECENT_STEPS) {
    recentSteps.shift();
  }

  // Check for patterns after recording
  detectPatterns();
}

/** Detect recurring patterns in recent steps. */
function detectPatterns(): void {
  const config = getConfig();
  const now = Date.now();
  const windowStart = now - config.patternWindowMs;

  // Filter steps within the time window
  const windowSteps = recentSteps.filter((s) => Date.parse(s.timestamp) >= windowStart);
  if (windowSteps.length < config.minOccurrences) return;

  // Extract sequences of length 2 to maxPatternLength
  for (let len = 2; len <= config.maxPatternLength; len++) {
    for (let i = 0; i <= windowSteps.length - len; i++) {
      const sequence = windowSteps.slice(i, i + len);
      const patternKey = sequence.map((s) => `${s.type}:${s.detail ?? ''}`).join('|');

      // Count occurrences of this pattern
      let count = 0;
      let firstSeen = sequence[0].timestamp;
      let lastSeen = sequence[0].timestamp;

      for (let j = 0; j <= windowSteps.length - len; j++) {
        const candidate = windowSteps.slice(j, j + len);
        const candidateKey = candidate.map((s) => `${s.type}:${s.detail ?? ''}`).join('|');
        if (candidateKey === patternKey) {
          count++;
          if (Date.parse(candidate[0].timestamp) < Date.parse(firstSeen)) {
            firstSeen = candidate[0].timestamp;
          }
          if (Date.parse(candidate[0].timestamp) > Date.parse(lastSeen)) {
            lastSeen = candidate[0].timestamp;
          }
        }
      }

      // If this pattern meets the threshold and is new, register it
      if (count >= config.minOccurrences && !recognizedPatterns.has(patternKey)) {
        const pattern: WorkflowPattern = {
          id: `pattern_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          steps: sequence,
          occurrences: count,
          firstSeen,
          lastSeen,
          suggestedName: generatePatternName(sequence),
        };

        recognizedPatterns.set(patternKey, pattern);

        // Fire proactive event
        try {
          fireEvent('workflow.pattern', {
            type: 'info',
            title: `工作流模式: ${pattern.suggestedName}`,
            message: `检测到重复操作序列（${count} 次），可考虑自动化。`,
            patternId: pattern.id,
            occurrences: count,
          });
          log.info('detected workflow pattern', {
            patternId: pattern.id,
            occurrences: count,
            steps: sequence.length,
          });
        } catch (err) {
          log.error('failed to fire workflow pattern event', err);
        }
      }
    }
  }
}

/** Generate a human-readable name for a pattern. */
function generatePatternName(steps: WorkflowStep[]): string {
  const types = steps.map((s) => s.type).join(' → ');
  if (types.length > 40) {
    return `${steps[0].type} → ... → ${steps[steps.length - 1].type}`;
  }
  return types;
}

/** Get all recognized patterns. */
export function getRecognizedPatterns(): WorkflowPattern[] {
  return Array.from(recognizedPatterns.values());
}

/** Get patterns sorted by occurrence count. */
export function getTopPatterns(limit: number = 10): WorkflowPattern[] {
  return getRecognizedPatterns()
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, limit);
}

/** Clear recognized patterns (e.g., on app restart). */
export function clearPatterns(): void {
  recognizedPatterns.clear();
  log.info('cleared workflow patterns');
}

/** Clear recent steps buffer. */
export function clearRecentSteps(): void {
  recentSteps.length = 0;
  log.info('cleared recent workflow steps');
}
