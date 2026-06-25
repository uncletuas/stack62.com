# Launch Stack62 on AWS (single EC2)

Runs the **entire stack** — API, worker, Postgres, Redis, the local Ollama model,
and the frontend — on one EC2 instance via docker-compose, behind Caddy at a
single URL. Chosen setup: **single EC2, CPU-only (no GPU), eu-west-1**.

```
provision.sh ─▶ EC2 (Ubuntu, docker)         deploy.sh ─▶ ship code + compose up
                                              ▲
   docker-compose.yml + docker-compose.aws.yml on the box:
   web(Caddy) ─▶ api ─▶ postgres / redis / ollama   + worker
```

## Cost (eu-west-1, on-demand — your credits offset this)

| Item | Approx. |
| --- | --- |
| `m6i.2xlarge` (8 vCPU / 32 GB) | ~$0.45/hr ≈ **$330/mo** if left on 24/7 |
| 100 GB gp3 EBS | ~$8/mo |
| Data transfer (light testing) | a few $ |

**Pause billing:** `aws ec2 stop-instances …` (keeps data, ~$8/mo for the disk).
**Stop billing entirely:** `./teardown.sh` (terminates the instance).
Cheaper while testing: set `INSTANCE_TYPE=m6i.xlarge` (16 GB) — fine if you keep
the local model light or run cloud-only.

## Prerequisites (one-time, on the machine that drives this)

1. **AWS CLI v2** — https://aws.amazon.com/cli/ (Windows: run the MSI installer).
   Verify in a new terminal: `aws --version`.
2. **An IAM user/role** with EC2 + VPC + SSM-read permissions (the
   `AmazonEC2FullAccess` managed policy is enough for this).
3. **Configure credentials** for eu-west-1:
   ```bash
   aws configure
   # AWS Access Key ID / Secret / region: eu-west-1 / output: json
   aws sts get-caller-identity   # should print your account
   ```
4. An **OpenAI API key** (optional — only for high-level/frontier tasks; the
   local model handles routine work without it).

## Launch

```bash
cd deploy/aws

# 1. Provision the instance (key pair + security group + EC2). ~2 min.
bash provision.sh

# 2. Configure secrets.
cp .env.aws.example .env.aws
#    edit .env.aws — set JWT_SECRET, DATABASE_PASSWORD, OPENAI_API_KEY
#    (JWT_SECRET: `openssl rand -hex 32`)

# 3. Ship the code and bring everything up. First run pulls + builds the local
#    model and Docker images — allow ~10–15 min.
bash deploy.sh
```

When `deploy.sh` finishes it prints the URL: **http://<instance-ip>**.

## Verify

```bash
source .state
curl http://$PUBLIC_IP:3000/v1/health                       # API up
ssh -i "$KEY_PATH" ubuntu@$PUBLIC_IP \
  'sudo docker exec stack62-ollama ollama list'             # stack62-local present
ssh -i "$KEY_PATH" ubuntu@$PUBLIC_IP \
  'cd /opt/stack62 && sudo docker compose ps'               # all services healthy
```

Open `http://<instance-ip>` in a browser → the frontend loads and talks to the
API on the same origin. Then follow `docs/intelligence-layer-testing.md` to
exercise the local routing, cache, budget, and widget.

## Redeploy after code changes

Re-run `bash deploy.sh` — it re-ships the working tree and rebuilds the
containers. Postgres/Redis/Ollama volumes persist, so data and the local model
survive redeploys.

## HTTPS / custom domain

1. Point a DNS A record at the instance IP.
2. In `Caddyfile`, replace `:80` with your domain (e.g. `app.example.com`).
3. Re-run `deploy.sh`. Caddy auto-provisions a Let's Encrypt cert (443 is open).
4. Set `CORS_ORIGIN=https://app.example.com` in `.env.aws`.

## Teardown

```bash
bash teardown.sh        # terminate the instance (stops compute billing)
bash teardown.sh --all  # also remove the security group + key pair
```

## Notes / limits

- `BROWSER_ENABLED=true` by default. The in-app browser runs server-side
  Playwright/Chromium; the Dockerfile installs Chromium + its system libs, so
  the service needs >=512MB RAM. Set to `false` to disable it (and the coworker
  `web.*` tools).
- CPU inference: the local 7B model answers in a few seconds. For snappy
  responses, relaunch on a GPU instance (`g4dn.xlarge`) and uncomment the GPU
  block in `docker-compose.yml` (needs the NVIDIA driver/AMI).
- `DATABASE_SYNC=true` creates tables on first boot; switch to migrations once
  the schema is settled.
