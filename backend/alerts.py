"""Price alert evaluation — runs after every price refresh, checks each
active, non-suppressed alert against the freshly scraped prices, and emails
the owner once per match batch when a trigger condition is met.
"""

import logging
import os

import database
from email_alerts import send_alert_email

logger = logging.getLogger(__name__)

# Linked from every alert email so the reader lands on live, current data
# instead of trusting numbers that may already be stale by the time they
# read the email.
SITE_URL = os.environ.get("SITE_URL", "https://gasman.sportsup.ca")

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


def _describe_scope(alert: dict) -> str:
    if alert["scope_type"] == "any":
        return "any station"
    if alert["scope_type"] == "cities":
        return ", ".join(alert["scope_values"] or []) or "no cities selected"
    n = len(alert["scope_values"] or [])
    return f"{n} selected station{'s' if n != 1 else ''}"


def _describe_fuels(alert: dict) -> str:
    return ", ".join(FUEL_LABELS.get(f, f) for f in (alert["fuel_types"] or [])) or "no gas types selected"


def send_confirmation_email(alert: dict) -> bool:
    """Sent once, immediately when an alert is created — confirms it's live
    and doubles as a way to verify SMTP is actually configured correctly
    without waiting for a real price trigger, which could take a while.
    """
    subject = "⛽ GASMAN price alert created"
    body = (
        "Your GASMAN price alert is set up and watching:\n\n"
        f"- Stations: {_describe_scope(alert)}\n"
        f"- Gas type: {_describe_fuels(alert)}\n"
        f"- Trigger: {_describe_trigger(alert)}\n"
        f"- Quiet period after triggering: {alert['suppress_hours']}h\n\n"
        "Prices are checked roughly every 30 minutes. You'll get another "
        "email the next time this condition is met.\n\n"
        f"View it anytime: {SITE_URL}"
    )
    return send_alert_email(alert["email"], subject, body)


def _format_email(alert: dict, hits_by_fuel: dict) -> tuple:
    all_hits = [(fuel_type, h) for fuel_type, hits in hits_by_fuel.items() for h in hits]
    match_count = len(all_hits)
    best_fuel, best = min(all_hits, key=lambda item: item[1]["price"])
    best_label = FUEL_LABELS.get(best_fuel, best_fuel)
    others = match_count - 1

    subject = f"⛽ GASMAN price alert — {match_count} match{'es' if match_count != 1 else ''}"
    body = (
        f"Your GASMAN price alert triggered ({_describe_trigger(alert)}).\n\n"
        f"Best match: {best['name']} ({best_label}) at {best['price']:.1f}¢/L"
        + (f", plus {others} more match{'es' if others != 1 else ''}" if others > 0 else "")
        + f".\n\nSee current prices: {SITE_URL}\n\n"
        f"We'll stay quiet for {alert['suppress_hours']}h before checking again."
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
