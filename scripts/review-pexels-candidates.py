"""Keep the usable subset of the downloaded Pexels candidate pool.

This is a conservative, reversible curation pass: raw candidates stay in
their original folders, while accepted files are copied into a separate
selected folder. The manifest records every keep/reject decision and reason.
"""

from __future__ import annotations

import json
import hashlib
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy.fftpack import dct


PROJECT_ROOT = Path(__file__).resolve().parents[1]
ROOT = PROJECT_ROOT / "public/images/products"
RAW_ROOT = PROJECT_ROOT / "outputs"
RAW_SOURCES = [RAW_ROOT / "pexels-candidates", RAW_ROOT / "pexels-candidates-1000"]
OUTPUT = ROOT / "pexels-selected"
REVIEW_OUTPUT = PROJECT_ROOT / "docs/reference-assets/pexels-review"
SELECTED_WEBP_QUALITY = 75

PUBLIC_MANIFEST_FIELDS = (
    "pexelsId",
    "category",
    "subcategory",
    "alt",
    "photographer",
    "photographerUrl",
    "pexelsUrl",
    "width",
    "height",
    "filename",
    "localPath",
    "sha256",
    "bytes",
)
REVIEW_MANIFEST_FIELDS = (
    "candidateIndex",
    "pexelsId",
    "query",
    "category",
    "subcategory",
    "alt",
    "photographer",
    "photographerUrl",
    "pexelsUrl",
    "width",
    "height",
    "filename",
    "localPath",
    "sha256",
    "bytes",
    "metrics",
    "score",
    "keep",
    "reasons",
    "phash",
)
FORBIDDEN_MANIFEST_FIELDS = frozenset({"absolutePath", "selectedPath", "sourcePath", "sourceFolder"})
ABSOLUTE_PATH_PATTERN = re.compile(
    r"(?:^[A-Za-z]:[\\/]|^\\\\|(?:^|[\"'\s])/(?:Users|home|mnt|private|var|tmp|development)(?:[\\/\"'\s]|$))",
    re.IGNORECASE,
)
SECRET_PATTERN = re.compile(
    r"(?:PEXELS_API_KEY|(?:api[_-]?key|access[_-]?token|authorization|private[_-]?key)\s*[\"']?\s*[:=]|-----BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/=-]{12,})",
    re.IGNORECASE,
)

GLOBAL_BAD_TERMS = (
    "illustration", "graphic design", "screenshot", "logo", "poster",
    "collage", "infographic", "cartoon", "abstract art", "wallpaper",
)
HUMAN_TERMS = (
    "person", "people", "woman", "women", "man", "men", "model",
    "portrait", "blogger", "player", "athlete", "child", "baby", "mother",
    "father", "girl", "boy", "family", "friends", "team", "colleagues",
    "toddler", "infant", "newborn", "tailor", "worker", "wearing", "posing",
    "poses", "photographer",
)
PRODUCT_TERMS = (
    "product", "item", "clothing", "clothes", "garment", "outfit", "dress",
    "shirt", "jacket", "coat", "pants", "jeans", "sweater", "bag", "handbag",
    "purse", "shoe", "shoes", "sneaker", "boots", "belt", "watch", "accessor",
    "laptop", "computer", "tablet", "phone", "smartphone", "camera", "headphone",
    "earbud", "monitor", "keyboard", "console", "screen", "printer", "appliance",
    "toaster", "iron", "vacuum", "lamp", "chair", "table", "sofa", "stool",
    "shelf", "furniture", "sideboard", "desk", "decor", "mirror", "vase", "candle",
    "book", "notebook", "magazine", "pen", "game", "controller", "toy", "plush",
    "card", "figure", "racket", "racquet", "ball", "bat", "skate", "dumbbell",
    "glove", "helmet", "equipment", "kitchen", "utensil", "bottle", "diaper",
    "stroller", "tricycle", "bathrobe", "skincare", "rubber duck", "stuffed",
)
DISPLAY_TERMS = (
    "close-up", "closeup", "flat lay", "flatlay", "hanging", "hanger", "held",
    "display", "displayed", "showcase", "showcased", "folded", "arranged",
    "studio shot", "product focus", "on a white background",
)


