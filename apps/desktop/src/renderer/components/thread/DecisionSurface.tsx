import type {
  PermissionAskedEvent,
  PermissionMode,
  PermissionReply,
  QuestionAskedEvent,
} from '@workbench/sdk';

import { cn } from '@/lib/cn';

import type { ComposerCommand } from './Composer';
import { Composer } from './Composer';
import { InteractionPrompt } from './InteractionPrompt';
import { ModeSwitch } from './ModeSwitch';

/**
 * Single-slot decision surface, inspired by Reasonix's footer model.
 *
 * Priority: question > permission > composer.
 * When a decision surface is active, the composer stays mounted but visually
 * hidden, preserving its draft state across decisions.
 */
export function DecisionSurface({
  question,
  permission,
  origin,
  permissionMode,
  onAnswer,
  onReject,
  onPermission,
  onPermissionModeChange,
  composer,
}: {
  question?: QuestionAskedEvent;
  permission?: PermissionAskedEvent;
  origin?: string;
  permissionMode: PermissionMode;
  onAnswer: (requestId: string, answers: string[][]) => void;
  onReject: (requestId: string) => void;
  onPermission: (requestId: string, reply: PermissionReply) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  composer: {
    onSend?: (text: string) => void;
    onRunShell?: (command: string) => void;
    onRunCommand?: (name: string, args: string) => void;
    commands?: ComposerCommand[];
    fileSuggestions?: string[];
    disabled?: boolean;
    working?: boolean;
    onStop?: () => void;
    placeholder?: string;
  };
}) {
  const hasDecision = !!(question || permission);

  return (
    <div className="mx-auto max-w-[880px] space-y-3">
      {/* Decision surface – highest priority slot */}
      {hasDecision && (
        <InteractionPrompt
          question={question}
          permission={question ? undefined : permission}
          origin={origin}
          fileSuggestions={composer.fileSuggestions}
          onAnswer={onAnswer}
          onReject={onReject}
          onPermission={onPermission}
        />
      )}

      {/* Mode switch – hidden during decision surface */}
      <div className={cn(hasDecision && 'hidden')}>
        <ModeSwitch mode={permissionMode} onChange={onPermissionModeChange} />
      </div>

      {/* Composer – always mounted, visually hidden during decision surface */}
      <div className={cn(hasDecision && 'composer-decision-hidden')}>
        <Composer
          onSend={composer.onSend}
          onRunShell={composer.onRunShell}
          onRunCommand={composer.onRunCommand}
          commands={composer.commands}
          fileSuggestions={composer.fileSuggestions}
          disabled={composer.disabled}
          working={composer.working}
          onStop={composer.onStop}
          placeholder={composer.placeholder}
        />
      </div>
    </div>
  );
}
