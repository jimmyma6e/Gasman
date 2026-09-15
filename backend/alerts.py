"""Price alert evaluation — runs after every price refresh, checks each
active, non-suppressed alert against the freshly scraped prices, and emails
the owner once per match batch when a trigger condition is met.
"""

import logging

import database
from email_alerts import send_alert_email

logger = logging.getLogger(__name__)

FUEL_LABELS = {
    "regular_gas":  "Regular (87)",
    "midgrade_gas": "Mid-Grade (89)",
    "premium_gas":  "Premium",
    "diesel":       "Diesel",
}

BASELINE_LABELS = {"ytd": "YTD average", "2d": "2-day average", "3d": "3-day average"}


def _resolve_station_ids(alert: dict):
    """None means "no filter" — the alert's scope is 'any' station."""
    if alert["scope_type"] == "stations":
        return alert["scope_values"] or []
    if alert["scope_type"] == "cities":
        return database.get_station_ids_for_cities(alert["scope_values"] or [])
    return None


def _find_hits(alert: dict, station_ids, fuel_type: str) -> list:
    trigger_type = alert["trigger_type"]
    cfg = alert["trigger_config"] or {}
    if trigger_type == "fixed_price":
        return database.find_fixed_price_hits(station_ids, fuel_type, cfg.get("price"))
    if trigger_type == "lowest_over_days":
        return database.find_new_low_hits(station_ids, fuel_type, cfg.get("days", 7))
    if trigger_type == "below_baseline":
        return database.find_below_baseline_hits(station_ids, fuel_type, cfg.get("baseline", "3d"))
    return []


def _describe_trigger(alert: dict) -> str:
    cfg = alert["trigger_config"] or {}
    if alert["trigger_type"] == "fixed_price":
        return f"price at or below {cfg.get('price')}¢/L"
    if alert["trigger_type"] == "lowest_over_days":
        return f"a new low for the last {cfg.get('days', 7)} day(s)"
    return f"below its {BASELINE_LABELS.get(cfg.get('baseline'), cfg.get('baseline'))}"


def _format_email(alert: dict, hits_by_fuel: dict) -> tuple:
    lines = []
    for fuel_type, hits in hits_by_fuel.items():
        label = FUEL_LABELS.get(fuel_type, fuel_type)
        for h in hits:
            lines.append(f"- {h['name']} ({label}): {h['price']:.1f}¢/L")
    match_count = len(lines)
    subject = f"⛽ GASMAN price alert — {match_count} match{'es' if match_count != 1 else ''}"
    body = (
        f"Your GASMAN price alert triggered ({_describe_trigger(alert)}):\n\n"
        + "\n".join(lines)
        + "\n\nOpen GASMAN to see details."
    )
    return subject, body


async def run_alert_checks() -> None:
    alerts = database.get_evaluable_alerts()
    if not alerts:
        return

    logger.info("run_alert_checks: evaluating %d alert(s) …", len(alerts))
    for alert in alerts:
        try:
            station_ids = _resolve_station_ids(alert)
            # An empty (not None) list means the scope resolved to nothing —
            # e.g. a city with no known stations — so there's nothing to check.
            if station_ids is not None and not station_ids:
                continue

            hits_by_fuel = {}
            for fuel_type in alert["fuel_types"] or []:
                hits = _find_hits(alert, station_ids, fuel_type)
                if hits:
                    hits_by_fuel[fuel_type] = hits

            if not hits_by_fuel:
                continue

            subject, body = _format_email(alert, hits_by_fuel)
            if send_alert_email(alert["email"], subject, body):
                database.mark_alert_triggered(alert["id"])
                logger.info("run_alert_checks: alert %d triggered, emailed %s", alert["id"], alert["email"])
        except Exception:
            logger.exception("run_alert_checks: failed to evaluate alert %s", alert.get("id"))