def text_of(item: dict) -> str:
    # Search queries describe the bucket, not the pictured subject. Using them
    # here would make every generic "product photo" result look item-focused.
    return str(item.get("alt", "")).lower()


def public_path_for(path: Path) -> str:
    try:
        relative = path.resolve().relative_to((PROJECT_ROOT / "public").resolve())
    except ValueError as error:
        raise RuntimeError(f"Asset path must stay under public/: {path}") from error
    return f"/{relative.as_posix()}"


def safe_filename(value: object) -> str:
    filename = str(value or "")
    if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename:
        raise RuntimeError(f"Invalid Pexels asset filename: {filename!r}")
    return filename


def public_manifest_entry(item: dict, filename: str, local_path: str | None) -> dict:
    filename = safe_filename(filename)
    entry: dict = {}
    for field in PUBLIC_MANIFEST_FIELDS:
        if field == "filename":
            entry[field] = filename
        elif field == "localPath" and local_path is not None:
            entry[field] = local_path
        elif field in item and item[field] is not None:
            entry[field] = item[field]
    return entry


def validate_manifest(entries: list[dict], allowed_fields: tuple[str, ...], label: str) -> None:
    allowed = set(allowed_fields)
    for index, entry in enumerate(entries, start=1):
        unexpected = set(entry) - allowed
        forbidden = set(entry) & FORBIDDEN_MANIFEST_FIELDS
        if unexpected or forbidden:
            fields = sorted(unexpected | forbidden)
            raise RuntimeError(f"{label} entry {index} contains disallowed fields: {fields}")
        encoded = json.dumps(entry, ensure_ascii=False)
        if ABSOLUTE_PATH_PATTERN.search(encoded):
            raise RuntimeError(f"{label} entry {index} contains a local absolute path")
        if SECRET_PATTERN.search(encoded):
            raise RuntimeError(f"{label} entry {index} contains a secret-like value")


def review_manifest_entry(item: dict) -> dict:
    entry = public_manifest_entry(item, item["filename"], None)
    for field in REVIEW_MANIFEST_FIELDS:
        if field in entry or field in {"filename", "localPath"}:
            continue
        if field in item and item[field] is not None:
            entry[field] = item[field]
    return {field: entry[field] for field in REVIEW_MANIFEST_FIELDS if field in entry}


def phash(path: Path) -> int:
    with Image.open(path) as source:
        gray = ImageOps.grayscale(source).resize((32, 32), Image.Resampling.LANCZOS)
    matrix = np.asarray(gray, dtype=np.float32)
    coefficients = dct(dct(matrix, axis=0, norm="ortho"), axis=1, norm="ortho")[:8, :8]
    median = float(np.median(coefficients[1:, 1:]))
    value = 0
    for coefficient in coefficients.flatten():
        value = (value << 1) | int(coefficient > median)
    return value


def hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def image_metrics(path: Path) -> dict:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        width, height = image.size
        sample = np.asarray(image.resize((64, 64), Image.Resampling.BILINEAR), dtype=np.float32)
    luminance = 0.2126 * sample[:, :, 0] + 0.7152 * sample[:, :, 1] + 0.0722 * sample[:, :, 2]
    return {
        "width": width,
        "height": height,
        "minDimension": min(width, height),
        "aspectRatio": round(width / height, 3),
        "brightness": round(float(luminance.mean()), 2),
        "contrast": round(float(luminance.std()), 2),
    }


