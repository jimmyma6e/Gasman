// Canadian credit card gas discount data
// Two benefit types:
//   "partner"  — fixed cents/litre at specific station brands
//   "cashback" — percentage back at any station (converted to effective ¢/L at display time)

export const CREDIT_CARDS = [
  // ── Partner discounts ────────────────────────────────────────────────────────
  {
    id: "rbc-petro",
    bank: "RBC",
    name: "RBC Credit Card",
    type: "partner",
    discount_cpl: 3,
    partner_brands: ["Petro-Canada"],
    color: "#005daa",
    note: "3¢/L instant discount at Petro-Canada",
  },
  {
    id: "cibc-journie",
    bank: "CIBC",
    name: "CIBC + Journie Rewards",
    type: "partner",
    discount_cpl: 3,
    partner_brands: ["Fas Gas", "Chevron", "Ultramar"],
    color: "#c41230",
    note: "3¢/L at Fas Gas, Chevron & Ultramar",
  },
  {
    id: "ct-triangle",
    bank: "Canadian Tire",
    name: "Triangle Mastercard",
    type: "partner",
    discount_cpl: 10,
    partner_brands: ["Canadian Tire"],
    color: "#e4262b",
    note: "10¢/L in CT Money at Canadian Tire Gas+",
  },
  {
    id: "pc-esso",
    bank: "PC Financial",
    name: "PC Insiders World Elite MC",
    type: "partner",
    discount_cpl: 7,
    partner_brands: ["Esso"],
    color: "#003087",
    note: "~7¢/L in PC Optimum points at Esso",
  },

  // ── General cashback (any station) ──────────────────────────────────────────
  {
    id: "cibc-dividend-infinite",
    bank: "CIBC",
    name: "CIBC Dividend Visa Infinite",
    type: "cashback",
    cashback_pct: 4,
    color: "#c41230",
    note: "4% cash back on gas at any station",
  },
  {
    id: "amex-simplycash-preferred",
    bank: "Amex",
    name: "Amex SimplyCash Preferred",
    type: "cashback",
    cashback_pct: 4,
    color: "#006fcf",
    note: "4% cash back on gas at any station",
  },
  {
    id: "bmo-cashback-world-elite",
    bank: "BMO",
    name: "BMO CashBack World Elite Mastercard",
    type: "cashback",
    cashback_pct: 3,
    color: "#0079c1",
    note: "3% cash back on gas at any station",
  },
  {
    id: "td-cashback-infinite",
    bank: "TD",
    name: "TD Cash Back Visa Infinite",
    type: "cashback",
    cashback_pct: 3,
    color: "#34b233",
    note: "3% cash back on gas at any station",
  },
  {
    id: "scotia-momentum-infinite",
    bank: "Scotiabank",
    name: "Scotia Momentum Visa Infinite",
    type: "cashback",
    cashback_pct: 2,
    color: "#ec1c24",
    note: "2% cash back on gas at any station",
  },
  {
    id: "tangerine-moneyback",
    bank: "Tangerine",
    name: "Tangerine Money-Back Card",
    type: "cashback",
    cashback_pct: 2,
    color: "#f55d2a",
    note: "2% if gas selected as a category",
  },
  {
    id: "rbc-ion-plus",
    bank: "RBC",
    name: "RBC ION+ Visa",
    type: "cashback",
    cashback_pct: 1.5,
    color: "#005daa",
    note: "3 Avion pts/$ on gas (~1.5% value)",
  },
  {
    id: "simplii-cashback",
    bank: "Simplii",
    name: "Simplii Financial Cash Back Visa",
    type: "cashback",
    cashback_pct: 1.5,
    color: "#e51b24",
    note: "1.5% cash back on gas",
  },
  {
    id: "bmo-cashback-mc",
    bank: "BMO",
    name: "BMO CashBack Mastercard",
    type: "cashback",
    cashback_pct: 1,
    color: "#0079c1",
    note: "1% cash back on gas at any station",
  },
  {
    id: "scotia-momentum-mc",
    bank: "Scotiabank",
    name: "Scotia Momentum Mastercard",
    type: "cashback",
    cashback_pct: 1,
    color: "#ec1c24",
    note: "1% cash back on gas",
  },
];

// Effective savings in ¢/L for a given card and pump price
export function effectiveSavings(card, priceCpl) {
  if (card.type === "partner") return card.discount_cpl;
  return Math.round(priceCpl * (card.cashback_pct / 100) * 10) / 10;
}

// Best applicable card + savings for a station (highest savings wins)
// partner cards only apply to their listed brands; cashback applies everywhere
export function bestCardSavings(selectedCardIds, priceCpl, stationBrand) {
  if (!selectedCardIds || !selectedCardIds.length || !priceCpl) return null;
  let best = null;
  for (const card of CREDIT_CARDS) {
    if (!selectedCardIds.includes(card.id)) continue;
    if (card.type === "partner" && !card.partner_brands.includes(stationBrand)) continue;
    const savings = effectiveSavings(card, priceCpl);
    if (!best || savings > best.savings) best = { card, savings };
  }
  return best; // { card, savings } or null
}
