"""HEAD test for specific keys on the RunPod volume."""
import os, sys
from pathlib import Path
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v

s3 = boto3.client(
    "s3",
    region_name=os.environ["RUNPOD_S3_REGION"],
    endpoint_url=os.environ["RUNPOD_S3_ENDPOINT"],
    aws_access_key_id=os.environ["RUNPOD_S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["RUNPOD_S3_SECRET_KEY"],
    config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
)

KEYS = sys.argv[1:] if len(sys.argv) > 1 else [
    "models/unet/zImageTurboNSFW_62BF16.safetensors",
    "models/checkpoints/zImageTurboNSFW_62BF16.safetensors",
    "models/clip/qwen_3_4b.safetensors",
    "models/vae/ae.safetensors",
    "models/loras/history.json",
]

bucket = os.environ["RUNPOD_S3_VOLUME_ID"]
for key in KEYS:
    try:
        resp = s3.head_object(Bucket=bucket, Key=key)
        size = resp.get("ContentLength", 0)
        gb = size / (1024 ** 3)
        sz = f"{gb:.2f} GB" if gb >= 1 else f"{size / (1024 * 1024):.1f} MB"
        date = resp.get("LastModified")
        date_str = date.strftime("%Y-%m-%d %H:%M") if date else "?"
        print(f"  FOUND  {sz:>10}  {date_str}  {key}")
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "?")
        print(f"  MISS   ({code}) {key}")
    except Exception as e:
        print(f"  ERR    ({type(e).__name__}: {e}) {key}")
