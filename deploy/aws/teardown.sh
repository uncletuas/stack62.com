#!/usr/bin/env bash
# Tear down the AWS resources created by provision.sh. By default it only
# TERMINATES the instance (stops compute billing). Pass --all to also delete the
# security group and key pair.
#
#   ./teardown.sh           # terminate the instance
#   ./teardown.sh --all     # + delete SG and key pair
#
# To merely PAUSE billing (keep data on the EBS volume), don't terminate — stop:
#   aws ec2 stop-instances --region <r> --instance-ids <id>
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/.state" ] || { echo "✖ deploy/aws/.state missing — nothing to tear down."; exit 1; }
# shellcheck disable=SC1091
source "$HERE/.state"

echo "→ Terminating instance $INSTANCE_ID in $REGION …"
aws ec2 terminate-instances --region "$REGION" --instance-ids "$INSTANCE_ID" --output text
aws ec2 wait instance-terminated --region "$REGION" --instance-ids "$INSTANCE_ID"
echo "✓ Instance terminated (EBS volume released)."

if [ "${1:-}" = "--all" ]; then
  echo "→ Deleting security group $SG_ID …"
  aws ec2 delete-security-group --region "$REGION" --group-id "$SG_ID" 2>/dev/null \
    && echo "✓ SG deleted" || echo "… SG not deleted (may be in use); retry shortly."
  KEY_NAME="$(basename "$KEY_PATH" .pem)"
  echo "→ Deleting key pair $KEY_NAME …"
  aws ec2 delete-key-pair --region "$REGION" --key-name "$KEY_NAME" && echo "✓ Key pair deleted"
  rm -f "$KEY_PATH"
fi

rm -f "$HERE/.state"
echo "✓ Teardown complete."
