type Channel = 'dev' | 'beta' | 'prod';

const raw = process.env.WORKBENCH_CHANNEL;
export const CHANNEL: Channel = raw === 'dev' || raw === 'beta' || raw === 'prod' ? raw : 'prod';

export const APP_NAMES: Record<Channel, string> = {
  dev: 'Workbench Dev',
  beta: 'Workbench Beta',
  prod: 'Workbench',
};

export const APP_IDS: Record<Channel, string> = {
  dev: 'com.workbench.app.dev',
  beta: 'com.workbench.app.beta',
  prod: 'com.workbench.app',
};

export const UPDATER_ENABLED = CHANNEL !== 'dev';
