"""
Stream a Civitai model directly into the RunPod network volume (S3-compatible)
WITHOUT touching local disk. Uses HTTP Range requests against the B2 signed URL
to fetch each chunk and pushes it as an S3 multipart part.

Each part is fully replayable on failure: the script re-issues a Range request
for that exact byte range, so transient B2/Cloudflare/RunPod errors never lose
data. Civitai signed URLs that expire mid-upload are auto-refreshed.

Usage:
  python scripts/civitai-mirror.py "<civitai_download_url>" [s3_key]

If `s3_key` is omitted, the file lands at models/unet/<filename> based on the
Content-Disposition returned by Civitai.
"""
import os
import sys
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import requests
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

CIVITAI_TOKEN = os.environ.get("CIVITAI_API_TOKEN") or ""
ACCESS_KEY = os.environ["RUNPOD_S3_ACCESS_KEY"]
SECRET_KEY = os.environ["RUNPOD_S3_SECRET_KEY"]
REGION = os.environ["RUNPOD_S3_REGION"]
ENDPOINT = os.environ["RUNPOD_S3_ENDPOINT"]
BUCKET = os.environ["RUNPOD_S3_VOLUME_ID"]

if len(sys.argv) < 2:
    print(__doc__.strip())
    sys.exit(1)

CIVITAI_URL = sys.argv[1]
EXPLICIT_KEY = sys.argv[2] if len(sys.argv) > 2 else None

PART_SIZE = 50 * 1024 * 1024     # 50 MiB per part — well under the S3 5 GB limit
MAX_RETRIES_PART = 8
BACKOFF_BASE = 2.0
BACKOFF_CAP = 60.0
PARALLEL_WORKERS = 4             # parallel part fetches/uploads


def resolve_civitai():
    """Returns (final_b2_url, filename, content_length). Re-callable to refresh expired B2 URLs."""
    headers = {"User-Agent": "modelclone-mirror/1.0"}
    if CIVITAI_TOKEN:
        headers["Authorization"] = f"Bearer {CIVITAI_TOKEN}"
    r = requests.get(CIVITAI_URL, headers=headers, allow_redirects=True, timeout=60, stream=True)
    r.raise_for_status()
    cl = int(r.headers.get("Content-Length", "0"))
    cd = r.headers.get("Content-Disposition", "")
    m = re.search(r'filename="?([^";]+)"?', cd or "")
    fn = m.group(1) if m else "civitai_model.safetensors"
    final = r.url
    r.close()
    return final, fn, cl


print(">>> Probing Civitai for filename + size...", flush=True)
final_url, filename, content_length = resolve_civitai()
s3_key = EXPLICIT_KEY or f"models/unet/{filename}"
total_parts = (content_length + PART_SIZE - 1) // PART_SIZE
print(f"    File:  {filename}", flush=True)
print(f"    Size:  {content_length:,} bytes ({content_length / (1024**3):.2f} GB)", flush=True)
print(f"    To:    s3://{BUCKET}/{s3_key}", flush=True)
print(f"    Parts: {total_parts} x {PART_SIZE // (1024*1024)} MiB", flush=True)

s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "path"},
        retries={"max_attempts": 8, "mode": "adaptive"},
        connect_timeout=60,
        read_timeout=600,
    ),
)

try:
    head = s3.head_object(Bucket=BUCKET, Key=s3_key)
    if int(head.get("ContentLength", 0)) == content_length:
        print(f">>> ALREADY ON VOLUME ({content_length:,} bytes match) - skipping.", flush=True)
        sys.exit(0)
    else:
        print(f">>> Object exists with size {head.get('ContentLength')} - replacing.", flush=True)
except Exception:
    pass

print(">>> Initiating multipart upload...", flush=True)
mp = s3.create_multipart_upload(Bucket=BUCKET, Key=s3_key, ContentType="application/octet-stream")
upload_id = mp["UploadId"]
print(f"    UploadId: {upload_id}", flush=True)


def fetch_range_with_retry(url_holder, start, end):
    """Fetch bytes [start, end] inclusive. Re-resolves Civitai URL on auth expiry."""
    expected = end - start + 1
    last_err = None
    for attempt in range(1, MAX_RETRIES_PART + 1):
        url = url_holder["url"]
        try:
            r = requests.get(
                url,
                headers={"User-Agent": "modelclone-mirror/1.0", "Range": f"bytes={start}-{end}"},
                timeout=180,
            )
            if r.status_code in (401, 403):
                print(f"    [refresh] {r.status_code} from B2; re-resolving Civitai URL...", flush=True)
                new_url, _, _ = resolve_civitai()
                url_holder["url"] = new_url
                continue
            if r.status_code not in (200, 206):
                raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
            data = r.content
            if len(data) != expected:
                raise RuntimeError(f"short read: got {len(data)}, expected {expected}")
            return data
        except Exception as e:
            last_err = e
            backoff = min(BACKOFF_CAP, BACKOFF_BASE ** attempt)
            print(f"    [fetch retry {attempt}/{MAX_RETRIES_PART}] bytes {start}-{end}: {e} - sleeping {backoff:.0f}s", flush=True)
            time.sleep(backoff)
    raise RuntimeError(f"fetch failed for bytes {start}-{end} after {MAX_RETRIES_PART} attempts: {last_err}")


