import { MIN_EVOLVER_VERSION } from './engine-version.mjs';

const MANUAL_INSTALL = 'To set it up by hand: `npm install -g @evomap/evolver@latest`, then `evolver lifecycle start`.';

function retryPhrase(outcome) {
  return outcome.retryAt ? ` The plugin retries automatically after ${new Date(outcome.retryAt).toISOString()}.` : '';
}

const NOTICES = {
  installed: (outcome) => `[Evolver] Evolver was missing, so this plugin installed Evolver ${outcome.version} and started its Proxy.`,
  upgraded: (outcome) => `[Evolver] Evolver ${outcome.previous} was older than ${MIN_EVOLVER_VERSION}, so this plugin upgraded it to ${outcome.version} and started its Proxy.`,
  started: (outcome) => `[Evolver] The Evolver Proxy was not running, so this plugin started it (Evolver ${outcome.version}).`,
  restarted: (outcome) => `[Evolver] The running Evolver Proxy was older than ${MIN_EVOLVER_VERSION}, so this plugin restarted it on Evolver ${outcome.version}.`,
  outdated: (outcome) => `[Evolver] Evolver ${outcome.version} is the newest this plugin could install, and reuse evidence needs ${MIN_EVOLVER_VERSION} or newer`
    + `${outcome.installError ? ` (last upgrade attempt: ${outcome.installError})` : ''}. Recall works meanwhile; the plugin retries the upgrade every 6 hours.`,
  restart_needed: (outcome) => `[Evolver] The running Evolver Proxy is ${outcome.proxyVersion ?? 'an older build'}, older than the installed ${outcome.version}, and this plugin did not start it. `
    + 'Run `evolver lifecycle restart` (or restart the Proxy you started yourself) so reuse evidence reaches the Hub.',
  node_unsupported: (outcome) => `[Evolver] Evolver needs Node.js 22.13 or newer, but Codex runs this plugin's hooks with Node.js ${outcome.node}, so the plugin cannot install or start Evolver. `
    + `Install a newer Node.js and make it the \`node\` on PATH.${retryPhrase(outcome)}`,
  install_failed: (outcome) => `[Evolver] Installing Evolver failed (${outcome.error}). ${MANUAL_INSTALL}${retryPhrase(outcome)}`,
  setup_error: (outcome) => `[Evolver] Setting up Evolver stopped on an unexpected error (${outcome.error}). ${MANUAL_INSTALL}${retryPhrase(outcome)}`,
  start_failed: (outcome) => `[Evolver] Evolver ${outcome.version} is installed but its Proxy did not start (${outcome.error}). `
    + `Check ~/.evomap/logs/evolver-proxy.log, then run \`evolver lifecycle start\`.${retryPhrase(outcome)}`,
};

export function engineNoticeOf(outcome) {
  return NOTICES[outcome?.status]?.(outcome) ?? null;
}
