import { RadioTower } from "lucide-react";
import { openDeviceSheet } from "@/lib/connection";

/** Empty-state card shown by device-dependent tabs (Sessions/Tasks/Files)
 *  when the user is logged in but hasn't picked a device yet. The button
 *  triggers the global DeviceSheet via the event bus. */
export function DeviceRequiredCard({ title = "请先选择设备" }: { title?: string }) {
  return (
    <div className="page">
      <div className="device-required-card">
        <RadioTower size={32} style={{ color: "var(--muted)" }} />
        <h2 className="device-required-title">{title}</h2>
        <p className="device-required-desc">
          此功能需要连接到一台桌面端设备。选择设备后即可使用。
        </p>
        <button
          className="btn-primary"
          onClick={() => openDeviceSheet()}
        >
          <RadioTower size={15} />
          选择设备
        </button>
      </div>
    </div>
  );
}
