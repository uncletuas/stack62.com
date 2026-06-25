#!/usr/bin/env python3
"""Live test of the embeddable website widget (token mint + public chat).

The widget answers from a curated knowledge base via the LOCAL model, so it
works at $0 even with no OpenAI billing.

Usage: BASE=https://stack62.loopital.com python3 widget_test.py
"""
import json
import os
import time
import urllib.request

BASE = os.environ.get("BASE", "https://stack62.loopital.com").rstrip("/") + "/v1"


def req(method, path, token=None, widget_token=None, body=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if widget_token:
        headers["x-widget-token"] = widget_token
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    return json.loads(urllib.request.urlopen(r, timeout=timeout).read().decode() or "{}")


def main():
    print(f"== Widget test against {BASE} ==\n")
    email = f"widgettest+{int(time.time())}@stack62.loopital.com"
    reg = req("POST", "/auth/register", body={
        "email": email, "password": "Test12345!", "firstName": "Wid",
        "lastName": "Test", "accountType": "organization",
        "organizationName": "Widget Co", "organizationRole": "Founder",
    })
    token = reg["accessToken"]
    org = req("GET", "/organizations", token=token)
    org = (org if isinstance(org, list) else org.get("data", org.get("items", [])))[0]["id"]
    print(f"[1] registered + org {org}")

    minted = req("POST", "/widget/tokens", token=token, body={
        "organizationId": org,
        "label": "Test site",
        "allowedOrigins": [],  # empty = allow any (dev)
        "greeting": "Hi! Ask me about Acme.",
        "knowledgeBase": "Acme Co sells industrial widgets. Business hours are "
                         "9am-5pm Monday to Friday. Returns are accepted within "
                         "30 days with a receipt. We ship across Nigeria.",
        "useDocumentSearch": False,
    })
    wt = minted["token"]
    print(f"[2] minted widget token: {wt[:16]}…")

    checks = []

    cfg = req("GET", "/widget/config", widget_token=wt)
    checks.append(("Widget config returns greeting", "greeting" in cfg, json.dumps(cfg)))
    print(f"[3] config: {cfg}")

    ans = req("POST", "/widget/chat", widget_token=wt,
              body={"message": "What are your business hours?", "history": []}, timeout=180)
    reply = ans.get("reply", "")
    grounded = "9" in reply and ("5" in reply or "five" in reply.lower())
    checks.append(("Answers from knowledge base (hours)", grounded, reply[:120]))
    print(f"[4] Q: hours -> {reply[:120]}")

    ans2 = req("POST", "/widget/chat", widget_token=wt,
               body={"message": "Do you ship internationally to Canada?", "history": []}, timeout=180)
    reply2 = ans2.get("reply", "")
    # Should NOT invent a yes; KB only mentions Nigeria.
    safe = "canada" not in reply2.lower() or "not" in reply2.lower() or "nigeria" in reply2.lower()
    checks.append(("Stays grounded on unknown (no hallucination)", safe, reply2[:120]))
    print(f"[5] Q: ship to Canada -> {reply2[:120]}")

    print("\n== Results ==")
    passed = 0
    for name, ok, detail in checks:
        passed += 1 if ok else 0
        print(f"  {'PASS' if ok else 'FAIL'}  {name}\n         {detail}")
    print(f"\n{passed}/{len(checks)} passed")


if __name__ == "__main__":
    main()
