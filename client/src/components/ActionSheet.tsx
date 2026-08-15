interface ActionOption {
  label: string;
  danger?: boolean;
  onClick: () => void;
}

interface Props {
  title?: string;
  options: ActionOption[];
  onCancel: () => void;
}

/** Bottom sheet for confirmation actions (mobile-friendly alternative to
 *  center ConfirmDialog). Renders an overlay + a sheet sliding up from bottom. */
export function ActionSheet({ title, options, onCancel }: Props) {
  return (
    <div className="action-sheet-overlay" onClick={onCancel}>
      <div className="action-sheet" onClick={(e) => e.stopPropagation()}>
        {title && <div className="action-sheet-title">{title}</div>}
        {options.map((opt, i) => (
          <button
            key={i}
            className={`action-sheet-option ${opt.danger ? "danger" : ""}`}
            onClick={() => { opt.onClick(); }}
          >
            {opt.label}
          </button>
        ))}
        <button className="action-sheet-cancel" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
