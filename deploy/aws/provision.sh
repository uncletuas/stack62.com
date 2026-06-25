#!/usr/bin/env bash
# Provision a single EC2 instance to run the whole Stack62 stack via
# docker-compose. Idempotent-ish: reuses an existing key pair / security group.
# Decisions baked in: single EC2, CPU-only (no GPU), eu-west-1.
#
#   ./provision.sh            # uses the defaults below
#   INSTANCE_TYPE=m6i.4xlarge ./provision.sh
#
# Writes deploy/aws/.state for deploy.sh to read.
set -euo pipefail

REGION="${REGION:-eu-west-1}"
INSTANCE_TYPE="${INSTANCE_TYPE:-m6i.2xlarge}"   # 8 vCPU / 32 GB — room for CPU Ollama + the stack
VOLUME_GB="${VOLUME_GB:-100}"
NAME="${NAME:-stack62}"
KEY_NAME="${KEY_NAME:-stack62-key}"
SG_NAME="${SG_NAME:-stack62-sg}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_PATH="$HERE/${KEY_NAME}.pem"
STATE="$HERE/.state"

command -v aws >/dev/null || { echo "✖ aws CLI not found. See deploy/aws/README.md."; exit 1; }
echo "→ AWS identity:"; aws sts get-caller-identity --output text

# ── Key pair ──────────────────────────────────────────────────────────────
if aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "✓ Key pair $KEY_NAME already exists (need $KEY_PATH locally to SSH)."
else
  aws ec2 create-key-pair --region "$REGION" --key-name "$KEY_NAME" \
    --query 'KeyMaterial' --output text > "$KEY_PATH"
  chmod 600 "$KEY_PATH"
  echo "✓ Created key pair → $KEY_PATH"
fi

# ── Security group (default VPC) ──────────────────────────────────────────
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
  --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")
if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group --region "$REGION" --group-name "$SG_NAME" \
    --description "Stack62 single-node" --vpc-id "$VPC_ID" --query 'GroupId' --output text)
  echo "✓ Created security group $SG_ID"
else
  echo "✓ Security group $SG_ID exists"
fi

MYIP=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')
echo "→ Allowing SSH (22) from your IP ${MYIP}/32; HTTP(80/443) + API(3000) from anywhere."
aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
  --protocol tcp --port 22 --cidr "${MYIP}/32" 2>/dev/null || true
for p in 80 443 3000; do
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --protocol tcp --port "$p" --cidr 0.0.0.0/0 2>/dev/null || true
done

# ── Latest Ubuntu 22.04 AMI (region-agnostic, via SSM public parameter) ──
AMI_ID=$(aws ssm get-parameters --region "$REGION" \
  --names /aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id \
  --query 'Parameters[0].Value' --output text)
[ -n "$AMI_ID" ] && [ "$AMI_ID" != "None" ] || { echo "✖ Could not resolve Ubuntu AMI."; exit 1; }
echo "✓ AMI: $AMI_ID"

# ── Launch ────────────────────────────────────────────────────────────────
echo "→ Launching $INSTANCE_TYPE with ${VOLUME_GB}GB gp3 …"
IID=$(aws ec2 run-instances --region "$REGION" \
  --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
  --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=${VOLUME_GB},VolumeType=gp3}" \
  --user-data "file://${HERE}/user-data.sh" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=${NAME}}]" \
  --query 'Instances[0].InstanceId' --output text)
echo "✓ Launched $IID — waiting for running state …"
aws ec2 wait instance-running --region "$REGION" --instance-ids "$IID"
IP=$(aws ec2 describe-instances --region "$REGION" --instance-ids "$IID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)

cat > "$STATE" <<EOF
REGION=$REGION
INSTANCE_ID=$IID
PUBLIC_IP=$IP
KEY_PATH=$KEY_PATH
SG_ID=$SG_ID
EOF

echo ""
echo "✓ Instance $IID is up at $IP"
echo "  State saved to $STATE"
echo "  Next: fill deploy/aws/.env.aws (copy from .env.aws.example), then run deploy/aws/deploy.sh"
