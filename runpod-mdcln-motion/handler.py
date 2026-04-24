"""
ModelClone NSFW Motion-Control Worker — RunPod handler

Differences from the image worker (`runpod-mdcln/handler.py`):
- Accepts `upload_videos` (driving video uploaded into ComfyUI/input)
- Polls until VHS_VideoCombine finishes (output is mp4, not png/webp)
- Returns base64-encoded mp4 in `videos[]` instead of `images[]`
- Falls back gracefully to images[] if any node still produces images

Input schema:
{
  "input": {
    "prompt": { ...comfy api graph... },              # required
    # --- Preferred: pass https URLs; worker downloads (avoids RunPod 10 MiB /run body limit) ---
    "reference_image_url": "https://...",            # optional; patches node 167
    "driving_video_url": "https://...",              # optional; patches node 52
    "upload_images": [                                 # optional (base64; omit if using URLs)
      { "node_id": "167", "filename": "ref.jpg", "data": "<base64>" }
    ],
    "upload_videos": [                                 # optional
      { "node_id": "52",  "filename": "drive.mp4", "data": "<base64>" }
    ],
    "output_node_id": "226",                           # default 226 (KIARA_AnimateX combine)
    "timeout": 1800                                    # default 1800 s
  }
}
"""
import runpod
import json
import urllib.request
import urllib.parse
import urllib.error
import time
import base64
import os
import mimetypes
from urllib.parse import urlparse, unquote

COMFYUI_URL = "http://127.0.0.1:8188"
DEFAULT_OUTPUT_NODE = "226"
DEFAULT_TIMEOUT_SECS = 1800
# Max in-memory download per URL (signed blob URLs; large 4K motion refs need headroom)
MAX_DOWNLOAD_BYTES = 450 * 1024 * 1024


def _is_blocked_url(url: str) -> bool:
    try:
        p = urlparse(url)
    except Exception:
        return True
    host = (p.hostname or "").lower()
    if not host or host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return True
    if host.endswith(".local") or host.endswith(".internal"):
        return True
    if host.startswith("10."):
        return True
    if host.startswith("192.168."):
        return True
    if host.startswith("172."):
        # 172.16.0.0/12
        try:
            second = int(host.split(".")[1])
            if 16 <= second <= 31:
                return True
        except (ValueError, IndexError):
            pass
    if host == "metadata.google.internal" or "169.254" in host:
        return True
    return False


def download_url_bytes(url, label, max_bytes=MAX_DOWNLOAD_BYTES):
    """
    Fetch https (and http for legacy blob) URL into memory with a size cap.
    """
    s = (url or "").strip()
    if not s:
        raise ValueError(f"{label}: empty URL")
    low = s.lower()
    if not (low.startswith("https://") or low.startswith("http://")):
        raise ValueError(f"{label}: only http(s) URLs are supported")
    if _is_blocked_url(s):
        raise ValueError(f"{label}: URL host is not allowed")
    path_part = unquote(urlparse(s).path)
    name_hint = os.path.basename(path_part) or "file.bin"

    req = urllib.request.Request(
        s,
        headers={"User-Agent": "ModelClone-Motion-Worker/1.1", "Accept": "*/*"},
    )
    with urllib.request.urlopen(req, timeout=900) as resp:
        out = bytearray()
        while len(out) < max_bytes + 1:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.extend(chunk)
            if len(out) > max_bytes:
                raise ValueError(f"{label}: download larger than {max_bytes} bytes")
    return bytes(out), name_hint


def check_comfyui():
    try:
        urllib.request.urlopen(f"{COMFYUI_URL}/system_stats", timeout=5)
        return True
    except Exception:
        return False


def get_available_nodes(retries=3, delay=2):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/object_info", timeout=30) as resp:
                data = json.loads(resp.read())
            return list(data.keys())
        except Exception as e:
            if attempt < retries - 1:
                print(f"WARN: failed to fetch nodes (attempt {attempt + 1}/{retries}): {e}, retrying in {delay}s...")
                time.sleep(delay)
            else:
                return f"Error fetching nodes after {retries} attempts: {e}"
    return "Error fetching nodes: max retries exceeded"


