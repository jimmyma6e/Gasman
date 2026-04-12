// Canadian credit card gas discount data
// Three benefit types:
//   "partner"  — fixed ¢/L at specific station brands only
//   "cashback" — % back at any station (converted to effective ¢/L)
//   "combo"    — partner discount at specific brands + cashback anywhere (stacked)

export const CREDIT_CARDS = [
  // ── Combo cards (partner discount + cashback, stacked) ───────────────────────
  {
    id: "rbc-avion-petro",
    bank: "RBC",
    name: "RBC Avion Visa Infinite",
    type: "combo",
    discount_cpl: 3,
    partner_brands: ["Petro-Canada"],
    cashback_pct: 1.5,
    color: "#005daa",
    note: "3¢/L at Petro-Canada + 1.5% Avion pts anywhere",
  },
  {
    id: "cibc-dividend-journie",
    bank: "CIBC",
    name: "CIBC Dividend + Journie",
    type: "combo",
    discount_cpl: 3,
    partner_brands: ["Fas Gas", "Chevron", "Ultramar"],
    cashback_pct: 4,
    color: "#c41230",
    note: "4% cashback + 3¢/L at Fas Gas, Chevron & Ultramar",
  },

  // ── Partner discounts (fixed ¢/L at specific brands only) ───────────────────
  {
    id: "rbc-petro",
    bank: "RBC",
    name: "RBC Credit Card (basic)",
    type: "partner",
    discount_cpl: 3,
    partner_brands: ["Petro-Canada"],
    color: "#005daa",
    note: "3¢/L instant discount at Petro-Canada",
  },
  {
    id: "cibc-journie",
    bank: "CIBC",
    name: "CIBC + Journie only",
    type: "partner",
    discount_cpl: 3,
    partner_brands: ["Fas Gas", "Chevron", "Ultramar"],
    color: "#c41230",
    note: "3¢/L at Fas Gas, Chevron & Ultramar (no cashback)",
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

  // ── General cashback (% back at any station) ─────────────────────────────────
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
    name: "BMO CashBack World Elite MC",
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
    name: "Simplii Cash Back Visa",
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

// Effective savings in ¢/L for a card at a given price.
// atPartnerBrand matters for combo cards (stacks partner + cashback).
export function effectiveSavings(card, priceCpl, atPartnerBrand = false) {
  if (card.type === "partner") return card.discount_cpl;
  const cashback = Math.round(priceCpl * (card.cashback_pct / 100) * 10) / 10;
  if (card.type === "cashback") return cashback;
  if (card.type === "combo") {
    // At a partner brand: stack the fixed ¢/L discount on top of cashback
    if (atPartnerBrand) return Math.round((card.discount_cpl + cashback) * 10) / 10;
    return cashback;
  }
  return 0;
}

// Best applicable card + savings for a station.
// Returns { card, savings, atPartner } or null.
export function bestCardSavings(selectedCardIds, priceCpl, stationBrand) {
  if (!selectedCardIds || !selectedCardIds.length || !priceCpl) return null;
  let best = null;
  for (const card of CREDIT_CARDS) {
    if (!selectedCardIds.includes(card.id)) continue;

    let atPartner = false;
    if (card.type === "partner") {
      if (!card.partner_brands.includes(stationBrand)) continue; // not applicable
    } else if (card.type === "combo") {
      atPartner = card.partner_brands.includes(stationBrand);
    }

    const savings = effectiveSavings(card, priceCpl, atPartner);
    if (!best || savings > best.savings) best = { card, savings, atPartner };
  }
  return best;
}
