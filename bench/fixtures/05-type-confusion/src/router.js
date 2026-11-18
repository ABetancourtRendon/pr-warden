import { isSupportedVersion } from './validate.js';
import { isEnabled, lookupFlag } from './features.js';

// Maps parsed query parameters (always strings) onto the typed helpers.

export function parseQuery(search) {
  return new URLSearchParams(search);
}

export function handleQuery(params) {
  const version = params.get('v');
  if (!isSupportedVersion(version)) {
    return { status: 400, error: 'unsupported version' };
  }
  const feature = params.get('feature');
  if (!feature) {
    return { status: 200, version, feature: null, enabled: false };
  }
  const enabled = isEnabled(lookupFlag(feature));
  return { status: 200, version, feature, enabled };
}
