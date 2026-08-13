"""Keep the usable subset of the downloaded Pexels candidate pool.

This is a conservative, reversible curation pass: raw candidates stay in
their original folders, while accepted files are copied into a separate
selected folder. The manifest records every keep/reject decision and reason.
"""

from __future__ import annotations

import json
import math
import re
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy.fftpack import dct


ROOT = Path("public/images/products")
RAW_SOURCES = [ROOT / "pexels-candidates", ROOT / "pexels-candidates-1000"]
OUTPUT = ROOT / "pexels-selected"

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
            item = dict(item)
            item["sourceFolder"] = str(source)
            item["sourcePath"] = str(source / item["filename"])
            items.append(item)
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
            with Image.open(item["selectedPath"]) as source:
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
    for old_file in OUTPUT.glob("*.jpg"):
        old_file.unlink()

    reviewed: list[dict] = []
    for item in items:
        source_path = Path(item["sourcePath"])
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
        digest = phash(Path(item["sourcePath"]))
        if any(hamming(digest, previous) <= 4 for previous in kept_hashes):
            item["keep"] = False
            item["reasons"] = [*item["reasons"], "near_duplicate"]
            continue
        item["phash"] = f"{digest:016x}"
        kept.append(item)
        kept_hashes.append(digest)

    # Rebuild the selected folder from scratch, but leave raw candidate folders
    # untouched so every rejection remains recoverable.
    for old_file in OUTPUT.glob("*.jpg"):
        old_file.unlink()
    selected_manifest: list[dict] = []
    for index, item in enumerate(kept, start=1):
        destination = OUTPUT / f"{index:04d}-pexels-{item['pexelsId']}.jpg"
        shutil.copy2(item["sourcePath"], destination)
        selected_manifest.append({
            **item,
            "selectionIndex": index,
            "filename": destination.name,
            "localPath": f"/images/products/pexels-selected/{destination.name}",
            "selectedPath": str(destination.resolve()),
        })

    all_manifest_path = OUTPUT / "review-manifest.json"
    all_manifest_path.write_text(json.dumps(reviewed, ensure_ascii=False, indent=2), encoding="utf-8")
    selected_manifest_path = OUTPUT / "manifest.json"
    selected_manifest_path.write_text(json.dumps(selected_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    make_contact_sheet(selected_manifest, OUTPUT / "contact-sheet.jpg")
    make_category_sheets(selected_manifest, OUTPUT / "review-sheets")

    rejected = len(reviewed) - len(kept)
    summary = {
        "inputCount": len(reviewed),
        "keptCount": len(kept),
        "rejectedCount": rejected,
        "keptByCategory": {},
        "rejectedReasons": {},
        "rawSources": [str(source) for source in RAW_SOURCES],
        "selectedFolder": str(OUTPUT.resolve()),
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
