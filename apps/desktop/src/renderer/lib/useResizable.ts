import { useCallback, useRef, useState } from 'react';

/** Drag-to-resize hook. Manipulates the target element's width directly via
 *  DOM during drag (no React re-renders). Commits the final width to state
 *  on mouseup so the layout reflows once.
 *
 *  `isDragging` is true while the user is actively dragging — use it to
 *  hide heavy pane content (content-visibility: hidden) so the browser
 *  skips layout for iframes, code viewers, etc. during the drag.
 *
 *  Set `reverse` for right-side panels where dragging left should grow. */
export function useResizable(initialWidth: number, min = 180, max = Infinity, reverse = false) {
  const committedWidth = useRef(initialWidth);
  const targetRef = useRef<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = targetRef.current ? targetRef.current.offsetWidth : committedWidth.current;
      setIsDragging(true);

      const onMouseMove = (ev: MouseEvent) => {
        const raw = ev.clientX - startX;
        const delta = reverse ? -raw : raw;
        const next = Math.min(max, Math.max(min, startW + delta));
        if (targetRef.current) {
          targetRef.current.style.width = `${next}px`;
        }
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Commit the final width so React knows about it.
        if (targetRef.current) {
          committedWidth.current = targetRef.current.offsetWidth;
        }
        setIsDragging(false);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [min, max, reverse],
  );

  return { targetRef, handleProps: { onMouseDown }, isDragging };
}
