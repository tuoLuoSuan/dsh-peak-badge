/**
 * Host half of the peak-badge bundle.
 *
 * Deliberately empty: every input this badge needs is already on the client —
 * the policy is a pure function of Beijing wall time plus a hardcoded holiday
 * table, so there is nothing to fetch and nothing to schedule host-side.
 */
export function apply() {}
