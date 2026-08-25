// Premium octane varies by brand in BC; regular/mid-grade are consistent
// across retailers. Falls back to the common 91 for unlisted brands.
export const PREMIUM_OCTANE_BY_BRAND = {
  "Petro-Canada": 94,
  "Esso":         93,
  "Shell":        93,
};
export const DEFAULT_OCTANE = { regular_gas: 87, midgrade_gas: 89, premium_gas: 91 };

export function octaneLabel(fuelKey, brand) {
  if (fuelKey === "premium_gas") {
    return String(PREMIUM_OCTANE_BY_BRAND[brand] ?? DEFAULT_OCTANE.premium_gas);
  }
  return String(DEFAULT_OCTANE[fuelKey] ?? "");
}
