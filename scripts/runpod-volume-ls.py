"""Quick listing of a prefix on the RunPod network volume (S3-compatible)."""
import os, sys
from pathlib import Path
import boto3
from botocore.client import Config

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v

prefix = sys.argv[1].rstrip("/") + "/" if len(sys.argv) > 1 else ""

s3 = boto3.client(
    "s3",
    region_name=os.environ["RUNPOD_S3_REGION"],
    endpoint_url=os.environ["RUNPOD_S3_ENDPOINT"],
    aws_access_key_id=os.environ["RUNPOD_S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["RUNPOD_S3_SECRET_KEY"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

total_files = 0
total_bytes = 0
print(f"--- s3://{os.environ['RUNPOD_S3_VOLUME_ID']}/{prefix} ---")

# RunPod's S3 paginator can return the same NextContinuationToken twice in a row;
# we tolerate up to N consecutive duplicates before assuming end-of-list.
last_tok = None
dup_seen = 0
DUP_TOLERANCE = 3
continuation = None
page_count = 0
while True:
    kwargs = {"Bucket": os.environ["RUNPOD_S3_VOLUME_ID"], "MaxKeys": 1000}
    if prefix:
        kwargs["Prefix"] = prefix
    if continuation:
        kwargs["ContinuationToken"] = continuation
    resp = s3.list_objects_v2(**kwargs)
    page_count += 1
    contents = resp.get("Contents", []) or []
    for o in contents:
        size = o.get("Size", 0)
        gb = size / (1024 ** 3)
        if gb >= 1:
            sz = f"{gb:>7.2f} GB"
        else:
            sz = f"{size / (1024 * 1024):>7.1f} MB"
        date = o["LastModified"].strftime("%Y-%m-%d %H:%M")
        print(f"  {sz}  {date}  {o['Key']}")
        total_files += 1
        total_bytes += size
    if not resp.get("IsTruncated"):
        break
    next_tok = resp.get("NextContinuationToken")
    if not next_tok:
        break
    if next_tok == last_tok:
        dup_seen += 1
        if dup_seen >= DUP_TOLERANCE:
            print(f"!! pagination loop detected after page {page_count} - stopping", file=sys.stderr)
            break
    else:
        dup_seen = 0
        last_tok = next_tok
    continuation = next_tok

print(f"--- TOTAL: {total_files} files, {total_bytes / (1024 ** 3):.2f} GB ({page_count} pages) ---")