def validate_workflow_nodes(workflow):
    nodes = get_available_nodes()
    if isinstance(nodes, str):
        return None, nodes

    missing = []
    for node_id, node_data in workflow.items():
        class_type = node_data.get("class_type") or node_data.get("type", "")
        if class_type and class_type not in nodes:
            missing.append(f"Node {node_id}: '{class_type}'")

    if missing:
        return False, f"Unknown node types: {', '.join(missing)}"
    return True, None


def _multipart_upload(endpoint, file_bytes, filename, field_name="image"):
    """
    POST a single file to /upload/image or /upload/<endpoint> using
    multipart/form-data. Returns the dict ComfyUI replies with.
    """
    boundary = "----ModelCloneMotionBoundary7MA4YWxk"
    mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"

    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("utf-8")
    footer = f"\r\n--{boundary}--\r\n".encode("utf-8")

    body = header + file_bytes + footer

    req = urllib.request.Request(
        f"{COMFYUI_URL}{endpoint}",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=300)
    return json.loads(resp.read())


def upload_image_to_comfyui(image_b64, filename="input.jpg"):
    image_data = base64.b64decode(image_b64)
    return upload_file_bytes_to_comfyui(image_data, filename)


def upload_file_bytes_to_comfyui(file_bytes, filename="input.jpg"):
    result = _multipart_upload("/upload/image", file_bytes, filename, field_name="image")
    return result.get("name", filename)


def upload_video_to_comfyui(video_b64, filename="input.mp4"):
    """
    VHS_LoadVideo reads from ComfyUI/input — use the same /upload/image endpoint
    (it accepts arbitrary file types) so the file ends up there. ComfyUI may
    rename on collision and returns the final filename in `name`.
    """
    video_data = base64.b64decode(video_b64)
    return upload_file_bytes_to_comfyui(video_data, filename)


