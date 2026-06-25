#!/usr/bin/env python3
"""Provision a single EC2 instance for Stack62 via boto3 (no AWS CLI needed).

Mirrors provision.sh but uses the AWS SDK directly. Writes deploy/aws/.state for
deploy.sh. Idempotent on the key pair and security group.

Env overrides: REGION, INSTANCE_TYPE, VOLUME_GB, KEY_NAME, SG_NAME, NAME.
"""
import os
import sys
import subprocess
import urllib.request
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

# Windows consoles default to cp1252 and choke on Unicode glyphs.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

REGION = os.environ.get("REGION", "eu-north-1")
# Fallbacks in case the preferred type isn't offered in the region/AZ.
INSTANCE_TYPES = [os.environ.get("INSTANCE_TYPE", "m6i.2xlarge"), "m5.2xlarge", "t3.2xlarge"]
VOLUME_GB = int(os.environ.get("VOLUME_GB", "100"))
KEY_NAME = os.environ.get("KEY_NAME", "stack62-key")
SG_NAME = os.environ.get("SG_NAME", "stack62-sg")
NAME = os.environ.get("NAME", "stack62")

HERE = Path(__file__).resolve().parent
KEY_PATH = HERE / f"{KEY_NAME}.pem"
STATE = HERE / ".state"
USER_DATA = (HERE / "user-data.sh").read_text(encoding="utf-8")

ec2 = boto3.client("ec2", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)


def log(msg):
    print(msg, flush=True)


def my_ip():
    try:
        return urllib.request.urlopen("https://checkip.amazonaws.com", timeout=5).read().decode().strip()
    except Exception:
        return None


def ensure_key():
    try:
        ec2.describe_key_pairs(KeyNames=[KEY_NAME])
        log(f"✓ Key pair {KEY_NAME} exists (need {KEY_PATH} locally to SSH).")
        if not KEY_PATH.exists():
            log(f"  ! {KEY_PATH} not found locally — delete the key pair in AWS and re-run to regenerate.")
    except ClientError:
        kp = ec2.create_key_pair(KeyName=KEY_NAME)
        KEY_PATH.write_text(kp["KeyMaterial"], encoding="utf-8")
        # Lock down the PEM so OpenSSH accepts it (Windows ACLs + POSIX bit).
        try:
            os.chmod(KEY_PATH, 0o600)
        except Exception:
            pass
        if os.name == "nt":
            user = os.environ.get("USERNAME", "")
            subprocess.run(["icacls", str(KEY_PATH), "/inheritance:r"], capture_output=True)
            if user:
                subprocess.run(["icacls", str(KEY_PATH), "/grant:r", f"{user}:R"], capture_output=True)
        log(f"✓ Created key pair → {KEY_PATH}")


def ensure_sg():
    vpcs = ec2.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}])["Vpcs"]
    if not vpcs:
        log("✖ No default VPC found. Create one or set a subnet manually.")
        sys.exit(1)
    vpc_id = vpcs[0]["VpcId"]
    groups = ec2.describe_security_groups(
        Filters=[{"Name": "group-name", "Values": [SG_NAME]}, {"Name": "vpc-id", "Values": [vpc_id]}]
    )["SecurityGroups"]
    if groups:
        sg_id = groups[0]["GroupId"]
        log(f"✓ Security group {sg_id} exists")
    else:
        sg_id = ec2.create_security_group(GroupName=SG_NAME, Description="Stack62 single-node", VpcId=vpc_id)["GroupId"]
        log(f"✓ Created security group {sg_id}")

    ip = my_ip()
    perms = []
    if ip:
        perms.append({"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": f"{ip}/32"}]})
    for p in (80, 443, 3000):
        perms.append({"IpProtocol": "tcp", "FromPort": p, "ToPort": p, "IpRanges": [{"CidrIp": "0.0.0.0/0"}]})
    for perm in perms:
        try:
            ec2.authorize_security_group_ingress(GroupId=sg_id, IpPermissions=[perm])
        except ClientError as e:
            if "Duplicate" not in str(e):
                raise
    log(f"→ Ingress set (SSH from {ip or 'N/A'}; 80/443/3000 from anywhere)")
    return sg_id


def ubuntu_ami():
    param = "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id"
    ami = ssm.get_parameter(Name=param)["Parameter"]["Value"]
    log(f"✓ AMI: {ami}")
    return ami


def launch(sg_id, ami):
    last_err = None
    for itype in INSTANCE_TYPES:
        try:
            log(f"→ Launching {itype} with {VOLUME_GB}GB gp3 …")
            res = ec2.run_instances(
                ImageId=ami,
                InstanceType=itype,
                KeyName=KEY_NAME,
                SecurityGroupIds=[sg_id],
                MinCount=1,
                MaxCount=1,
                BlockDeviceMappings=[{"DeviceName": "/dev/sda1", "Ebs": {"VolumeSize": VOLUME_GB, "VolumeType": "gp3"}}],
                UserData=USER_DATA,
                TagSpecifications=[{"ResourceType": "instance", "Tags": [{"Key": "Name", "Value": NAME}]}],
            )
            return res["Instances"][0]["InstanceId"], itype
        except ClientError as e:
            last_err = e
            msg = str(e)
            if "Unsupported" in msg or "InsufficientInstanceCapacity" in msg or "not supported" in msg:
                log(f"  … {itype} unavailable here, trying next")
                continue
            raise
    raise last_err


def main():
    log(f"Provisioning Stack62 in {REGION} (account {boto3.client('sts').get_caller_identity()['Account']})\n")
    ensure_key()
    sg_id = ensure_sg()
    ami = ubuntu_ami()
    iid, itype = launch(sg_id, ami)
    log(f"✓ Launched {iid} ({itype}) — waiting for running …")
    ec2.get_waiter("instance_running").wait(InstanceIds=[iid])
    desc = ec2.describe_instances(InstanceIds=[iid])
    ip = desc["Reservations"][0]["Instances"][0].get("PublicIpAddress", "")
    # Write a forward-slash path so Git Bash / ssh don't mangle backslashes.
    key_posix = str(KEY_PATH).replace("\\", "/")
    STATE.write_text(
        f"REGION={REGION}\nINSTANCE_ID={iid}\nPUBLIC_IP={ip}\nKEY_PATH={key_posix}\nSG_ID={sg_id}\nINSTANCE_TYPE={itype}\n",
        encoding="utf-8",
    )
    log("")
    log(f"✓ Instance {iid} is up at {ip}")
    log(f"  State → {STATE}")
    log(f"  Next: fill deploy/aws/.env.aws, then run deploy.sh")


if __name__ == "__main__":
    main()