def decision(item: dict, metrics: dict) -> tuple[bool, list[str], int]:
    text = text_of(item)
    category = item.get("category", "")
    subcategory = item.get("subcategory", "")
    reasons: list[str] = []
    score = 100

    if metrics["minDimension"] < 360:
        reasons.append("low_resolution")
        score -= 60
    if metrics["aspectRatio"] < 0.38 or metrics["aspectRatio"] > 2.65:
        reasons.append("extreme_crop")
        score -= 25
    if metrics["brightness"] < 22:
        reasons.append("too_dark")
        score -= 35
    if metrics["contrast"] < 8:
        reasons.append("flat_image")
        score -= 15
    for term in GLOBAL_BAD_TERMS:
        if term in text:
            reasons.append(f"non_product_{term.replace(' ', '_')}")
            score -= 50
            break

    has_human = any(term in text for term in HUMAN_TERMS)
    has_product = any(term in text for term in PRODUCT_TERMS)

    # Pexels search results for baby/kids frequently show people rather than
    # the item. Keep only images that also describe a concrete item.
    if category == "ベビー・キッズ" and has_human:
        reasons.append("person_primary_subject")
        score -= 85

    # Fashion photos are useful when the garment or accessory is visible, but
    # a portrait-only result is not a good marketplace listing image.
    if category in {"レディース", "メンズ", "ファッション"} and has_human and not any(term in text for term in DISPLAY_TERMS):
        reasons.append("fashion_portrait_only")
        score -= 75

    # Sports searches also return athletes and action shots. Retain gear-first
    # scenes but drop people-first results.
    if category == "スポーツ・レジャー" and has_human and not has_product:
        reasons.append("sports_person_only")
        score -= 60

    # For electronics, keep a scene only when the alt text names the device.
    if category == "家電・スマホ" and has_human and not has_product:
        reasons.append("electronics_person_only")
        score -= 55

    # A room/workspace shot can still be a useful furniture or decor image if
    # the actual item is named. Otherwise it is too ambiguous for a listing.
    if category == "インテリア・住まい・小物" and any(term in text for term in ("room", "interior", "workspace")) and not has_product:
        reasons.append("room_without_item")
        score -= 35

    keep = score >= 55 and not any(reason.startswith("non_product_") for reason in reasons)
    return keep, reasons, score


def load_items() -> list[dict]:
    items: list[dict] = []
    seen: set[int] = set()
    for source in RAW_SOURCES:
        manifest_path = source / "manifest.json"
        if not manifest_path.exists():
            continue
        for item in json.loads(manifest_path.read_text(encoding="utf-8")):
            pexels_id = int(item["pexelsId"])
            if pexels_id in seen:
                continue
            seen.add(pexels_id)
            filename = safe_filename(item.get("filename"))
            source_path = (source / filename).resolve()
            if source_path.parent != source.resolve() or not source_path.is_file():
                raise RuntimeError(f"Candidate image is missing or outside its source folder: {filename}")
            candidate = public_manifest_entry(item, filename, None)
            for field in ("candidateIndex", "query"):
                if field in item and item[field] is not None:
                    candidate[field] = item[field]
            candidate["_sourcePath"] = str(source_path)
            items.append(candidate)
    return items


