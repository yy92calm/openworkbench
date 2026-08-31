import { useParams } from 'react-router-dom';

import { EmptyState } from '@/components/cards/EmptyState';
import { InspectorShell } from '@/components/inspector/InspectorShell';
import { ThreadView } from '@/components/thread/ThreadView';
import { findSession } from '@/lib/mock';
import { useUiStore } from '@/lib/store';

export function SessionPage() {
  const { sessionId } = useParams();
  const session = sessionId ? findSession(sessionId) : undefined;
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const setInspectorOpen = useUiStore((s) => s.setInspectorOpen);

  if (!session) {
    return <EmptyState title="未找到会话" hint="从侧边栏选择一个会话。" />;
  }

  const showInspector = inspectorOpen && !!session.inspector;

  return (
    <div className="flex h-full min-w-0">
      <div className="min-w-0 flex-1">
        <ThreadView session={session} />
      </div>
      {showInspector && (
        <div className="hidden w-[46%] max-w-[720px] shrink-0 lg:block">
          <InspectorShell inspector={session.inspector!} onClose={() => setInspectorOpen(false)} />
        </div>
      )}
    </div>
  );
}