def queue_prompt(workflow):
    data = json.dumps({"prompt": workflow}).encode("utf-8")
    req = urllib.request.Request(
        f"{COMFYUI_URL}/prompt",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        try:
            error_json = json.loads(error_body)
            node_errors = error_json.get("node_errors", {})
            error_detail = error_json.get("error", {})
            if node_errors or error_detail:
                raise RuntimeError(
                    f"ComfyUI validation failed (HTTP {e.code}): "
                    f"error={json.dumps(error_detail)}, "
                    f"node_errors={json.dumps(node_errors)}"
                )
        except (json.JSONDecodeError, RuntimeError) as parse_err:
            if isinstance(parse_err, RuntimeError):
                raise
        raise RuntimeError(f"ComfyUI HTTP {e.code}: {error_body[:2000]}")


def poll_history(prompt_id, timeout=DEFAULT_TIMEOUT_SECS, output_node_id=None):
    """
    Wait until the prompt finishes. We accept any node having outputs (gifs/images)
    or the workflow entering 'success' status.
    """
    effective_node = str(output_node_id) if output_node_id else DEFAULT_OUTPUT_NODE
    start = time.time()
    last_log = 0

    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(f"{COMFYUI_URL}/history/{prompt_id}", timeout=15) as resp:
                history = json.loads(resp.read())
            entry = history.get(prompt_id)
            if not entry:
                time.sleep(3)
                continue

            status = entry.get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                return {"status": "FAILED", "error": str(messages)}

            outputs = entry.get("outputs", {})

            target = outputs.get(effective_node, {})
            if target.get("gifs") or target.get("videos") or target.get("images"):
                return {"status": "COMPLETED", "outputs": outputs}

            if status.get("completed") or status.get("status_str") == "success":
                if outputs:
                    return {"status": "COMPLETED", "outputs": outputs}

        except Exception as e:
            print(f"Poll error: {e}")

        elapsed = int(time.time() - start)
        if elapsed - last_log >= 30:
            print(f"  still polling prompt_id={prompt_id} ... ({elapsed}s elapsed)")
            last_log = elapsed
        time.sleep(5)

    return {"status": "TIMEOUT", "error": f"Timed out after {timeout}s"}


def get_view_bytes(filename, subfolder="", file_type="output"):
    params = urllib.parse.urlencode({
        "filename": filename,
        "subfolder": subfolder,
        "type": file_type,
    })
    with urllib.request.urlopen(f"{COMFYUI_URL}/view?{params}", timeout=300) as resp:
        return resp.read()


def collect_videos(outputs, preferred_node):
    """
    VHS_VideoCombine reports its output under the `gifs` key (legacy name).
    Each entry has filename / subfolder / type / format / fullpath.
    Some VHS builds also use `videos`. Handle both.
    """
    priority = [preferred_node] + sorted(
        [k for k in outputs.keys() if k != preferred_node],
        key=lambda x: int(x) if str(x).isdigit() else 0,
        reverse=True,
    )

    videos = []
    for node_id in priority:
        node_out = outputs.get(node_id, {}) or {}
        for key in ("gifs", "videos"):
            for v in node_out.get(key, []):
                fmt = v.get("format", "")
                fname = v.get("filename", "")
                if not fname:
                    continue
                try:
                    raw = get_view_bytes(
                        fname,
                        v.get("subfolder", ""),
                        v.get("type", "output"),
                    )
                    videos.append({
                        "filename": fname,
                        "node_id": node_id,
                        "format": fmt,
                        "subfolder": v.get("subfolder", ""),
                        "type": v.get("type", "output"),
                        "base64": base64.b64encode(raw).decode("utf-8"),
                    })
                except Exception as e:
                    print(f"WARN: failed to fetch {fname}: {e}")
        if videos:
            break
    return videos


def collect_images(outputs, preferred_node):
    priority = [preferred_node] + sorted(
        [k for k in outputs.keys() if k != preferred_node],
        key=lambda x: int(x) if str(x).isdigit() else 0,
        reverse=True,
    )

    images = []
    for node_id in priority:
        node_out = outputs.get(node_id, {}) or {}
        for img in node_out.get("images", []):
            try:
                raw = get_view_bytes(
                    img["filename"],
                    img.get("subfolder", ""),
                    img.get("type", "output"),
                )
                images.append({
                    "filename": img["filename"],
                    "node_id": node_id,
                    "subfolder": img.get("subfolder", ""),
                    "type": img.get("type", "output"),
                    "base64": base64.b64encode(raw).decode("utf-8"),
                })
            except Exception as e:
                print(f"WARN: failed to fetch {img['filename']}: {e}")
        if images:
            break
    return images


def handler(event):
    inp = event.get("input", {})

    if inp.get("debug_nodes"):
        return {"available_nodes": get_available_nodes()}

    workflow = inp.get("prompt")
    if not workflow:
        return {"error": "No 'prompt' provided in input"}

    if not check_comfyui():
        return {"error": "ComfyUI is not running"}

    # ── Optional: download https URLs (no base64; avoids 10 MiB /run request limit) ─
    ref_url = (inp.get("reference_image_url") or "").strip()
    drv_url = (inp.get("driving_video_url") or "").strip()
    if ref_url:
        try:
            raw, name_hint = download_url_bytes(ref_url, "reference_image", MAX_DOWNLOAD_BYTES)
            ext = (os.path.splitext(name_hint)[1] or ".jpg").lower()
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                ext = ".jpg"
            filename = f"ref{ext}"
            saved = upload_file_bytes_to_comfyui(raw, filename)
            node_id = "167"
            print(f"image from URL: {name_hint!r} -> {saved} (node {node_id})")
            if node_id in workflow:
                workflow[node_id].setdefault("inputs", {})["image"] = saved
        except Exception as e:
            return {"error": f"Failed to download/patch reference image from URL: {e}"}
    if drv_url:
        try:
            raw, name_hint = download_url_bytes(drv_url, "driving_video", MAX_DOWNLOAD_BYTES)
            ext = (os.path.splitext(name_hint)[1] or ".mp4").lower()
            if ext not in (".mp4", ".webm", ".mov", ".mkv", ".m4v"):
                ext = ".mp4"
            filename = f"drive{ext}"
            saved = upload_file_bytes_to_comfyui(raw, filename)
            node_id = "52"
            print(f"video from URL: {name_hint!r} -> {saved} (node {node_id})")
            if node_id in workflow:
                workflow[node_id].setdefault("inputs", {})["video"] = saved
        except Exception as e:
            return {"error": f"Failed to download/patch driving video from URL: {e}"}

    # ── Upload images ──────────────────────────────────────────────────────────
    for img_spec in inp.get("upload_images", []) or []:
        node_id = str(img_spec.get("node_id", ""))
        image_b64 = img_spec.get("data", "")
        filename = img_spec.get("filename", "input.jpg")
        if not node_id or not image_b64:
            continue
        try:
            saved = upload_image_to_comfyui(image_b64, filename)
            print(f"image uploaded: {filename} -> {saved} (patching node {node_id}.image)")
            if node_id in workflow:
                workflow[node_id].setdefault("inputs", {})["image"] = saved
            else:
                print(f"WARN: node {node_id} not in workflow — image not patched")
        except Exception as e:
            return {"error": f"Failed to upload image for node {node_id}: {e}"}

    # ── Upload videos ──────────────────────────────────────────────────────────
    for vid_spec in inp.get("upload_videos", []) or []:
        node_id = str(vid_spec.get("node_id", ""))
        video_b64 = vid_spec.get("data", "")
        filename = vid_spec.get("filename", "input.mp4")
        if not node_id or not video_b64:
            continue
        try:
            saved = upload_video_to_comfyui(video_b64, filename)
            print(f"video uploaded: {filename} -> {saved} (patching node {node_id}.video)")
            if node_id in workflow:
                workflow[node_id].setdefault("inputs", {})["video"] = saved
            else:
                print(f"WARN: node {node_id} not in workflow — video not patched")
        except Exception as e:
            return {"error": f"Failed to upload video for node {node_id}: {e}"}

    output_node_id = str(inp.get("output_node_id", DEFAULT_OUTPUT_NODE))
    timeout_secs = int(inp.get("timeout", DEFAULT_TIMEOUT_SECS))

    # ── Validate node types ────────────────────────────────────────────────────
    valid, validation_error = validate_workflow_nodes(workflow)
    if valid is False:
        available = get_available_nodes()
        if isinstance(available, list):
            print(f"Available nodes ({len(available)}): {', '.join(sorted(available)[:30])}...")
        return {"error": f"Workflow validation failed: {validation_error}"}
    elif valid is None:
        print(f"WARN: could not validate nodes: {validation_error}")

    # ── Queue ──────────────────────────────────────────────────────────────────
    try:
        result = queue_prompt(workflow)
        prompt_id = result.get("prompt_id")
        if not prompt_id:
            return {"error": "No prompt_id from ComfyUI", "detail": str(result)}
        print(f"queued prompt_id={prompt_id} output_node={output_node_id} timeout={timeout_secs}s")
    except Exception as e:
        return {"error": f"Failed to submit workflow: {e}"}

    # ── Poll ───────────────────────────────────────────────────────────────────
    poll_result = poll_history(prompt_id, timeout=timeout_secs, output_node_id=output_node_id)

    if poll_result["status"] != "COMPLETED":
        return {
            "error": poll_result.get("error", "Generation failed"),
            "status": poll_result["status"],
            "prompt_id": prompt_id,
        }

    outputs = poll_result.get("outputs", {})

    videos = collect_videos(outputs, output_node_id)
    images = []
    if not videos:
        # Some workflows still emit only images — fall back to images.
        images = collect_images(outputs, output_node_id)

    if not videos and not images:
        return {
            "error": "No videos or images found in outputs",
            "prompt_id": prompt_id,
            "output_nodes": list(outputs.keys()),
        }

    payload = {
        "status": "COMPLETED",
        "prompt_id": prompt_id,
    }
    if videos:
        print(f"returning {len(videos)} video(s) from node {videos[0]['node_id']}")
        payload["videos"] = videos
    if images:
        print(f"returning {len(images)} image(s) from node {images[0]['node_id']}")
        payload["images"] = images
    return payload


runpod.serverless.start({"handler": handler})
