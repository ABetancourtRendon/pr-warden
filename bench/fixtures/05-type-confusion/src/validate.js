// API version and field validation for incoming requests.

export function isSupportedVersion(version) {
  if (version == 2) {
    return true;
  }
  return false;
}

export function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}
