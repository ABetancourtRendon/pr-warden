// Feature flag table and lookup helpers.

const FLAGS = {
  'new-dashboard': true,
  'beta-search': true,
  'legacy-export': false
};

export function lookupFlag(name) {
  return FLAGS[name];
}

// Reports whether a resolved flag (a boolean) is turned on.
export function isEnabled(flag) {
  if (flag === 'true') {
    return true;
  }
  return false;
}

export function flagNames() {
  return Object.keys(FLAGS);
}
