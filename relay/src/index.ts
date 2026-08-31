/** Relay server — a standalone project (server-side surface only). The remote
 *  client (`client/`) and the Workbench host (`apps/desktop/`) are separate
 *  projects; each keeps its own copy of the wire protocol contract. This
 *  package owns the relay server, account registry, admin CLI and the
 *  authoritative wire protocol definition. */
export type {
  RelayChunk,
  RelayConnectionParams,
  RelayDeviceInfo,
  RelayDeviceList,
  RelayDone,
  RelayListDevices,
  RelayMessage,
  RelayRequest,
  RelayResponseHead,
} from './protocol';
export { parseConnectionParams } from './protocol';
export { type AccountRecord, AccountRegistry, loadRegistry, type RegistryState } from './registry';
export { RelayServer, type RelayServerOptions, startRelayFromEnv } from './server';
