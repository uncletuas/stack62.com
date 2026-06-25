#!/usr/bin/env python3
"""Diagnose how the coworker routes a spread of realistic messages.

Shows, per message, which tier handled it and whether it escalated to the
(currently unbilled) OpenAI frontier. BASE defaults to the live site.
"""
import json, os, time, urllib.request

BASE = os.environ.get("BASE", "https://stack62.loopital.com").rstrip("/") + "/v1"

def req(method, path, token=None, body=None, stream=False, timeout=180):
    data = json.dumps(body).encode() if body is not None else None
    h = {"Content-Type": "application/json"}
    if token: h["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=h, method=method)
    resp = urllib.request.urlopen(r, timeout=timeout)
    return resp if stream else json.loads(resp.read().decode() or "{}")

def run(token, org, ws, prompt):
    body = {"organizationId": org, "prompt": prompt}
    if ws: body["workspaceId"] = ws
    resp = req("POST", "/engine/run", token=token, body=body, stream=True)
    routed = done = err = None; msg = ""
    cur = {}
    for raw in resp:
        line = raw.decode("utf-8", "replace").rstrip("\n")
        if line.startswith("event:"): cur["event"] = line[6:].strip()
        elif line.startswith("data:"):
            try: cur["data"] = json.loads(line[5:].strip())
            except Exception: cur["data"] = {}
        elif line == "":
            e = cur.get("event"); d = cur.get("data", {})
            if e == "session.routed": routed = d
            elif e == "session.complete": done = d
            elif e == "session.error": err = d
            elif e == "message.complete": msg = d.get("text", "")
            cur = {}
    return routed, done, err, msg

def main():
    email = f"diag+{int(time.time())}@stack62.loopital.com"
    reg = req("POST", "/auth/register", body={"email": email, "password": "Test12345!",
        "firstName": "Di", "lastName": "Ag", "accountType": "organization",
        "organizationName": "Diag Co", "organizationRole": "Founder"})
    token = reg["accessToken"]
    org = req("GET", "/organizations", token=token)
    org = (org if isinstance(org, list) else org.get("data", []))[0]["id"]
    ws = req("GET", f"/workspaces?organizationId={org}", token=token)
    ws = (ws if isinstance(ws, list) else ws.get("data", []))
    ws = ws[0]["id"] if ws else None

    prompts = [
        "hi",
        "list my systems",
        "what can you do",
        "summarize this: our revenue grew 12% in Q3 driven by enterprise deals",
        "who is on my team?",
        "help me write a welcome email to a new customer named Sarah",
        "what are three ways I can improve customer retention?",
        "create a task to follow up with the supplier tomorrow",
    ]
    print(f"{'TIER':<6}{'OPENAI?':<9}{'REASON / ERROR':<45} PROMPT")
    print("-"*100)
    for p in prompts:
        try:
            routed, done, err, msg = run(token, org, ws, p)
            tier = routed.get("tier") if routed else "?"
            reason = (routed or {}).get("reason", "")
            hit_openai = "YES" if (err or (done and tier in (2,3))) else "no"
            note = (err.get("message","")[:42] if err else reason[:42])
            print(f"{str(tier):<6}{hit_openai:<9}{note:<45} {p[:40]}")
        except Exception as e:
            print(f"{'ERR':<6}{'?':<9}{str(e)[:42]:<45} {p[:40]}")

if __name__ == "__main__":
    main()
