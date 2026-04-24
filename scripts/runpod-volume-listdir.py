"""Delimiter-based listing of a single 'directory' on the RunPod volume.

Avoids RunPod's broken full pagination by using Delimiter='/' so each call
returns at most ~1000 immediate children.
"""
import os, sys
from pathlib import Path
import boto3
from botocore.client import Config

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v

prefix = (sys.argv[1].rstrip("/") + "/") if len(sys.argv) > 1 else ""

s3 = boto3.client(
    "s3",
    region_name=os.environ["RUNPOD_S3_REGION"],
    endpoint_url=os.environ["RUNPOD_S3_ENDPOINT"],
    aws_access_key_id=os.environ["RUNPOD_S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["RUNPOD_S3_SECRET_KEY"],
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        connect_timeout=15,
        read_timeout=30,
    ),
)

print(f"--- s3://{os.environ['RUNPOD_S3_VOLUME_ID']}/{prefix} ---")

# Single ListObjectsV2 call with Delimiter='/' to get immediate children only.
last_tok = None
dup = 0
continuation = None
total_files = 0
total_bytes = 0
folders = []
while True:
    kwargs = {
        "Bucket": os.environ["RUNPOD_S3_VOLUME_ID"],
        "MaxKeys": 1000,
        "Delimiter": "/",
    }
    if prefix:
        kwargs["Prefix"] = prefix
    if continuation:
        kwargs["ContinuationToken"] = continuation
    resp = s3.list_objects_v2(**kwargs)
    for o in resp.get("Contents", []) or []:
        size = o.get("Size", 0)
        gb = size / (1024 ** 3)
        sz = f"{gb:.2f} GB" if gb >= 1 else f"{size / (1024 * 1024):.1f} MB"
        date = o["LastModified"].strftime("%Y-%m-%d %H:%M")
        name = o["Key"][len(prefix):] if o["Key"].startswith(prefix) else o["Key"]
        print(f"  FILE  {sz:>10}  {date}  {name}")
        total_files += 1
        total_bytes += size
    for cp in resp.get("CommonPrefixes", []) or []:
        sub = cp.get("Prefix", "")
        sub_name = sub[len(prefix):] if sub.startswith(prefix) else sub
        print(f"  DIR    {sub_name}")
        folders.append(sub)
    if not resp.get("IsTruncated"):
        break
    next_tok = resp.get("NextContinuationToken")
    if not next_tok:
        break
    if next_tok == last_tok:
        dup += 1
        if dup >= 3:
            print("!! pagination loop - stopping", file=sys.stderr)
            break
    else:
        dup = 0
        last_tok = next_tok
    continuation = next_tok

print(f"--- {total_files} files ({total_bytes / (1024 ** 3):.2f} GB) + {len(folders)} subdirs ---")