def make_contact_sheet(items: list[dict], output_path: Path) -> None:
    columns = 8 if len(items) > 300 else 5
    tile_width, tile_height = (180, 168) if columns == 8 else (240, 210)
    rows = math.ceil(len(items) / columns)
    sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "#18181b")
    draw = ImageDrawCompat(sheet)
    for index, item in enumerate(items):
        x = (index % columns) * tile_width
        y = (index // columns) * tile_height
        try:
            image_path = item.get("_selectedPath") or item["_sourcePath"]
            with Image.open(image_path) as source:
                image = ImageOps.contain(source.convert("RGB"), (tile_width - 10, tile_height - 28))
                sheet.paste(image, (x + (tile_width - image.width) // 2, y + 4))
        except (OSError, ValueError):
            pass
        draw.text((x + 5, y + tile_height - 22), f"{index + 1:04d}  {item['pexelsId']}", fill="#fafafa")
        draw.text((x + 5, y + tile_height - 10), item["subcategory"][:24], fill="#a1a1aa")
    sheet.save(output_path, quality=88, optimize=True)


def make_category_sheets(items: list[dict], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    buckets: dict[str, list[dict]] = {}
    for item in items:
        key = f"{item['category']}-{item['subcategory']}"
        buckets.setdefault(key, []).append(item)
    for key, bucket in buckets.items():
        safe_name = re.sub(r"[^0-9A-Za-zぁ-んァ-ヶ一-龠_-]+", "_", key).strip("_") or "category"
        make_contact_sheet(bucket, output_dir / f"{safe_name}.jpg")


class ImageDrawCompat:
    """Tiny adapter to keep the drawing call local and type-free."""

    def __init__(self, image: Image.Image):
        from PIL import ImageDraw

        self.draw = ImageDraw.Draw(image)

    def text(self, position: tuple[int, int], text: str, fill: str) -> None:
        self.draw.text(position, text, fill=fill)


def main() -> int:
    items = load_items()
    if not items:
        raise SystemExit("候補manifestが見つかりません")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    REVIEW_OUTPUT.mkdir(parents=True, exist_ok=True)
    reviewed: list[dict] = []
    for item in items:
        source_path = Path(item["_sourcePath"])
        metrics = image_metrics(source_path)
        keep, reasons, score = decision(item, metrics)
        reviewed.append({**item, "metrics": metrics, "score": score, "keep": keep, "reasons": reasons})

    # Prefer higher-quality images when near-duplicates appear. The raw pool is
    # retained, so this only affects the selected copy.
    reviewed.sort(key=lambda item: (item["score"], item["metrics"]["contrast"]), reverse=True)
    kept: list[dict] = []
    kept_hashes: list[int] = []
    for item in reviewed:
        if not item["keep"]:
            continue
        digest = phash(Path(item["_sourcePath"]))
        if any(hamming(digest, previous) <= 4 for previous in kept_hashes):
            item["keep"] = False
            item["reasons"] = [*item["reasons"], "near_duplicate"]
            continue
        item["phash"] = f"{digest:016x}"
        kept.append(item)
        kept_hashes.append(digest)

    # Rebuild the selected folder from scratch, but leave raw candidate folders
    # untouched so every rejection remains recoverable.
    for pattern in ("*.jpg", "*.jpeg", "*.png", "*.webp"):
        for old_file in OUTPUT.glob(pattern):
            old_file.unlink()
    selected_manifest: list[dict] = []
    for index, item in enumerate(kept, start=1):
        destination = OUTPUT / f"{index:04d}-pexels-{item['pexelsId']}.webp"
        with Image.open(item["_sourcePath"]) as source:
            source.convert("RGB").save(
                destination,
                format="WEBP",
                quality=SELECTED_WEBP_QUALITY,
                method=6,
            )
        converted_bytes = destination.read_bytes()
        selected_manifest.append({
            **item,
            "selectionIndex": index,
            "filename": destination.name,
            "sha256": hashlib.sha256(converted_bytes).hexdigest(),
            "bytes": len(converted_bytes),
            "_selectedPath": str(destination.resolve()),
        })

    all_manifest_path = REVIEW_OUTPUT / "review-manifest.json"
    review_payload = [review_manifest_entry(item) for item in reviewed]
    validate_manifest(review_payload, REVIEW_MANIFEST_FIELDS, "review manifest")
    all_manifest_path.write_text(json.dumps(review_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    selected_manifest_path = OUTPUT / "manifest.json"
    selected_payload = [
        public_manifest_entry(item, item["filename"], public_path_for(Path(item["_selectedPath"])))
        for item in selected_manifest
    ]
    validate_manifest(selected_payload, PUBLIC_MANIFEST_FIELDS, "selected manifest")
    selected_manifest_path.write_text(json.dumps(selected_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    make_contact_sheet(selected_manifest, REVIEW_OUTPUT / "contact-sheet.jpg")
    make_category_sheets(selected_manifest, REVIEW_OUTPUT / "review-sheets")

    rejected = len(reviewed) - len(kept)
    summary = {
        "inputCount": len(reviewed),
        "keptCount": len(kept),
        "rejectedCount": rejected,
        "keptByCategory": {},
        "rejectedReasons": {},
        "rawSources": [source.relative_to(PROJECT_ROOT).as_posix() for source in RAW_SOURCES],
        "selectedFolder": public_path_for(OUTPUT),
    }
    for item in kept:
        key = f"{item['category']} / {item['subcategory']}"
        summary["keptByCategory"][key] = summary["keptByCategory"].get(key, 0) + 1
    for item in reviewed:
        for reason in item["reasons"]:
            summary["rejectedReasons"][reason] = summary["rejectedReasons"].get(reason, 0) + 1
    (OUTPUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
