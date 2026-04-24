import runpod
import json
import urllib.request
import urllib.parse
import urllib.error
import time
import base64
import os

COMFYUI_URL = "http://127.0.0.1:8188"


def check_comfyui():
    try:
        req = urllib.request.Request(f"{COMFYUI_URL}/system_stats")
        urllib.request.urlopen(req, timeout=5)
        return True
    except Exception:
        return False


def get_available_nodes(retries=3, delay=2):
    """
    Fetch available node types from ComfyUI with retries.
    Custom nodes may take time to register after ComfyUI starts.
    """
    for attempt in range(retries):
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/object_info")
            resp = urllib.request.urlopen(req, timeout=30)
            data = json.loads(resp.read())
            nodes = list(data.keys())
            if attempt > 0:
                print(f"✅ Got {len(nodes)} node types after {attempt + 1} attempt(s)")
            return nodes
        except Exception as e:
            if attempt < retries - 1:
                print(f"⚠️  Failed to fetch nodes (attempt {attempt + 1}/{retries}): {e}, retrying in {delay}s...")
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


def upload_image_to_comfyui(image_b64, filename="input.jpg"):
    """
    Upload a base64-encoded image to ComfyUI's /upload/image endpoint.
    Returns the filename that ComfyUI saved it as (may differ if name collision).
    """
    image_data = base64.b64decode(image_b64)

    boundary = "----ModelCloneBoundary7MA4YWxk"

    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode("utf-8")
    footer = f"\r\n--{boundary}--\r\n".encode("utf-8")

    body = header + image_data + footer

    req = urllib.request.Request(
        f"{COMFYUI_URL}/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=30)
    result = json.loads(resp.read())
    return result.get("name", filename)


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


def poll_history(prompt_id, timeout=600, output_node_id=None):
    """
    Poll ComfyUI /history until the job completes.
    output_node_id: specific node ID string to wait for (e.g. "289").
    """
    effective_node = str(output_node_id) if output_node_id else "289"
    start = time.time()

    while time.time() - start < timeout:
        try:
            req = urllib.request.Request(f"{COMFYUI_URL}/history/{prompt_id}")
            resp = urllib.request.urlopen(req, timeout=15)
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

            if effective_node in outputs:
                node_out = outputs[effective_node]
                if node_out.get("images"):
                    return {"status": "COMPLETED", "outputs": outputs}

            if status.get("completed") or status.get("status_str") == "success":
                if outputs:
                    return {"status": "COMPLETED", "outputs": outputs}

        except Exception as e:
            print(f"Poll error: {e}")

        time.sleep(5)

    return {"status": "TIMEOUT", "error": f"Timed out after {timeout}s"}


def get_image(filename, subfolder="", img_type="output"):
    params = urllib.parse.urlencode({
        "filename": filename,
        "subfolder": subfolder,
        "type": img_type,
    })
    req = urllib.request.Request(f"{COMFYUI_URL}/view?{params}")
    resp = urllib.request.urlopen(req, timeout=30)
    return resp.read()


def handler(event):
    inp = event.get("input", {})

    if inp.get("debug_nodes"):
        nodes = get_available_nodes()
        return {"available_nodes": nodes}

    workflow = inp.get("prompt")
    if not workflow:
        return {"error": "No 'prompt' provided in input"}

    if not check_comfyui():
        return {"error": "ComfyUI is not running"}

    # ── Upload images before queuing workflow ──────────────────────────────────
    upload_images = inp.get("upload_images", [])
    for img_spec in upload_images:
        node_id = str(img_spec.get("node_id", ""))
        image_b64 = img_spec.get("data", "")
        filename = img_spec.get("filename", "input.jpg")

        if not node_id or not image_b64:
            continue

        try:
            uploaded_filename = upload_image_to_comfyui(image_b64, filename)
            print(f"📸 Uploaded '{filename}' for node {node_id} → saved as '{uploaded_filename}'")

            if node_id in workflow:
                workflow[node_id]["inputs"]["image"] = uploaded_filename
            else:
                print(f"⚠️  Node {node_id} not found in workflow — skipping patch")
        except Exception as e:
            return {"error": f"Failed to upload image for node {node_id}: {str(e)}"}

    output_node_id = str(inp.get("output_node_id", "289"))

    # ── Node validation ────────────────────────────────────────────────────────
    valid, validation_error = validate_workflow_nodes(workflow)
    if valid is False:
        available = get_available_nodes()
        if isinstance(available, list):
            print(f"🔍 Available nodes ({len(available)}): {', '.join(sorted(available)[:20])}...")
        return {"error": f"Workflow validation failed: {validation_error}"}
    elif valid is None:
        print(f"⚠️  Could not validate nodes: {validation_error}")

    # ── Queue the workflow ─────────────────────────────────────────────────────
    try:
        result = queue_prompt(workflow)
        prompt_id = result.get("prompt_id")
        if not prompt_id:
            return {"error": "No prompt_id from ComfyUI", "detail": str(result)}
        print(f"✅ Queued prompt_id: {prompt_id}  output_node={output_node_id}")
    except Exception as e:
        return {"error": f"Failed to submit workflow: {str(e)}"}

    # ── Poll for completion ────────────────────────────────────────────────────
    poll_result = poll_history(
        prompt_id,
        timeout=600,
        output_node_id=output_node_id,
    )

    if poll_result["status"] != "COMPLETED":
        return {
            "error": poll_result.get("error", "Generation failed"),
            "status": poll_result["status"],
        }

    outputs = poll_result.get("outputs", {})

    # ── Image output ───────────────────────────────────────────────────────────
    images = []

    priority = [output_node_id] + sorted(
        [k for k in outputs.keys() if k != output_node_id],
        key=lambda x: int(x) if x.isdigit() else 0,
        reverse=True,
    )

    for node_id in priority:
        node_output = outputs.get(node_id, {})
        for img in node_output.get("images", []):
            try:
                img_data = get_image(
                    img["filename"],
                    img.get("subfolder", ""),
                    img.get("type", "output"),
                )
                images.append({
                    "filename": img["filename"],
                    "node_id": node_id,
                    "base64": base64.b64encode(img_data).decode("utf-8"),
                })
            except Exception as e:
                print(f"⚠️  Failed to fetch {img['filename']}: {e}")
        if images:
            break

    if not images:
        return {
            "error": "No images found in outputs",
            "output_nodes": list(outputs.keys()),
        }

    print(f"🖼️  Returning {len(images)} image(s) from node {images[0]['node_id']}")
    return {
        "status": "COMPLETED",
        "prompt_id": prompt_id,
        "images": images,
    }


runpod.serverless.start({"handler": handler})
