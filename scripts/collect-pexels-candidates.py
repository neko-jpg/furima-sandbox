"""Collect a curated-sized pool of Pexels product-photo candidates.

The API key is intentionally read only from PEXELS_API_KEY. The script never
prints it and never writes it to the repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageDraw, ImageOps


API_URL = "https://api.pexels.com/v1/search"
DEFAULT_TARGET = 200
DEFAULT_OUTPUT = Path("public/images/products/pexels-candidates")

QUERY_BUCKETS = [
    {"category": "家電・スマホ", "subcategory": "PC・タブレット", "query": "laptop product photo"},
    {"category": "家電・スマホ", "subcategory": "スマートフォン", "query": "smartphone product photo"},
    {"category": "家電・スマホ", "subcategory": "オーディオ", "query": "headphones product photo"},
    {"category": "家電・スマホ", "subcategory": "カメラ", "query": "camera product photo"},
    {"category": "家電・スマホ", "subcategory": "生活家電", "query": "home appliance product photo"},
    {"category": "インテリア・住まい・小物", "subcategory": "照明", "query": "desk lamp product photo"},
    {"category": "インテリア・住まい・小物", "subcategory": "家具", "query": "modern furniture product photo"},
    {"category": "インテリア・住まい・小物", "subcategory": "インテリア", "query": "home decor product photo"},
    {"category": "レディース", "subcategory": "トップス", "query": "women clothing product photo"},
    {"category": "レディース", "subcategory": "バッグ", "query": "women handbag product photo"},
    {"category": "メンズ", "subcategory": "トップス", "query": "men clothing product photo"},
    {"category": "メンズ", "subcategory": "靴", "query": "men sneakers product photo"},
    {"category": "ファッション", "subcategory": "靴・アクセサリー", "query": "shoes accessories product photo"},
    {"category": "ゲーム・おもちゃ・グッズ", "subcategory": "ゲーム", "query": "game controller product photo"},
    {"category": "ゲーム・おもちゃ・グッズ", "subcategory": "おもちゃ", "query": "board game toy product photo"},
    {"category": "ホビー", "subcategory": "コレクション", "query": "hobby collectibles product photo"},
    {"category": "本・マンガ", "subcategory": "本・雑誌", "query": "books stationery product photo"},
    {"category": "キッチン用品", "subcategory": "調理器具", "query": "kitchen utensils product photo"},
    {"category": "スポーツ・レジャー", "subcategory": "スポーツ用品", "query": "sports equipment product photo"},
    {"category": "ベビー・キッズ", "subcategory": "子ども用品", "query": "baby kids products photo"},
]


def fetch_search(api_key: str, query: str, page: int, per_page: int) -> list[dict]:
    params = urlencode({"query": query, "page": page, "per_page": per_page})
    request = Request(
        f"{API_URL}?{params}",
        headers={"Authorization": api_key, "User-Agent": "furima-sandbox-image-collector/1.0"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            payload = json.load(response)
    except HTTPError as error:
        if error.code == 401:
            raise RuntimeError("Pexels APIキーが無効です。PEXELS_API_KEYを確認してください。") from error
        if error.code == 429:
            raise RuntimeError("Pexels APIのレート制限に達しました。時間を置いて再実行してください。") from error
        raise RuntimeError(f"Pexels API error: HTTP {error.code}") from error
    except URLError as error:
        raise RuntimeError(f"Pexels APIへ接続できませんでした: {error.reason}") from error

    return payload.get("photos", [])


def collect_candidates(api_key: str, target: int, excluded_ids: set[int] | None = None) -> list[dict]:
    all_candidates: list[dict] = []
    seen_ids: set[int] = set(excluded_ids or set())
    per_bucket = max(14, math.ceil(target / len(QUERY_BUCKETS)) + 5)

    for bucket_index, bucket in enumerate(QUERY_BUCKETS, start=1):
        bucket_candidates: list[dict] = []
        for page in (1, 2):
            photos = fetch_search(api_key, bucket["query"], page, 40)
            for photo in photos:
                photo_id = photo.get("id")
                source = photo.get("src", {})
                if not photo_id or photo_id in seen_ids or not source.get("large"):
                    continue
                seen_ids.add(photo_id)
                candidate = {
                    "pexelsId": photo_id,
                    "query": bucket["query"],
                    "category": bucket["category"],
                    "subcategory": bucket["subcategory"],
                    "alt": photo.get("alt") or bucket["query"],
                    "photographer": photo.get("photographer"),
                    "photographerUrl": photo.get("photographer_url"),
                    "pexelsUrl": photo.get("url"),
                    "width": photo.get("width"),
                    "height": photo.get("height"),
                    "downloadUrl": source.get("large"),
                }
                bucket_candidates.append(candidate)
                all_candidates.append(candidate)
                if len(bucket_candidates) >= per_bucket:
                    break
            if len(bucket_candidates) >= per_bucket:
                break
            time.sleep(0.25)
        print(f"[{bucket_index:02d}/{len(QUERY_BUCKETS)}] {bucket['query']}: {len(bucket_candidates)} candidates")

    selected: list[dict] = []
    selected_ids: set[int] = set()
    target_per_bucket = max(1, target // len(QUERY_BUCKETS))

    for candidate in all_candidates:
        bucket_key = (candidate["query"], candidate["category"])
        selected_count = sum(item["query"] == bucket_key[0] for item in selected)
        if selected_count >= target_per_bucket:
            continue
        selected.append(candidate)
        selected_ids.add(candidate["pexelsId"])
        if len(selected) >= target:
            return selected

    for candidate in all_candidates:
        if candidate["pexelsId"] in selected_ids:
            continue
        selected.append(candidate)
        selected_ids.add(candidate["pexelsId"])
        if len(selected) >= target:
            break

    return selected


def download_image(candidate: dict, output_dir: Path) -> tuple[str, str, int]:
    filename = f"pexels-{candidate['pexelsId']}.jpg"
    destination = output_dir / filename
    if not destination.exists() or destination.stat().st_size < 1024:
        request = Request(candidate["downloadUrl"], headers={"User-Agent": "furima-sandbox-image-collector/1.0"})
        with urlopen(request, timeout=60) as response:
            data = response.read()
        if len(data) < 1024:
            raise RuntimeError(f"画像データが小さすぎます: {candidate['pexelsId']}")
        destination.write_bytes(data)
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    return filename, digest, destination.stat().st_size


def make_contact_sheet(manifest: list[dict], output_path: Path) -> None:
    columns = 5
    tile_width, tile_height = 240, 210
    rows = math.ceil(len(manifest) / columns)
    sheet = Image.new("RGB", (columns * tile_width, rows * tile_height), "#18181b")
    draw = ImageDraw.Draw(sheet)

    for index, item in enumerate(manifest):
        path = Path(item["absolutePath"])
        x = (index % columns) * tile_width
        y = (index // columns) * tile_height
        try:
            with Image.open(path) as source:
                image = ImageOps.contain(source.convert("RGB"), (tile_width - 12, 166))
                paste_x = x + (tile_width - image.width) // 2
                sheet.paste(image, (paste_x, y + 6))
        except (OSError, ValueError):
            draw.rectangle((x + 6, y + 6, x + tile_width - 6, y + 172), fill="#3f3f46")
            draw.text((x + 12, y + 80), "画像読み込み失敗", fill="#fca5a5")
        label = f"{index + 1:03d}  {item['category']} / {item['subcategory']}"
        draw.text((x + 8, y + 178), label[:38], fill="#fafafa")
        draw.text((x + 8, y + 192), f"Pexels {item['pexelsId']}  {item['query'][:25]}", fill="#a1a1aa")

    sheet.save(output_path, quality=88, optimize=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Download Pexels candidates for Furima Sandbox")
    parser.add_argument("--target", type=int, default=DEFAULT_TARGET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--exclude-manifest", type=Path, help="既存manifestのPexels IDを除外する")
    args = parser.parse_args()

    api_key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not api_key:
        print("PEXELS_API_KEY が設定されていません。", file=sys.stderr)
        return 2

    output_dir = args.output
    output_dir.mkdir(parents=True, exist_ok=True)
    excluded_ids: set[int] = set()
    if args.exclude_manifest:
        if not args.exclude_manifest.exists():
            print(f"除外用manifestが見つかりません: {args.exclude_manifest}", file=sys.stderr)
            return 4
        existing_manifest = json.loads(args.exclude_manifest.read_text(encoding="utf-8"))
        excluded_ids = {int(item["pexelsId"]) for item in existing_manifest if item.get("pexelsId")}
        print(f"Excluding {len(excluded_ids)} existing Pexels IDs from {args.exclude_manifest}")
    print(f"Collecting {args.target} Pexels candidates into {output_dir} ...")
    candidates = collect_candidates(api_key, args.target, excluded_ids)
    if len(candidates) < args.target:
        print(f"候補を{args.target}枚集められませんでした（{len(candidates)}枚）。", file=sys.stderr)
        return 3

    manifest: list[dict] = []
    duplicate_hashes: dict[str, int] = {}
    for index, candidate in enumerate(candidates[: args.target], start=1):
        filename, digest, size = download_image(candidate, output_dir)
        duplicate_hashes[digest] = duplicate_hashes.get(digest, 0) + 1
        manifest.append({
            "candidateIndex": index,
            **candidate,
            "filename": filename,
            "localPath": f"/images/products/pexels-candidates/{filename}",
            "absolutePath": str((output_dir / filename).resolve()),
            "sha256": digest,
            "bytes": size,
            "downloadedAt": datetime.now(timezone.utc).isoformat(),
        })
        if index % 20 == 0 or index == args.target:
            print(f"Downloaded {index}/{args.target}")

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    contact_sheet_path = output_dir / "contact-sheet.jpg"
    make_contact_sheet(manifest, contact_sheet_path)

    duplicate_file_hashes = sum(1 for count in duplicate_hashes.values() if count > 1)
    summary = {
        "count": len(manifest),
        "uniquePexelsIds": len({item["pexelsId"] for item in manifest}),
        "excludedPexelsIds": len(excluded_ids),
        "duplicateFileHashes": duplicate_file_hashes,
        "categories": {},
        "contactSheet": str(contact_sheet_path.resolve()),
        "manifest": str(manifest_path.resolve()),
    }
    for item in manifest:
        key = f"{item['category']} / {item['subcategory']}"
        summary["categories"][key] = summary["categories"].get(key, 0) + 1
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in summary.items() if key != "categories"}, ensure_ascii=False, indent=2))
    print("候補画像の収集が完了しました。contact-sheet.jpgで選別できます。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