def upload_part_with_retry(part_num, body):
    last_err = None
    for attempt in range(1, MAX_RETRIES_PART + 1):
        try:
            resp = s3.upload_part(
                Bucket=BUCKET,
                Key=s3_key,
                PartNumber=part_num,
                UploadId=upload_id,
                Body=body,
                ContentLength=len(body),
            )
            return resp["ETag"]
        except Exception as e:
            last_err = e
            backoff = min(BACKOFF_CAP, BACKOFF_BASE ** attempt)
            print(f"    [upload retry {attempt}/{MAX_RETRIES_PART}] part {part_num}: {e} - sleeping {backoff:.0f}s", flush=True)
            time.sleep(backoff)
    raise RuntimeError(f"upload failed for part {part_num} after {MAX_RETRIES_PART} attempts: {last_err}")


# Build per-part work items.
work = []
position = 0
part_num = 1
while position < content_length:
    end = min(position + PART_SIZE, content_length) - 1
    work.append((part_num, position, end))
    position += PART_SIZE
    part_num += 1

t0 = time.time()
url_holder = {"url": final_url}
url_lock = threading.Lock()  # guards URL refresh from concurrent workers
state = {"uploaded_bytes": 0, "done_parts": 0, "last_log": t0}
state_lock = threading.Lock()


def process_part(part_num, start, end):
    """Fetch one chunk from Civitai then upload it as one S3 part."""
    expected = end - start + 1
    last_err = None
    for attempt in range(1, MAX_RETRIES_PART + 1):
        with url_lock:
            url = url_holder["url"]
        try:
            r = requests.get(
                url,
                headers={"User-Agent": "modelclone-mirror/1.0", "Range": f"bytes={start}-{end}"},
                timeout=180,
            )
            if r.status_code in (401, 403):
                with url_lock:
                    if url_holder["url"] == url:
                        print(f"    [refresh] {r.status_code} from B2; re-resolving Civitai URL...", flush=True)
                        new_url, _, _ = resolve_civitai()
                        url_holder["url"] = new_url
                continue
            if r.status_code not in (200, 206):
                raise RuntimeError(f"HTTP {r.status_code}: {r.text[:160]}")
            body = r.content
            if len(body) != expected:
                raise RuntimeError(f"short read: got {len(body)}, expected {expected}")
            resp = s3.upload_part(
                Bucket=BUCKET, Key=s3_key, PartNumber=part_num,
                UploadId=upload_id, Body=body, ContentLength=expected,
            )
            return part_num, resp["ETag"], expected
        except Exception as e:
            last_err = e
            backoff = min(BACKOFF_CAP, BACKOFF_BASE ** attempt)
            print(f"    [retry {attempt}/{MAX_RETRIES_PART}] part {part_num}: {e} - sleeping {backoff:.0f}s", flush=True)
            time.sleep(backoff)
    raise RuntimeError(f"part {part_num} failed after {MAX_RETRIES_PART} attempts: {last_err}")


uploaded_parts = []
try:
    with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS) as pool:
        futures = {pool.submit(process_part, *w): w for w in work}
        for fut in as_completed(futures):
            pn, etag, size = fut.result()
            uploaded_parts.append({"PartNumber": pn, "ETag": etag})
            with state_lock:
                state["uploaded_bytes"] += size
                state["done_parts"] += 1
                now = time.time()
                if now - state["last_log"] >= 5 or state["done_parts"] == len(work):
                    pct = state["uploaded_bytes"] / content_length * 100
                    speed = state["uploaded_bytes"] / max(now - t0, 0.001) / (1024 * 1024)
                    done_gb = state["uploaded_bytes"] / (1024 ** 3)
                    tot_gb = content_length / (1024 ** 3)
                    print(
                        f"    {state['done_parts']:>4d}/{len(work)}  [{pct:5.1f}%]  "
                        f"{done_gb:.2f} / {tot_gb:.2f} GB  ({speed:.1f} MB/s)",
                        flush=True,
                    )
                    state["last_log"] = now

    uploaded_parts.sort(key=lambda p: p["PartNumber"])
    print(">>> Completing multipart upload...", flush=True)
    s3.complete_multipart_upload(
        Bucket=BUCKET,
        Key=s3_key,
        UploadId=upload_id,
        MultipartUpload={"Parts": uploaded_parts},
    )

except Exception as e:
    print(f"!! ERROR - aborting multipart upload: {e}", flush=True)
    try:
        s3.abort_multipart_upload(Bucket=BUCKET, Key=s3_key, UploadId=upload_id)
        print("   (abort sent)", flush=True)
    except Exception as abort_err:
        print(f"   (abort also failed: {abort_err})", flush=True)
    sys.exit(1)

final = s3.head_object(Bucket=BUCKET, Key=s3_key)
final_size = int(final.get("ContentLength", 0))
print(">>> Upload complete!", flush=True)
print(f"    s3://{BUCKET}/{s3_key}  ->  {final_size:,} bytes ({final_size / (1024**3):.2f} GB)", flush=True)
if content_length and final_size != content_length:
    print(f"!! WARNING: size mismatch (expected {content_length:,}, got {final_size:,})", flush=True)
    sys.exit(2)
print(">>> OK", flush=True)
