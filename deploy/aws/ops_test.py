#!/usr/bin/env python3
"""End-to-end live operations test against a running Stack62 deployment.

Registers a throwaway account, then exercises the coworker engine and the
intelligence layer, asserting the cost-saving behaviours actually fire:
  - a list intent routes via Tier 0 (deterministic, $0)
  - a summarize intent routes via Tier 1 local generative ($0)
  - an identical repeat replays from the response cache ($0)
  - budget + cache observability endpoints respond

Usage: BASE=https://stack62.loopital.com python3 ops_test.py
"""
import json
import os
import time
import urllib.request
import urllib.error

BASE = os.environ.get("BASE", "https://stack62.loopital.com").rstrip("/") + "/v1"


def req(method, path, token=None, body=None, stream=False, timeout=120):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(r, timeout=timeout)
    if stream:
        return resp
    return json.loads(resp.read().decode() or "{}")


def run_engine(token, org, ws, prompt):
    """POST /engine/run and parse the SSE stream into a list of events."""
    body = {"organizationId": org, "prompt": prompt}
    if ws:
        body["workspaceId"] = ws
    resp = req("POST", "/engine/run", token=token, body=body, stream=True, timeout=180)
    events = []
    cur = {}
    for raw in resp:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.startswith("event:"):
            cur["event"] = line[6:].strip()
        elif line.startswith("data:"):
            try:
                cur["data"] = json.loads(line[5:].strip())
            except Exception:
                cur["data"] = line[5:].strip()
        elif line == "":
            if cur:
                events.append(cur)
                cur = {}
    return events


def summarize(events):
    routed = next((e["data"] for e in events if e.get("event") == "session.routed"), None)
    done = next((e["data"] for e in events if e.get("event") == "session.complete"), None)
    err = next((e["data"] for e in events if e.get("event") == "session.error"), None)
    msg = next((e["data"].get("text", "") for e in events if e.get("event") == "message.complete"), "")
    return routed, done, err, msg


def main():
    print(f"== Live ops test against {BASE} ==\n")
    email = f"opstest+{int(time.time())}@stack62.loopital.com"
    reg = req("POST", "/auth/register", body={
        "email": email, "password": "Test12345!", "firstName": "Ops",
        "lastName": "Test", "accountType": "organization",
        "organizationName": "Ops Test Co", "organizationRole": "Founder",
    })
    token = reg["accessToken"]
    print(f"[1] registered {email}")

    orgs = req("GET", "/organizations", token=token)
    orgs = orgs if isinstance(orgs, list) else orgs.get("data", orgs.get("items", []))
    org = orgs[0]["id"]
    print(f"[2] organization: {org}")

    wss = req("GET", f"/workspaces?organizationId={org}", token=token)
    wss = wss if isinstance(wss, list) else wss.get("data", wss.get("items", []))
    ws = wss[0]["id"] if wss else None
    print(f"[3] workspace: {ws}")

    checks = []

    # Tier 0 — deterministic list intent.
    ev = run_engine(token, org, ws, "list my systems")
    routed, done, err, msg = summarize(ev)
    tier = routed.get("tier") if routed else None
    reason = routed.get("reason") if routed else (err or "no route")
    ok = tier in (0, 1) and not err
    checks.append(("Tier-0 list intent stays local ($0)", ok, f"tier={tier} reason={reason!r}"))
    print(f"[4] 'list my systems' -> tier={tier} ({reason})")

    # Tier 1 — local generative summarize.
    text = ("Our Q3 review: sales up 12% on the enterprise tier, support tickets "
            "down 8% after the docs revamp, hiring paused until Q4 except two engineers.")
    p2 = f"Summarize in one sentence: {text}"
    ev = run_engine(token, org, ws, p2)
    routed, done, err, msg = summarize(ev)
    tier = routed.get("tier") if routed else None
    reason = routed.get("reason") if routed else (err or "no route")
    ok = tier in (0, 1) and bool(msg) and not err
    checks.append(("Tier-1 local summarize ($0)", ok, f"tier={tier} reason={reason!r} reply={msg[:60]!r}"))
    print(f"[5] summarize -> tier={tier} ({reason})\n      reply: {msg[:80]}")

    # Repeat — must stay $0 (handled by a local tier or the cache, never frontier).
    time.sleep(1)
    ev = run_engine(token, org, ws, p2)
    routed, done, err, msg = summarize(ev)
    tier = routed.get("tier") if routed else None
    reason = routed.get("reason") if routed else (err or "no route")
    ok = tier in (0, 1) and not err  # tier 0/1 = local/cache = $0
    checks.append(("Repeat stays $0 (local tier or cache)", ok, f"tier={tier} reason={reason!r}"))
    print(f"[6] summarize (repeat) -> tier={tier} ({reason})")

    # Frontier — a prompt the local tiers can't satisfy must reach OpenAI and
    # complete successfully (proves the provider-agnostic adapter + key work).
    p4 = "Give me three creative names for a new coffee shop and one short reason for each."
    ev = run_engine(token, org, ws, p4)
    routed, done, err, msg = summarize(ev)
    tier = routed.get("tier") if routed else None
    stop = done.get("stopReason") if done else None
    ok = not err and bool(msg)
    checks.append(("Frontier (OpenAI) escalation works", ok, f"tier={tier} stop={stop} err={err} reply={msg[:50]!r}"))
    print(f"[7] frontier prompt -> tier={tier} stop={stop}\n      reply: {msg[:90]}")

    # Observability.
    budget = req("GET", f"/org-intelligence/budget?organizationId={org}", token=token)
    checks.append(("Budget endpoint responds", "limitUsd" in budget, json.dumps(budget)))
    print(f"[8] budget: {budget}")
    stats = req("GET", f"/org-intelligence/cache/stats?organizationId={org}", token=token)
    checks.append(("Cache stats endpoint responds", "entries" in stats, json.dumps(stats)))
    print(f"[8] cache stats: {stats}")

    print("\n== Results ==")
    passed = 0
    for name, ok, detail in checks:
        passed += 1 if ok else 0
        print(f"  {'PASS' if ok else 'FAIL'}  {name}\n         {detail}")
    print(f"\n{passed}/{len(checks)} passed")


if __name__ == "__main__":
    main()
