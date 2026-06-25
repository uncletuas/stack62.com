#!/usr/bin/env bash
# EC2 first-boot bootstrap: install Docker Engine + Compose plugin + git, and
# prepare the app directory. deploy.sh then ships the code and brings the stack
# up. Output goes to /var/log/cloud-init-output.log on the instance.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y ca-certificates curl gnupg git

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker ubuntu
systemctl enable --now docker

mkdir -p /opt/stack62
chown -R ubuntu:ubuntu /opt/stack62
# Signal that bootstrap finished so deploy.sh can proceed.
touch /opt/stack62/.bootstrap-done
