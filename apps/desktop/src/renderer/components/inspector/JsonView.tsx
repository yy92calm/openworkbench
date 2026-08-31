import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface Props {
  data: unknown;
}

export function JsonView({ data }: Props) {
  return (
    <div className="p-3 font-mono text-xs leading-5">
      <JsonNode value={data} depth={0} />
    </div>
  );
}

function JsonNode({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span className="text-muted">null</span>;
  if (value === undefined) return <span className="text-muted">undefined</span>;
  if (typeof value === 'boolean') return <span className="text-muted">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-[#c98a2b]">{value}</span>;
  if (typeof value === 'string') {
    const display = value.length > 80 ? `"${value.slice(0, 77)}..."` : `"${value}"`;
    return <span className="text-[#4b8b5b]">{display}</span>;
  }
  if (Array.isArray(value)) return <JsonArray value={value} depth={depth} />;
  return <JsonObject value={value as Record<string, unknown>} depth={depth} />;
}

function JsonObject({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth >= 2);
  const keys = Object.keys(value);
  const pad = { paddingLeft: depth * 16 };

  if (collapsed) {
    return (
      <span
        className="cursor-pointer text-text hover:text-accent"
        onClick={() => setCollapsed(false)}
        style={pad}
      >
        <ChevronRight size={12} className="mr-0.5 inline align-middle" />
        {'{'} <span className="text-muted">{keys.length} keys</span> {'}'}
      </span>
    );
  }

  return (
    <div style={pad}>
      <span
        className="cursor-pointer text-text hover:text-accent"
        onClick={() => setCollapsed(true)}
      >
        <ChevronDown size={12} className="mr-0.5 inline align-middle" />
        {'{'}
      </span>
      {keys.map((key) => (
        <div key={key} style={{ paddingLeft: 16 }}>
          <span className="text-[#2a6fdb]">{key}</span>
          <span className="text-muted">: </span>
          <JsonNode value={value[key]} depth={depth + 1} />
        </div>
      ))}
      <span>{'}'}</span>
    </div>
  );
}

function JsonArray({ value, depth }: { value: unknown[]; depth: number }) {
  const [collapsed, setCollapsed] = useState(depth >= 2);
  const pad = { paddingLeft: depth * 16 };

  if (collapsed) {
    return (
      <span
        className="cursor-pointer text-text hover:text-accent"
        onClick={() => setCollapsed(false)}
        style={pad}
      >
        <ChevronRight size={12} className="mr-0.5 inline align-middle" />[
        <span className="text-muted">{value.length} items</span>]
      </span>
    );
  }

  return (
    <div style={pad}>
      <span
        className="cursor-pointer text-text hover:text-accent"
        onClick={() => setCollapsed(true)}
      >
        <ChevronDown size={12} className="mr-0.5 inline align-middle" />[
      </span>
      {value.map((item, i) => (
        <div key={i} style={{ paddingLeft: 16 }}>
          <JsonNode value={item} depth={depth + 1} />
          {i < value.length - 1 && <span className="text-muted">,</span>}
        </div>
      ))}
      <span>]</span>
    </div>
  );
}
