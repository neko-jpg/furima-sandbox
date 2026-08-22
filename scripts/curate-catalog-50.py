"""Keep the curated 50-item catalog manifest.

The selected images remain in the runtime folder until the 50-item UI has
been visually verified. This script only narrows the manifest and its review
summary; unused image files can then be removed as a separate, verified step.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "public/images/products/pexels-selected/manifest.json"
SUMMARY = ROOT / "public/images/products/pexels-selected/summary.json"

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
FORBIDDEN_MANIFEST_FIELDS = frozenset({"absolutePath", "selectedPath", "sourcePath", "sourceFolder"})
ABSOLUTE_PATH_PATTERN = re.compile(
    r"(?:^[A-Za-z]:[\\/]|^\\\\|(?:^|[\"'\s])/(?:Users|home|mnt|private|var|tmp|development)(?:[\\/\"'\s]|$))",
    re.IGNORECASE,
)
SECRET_PATTERN = re.compile(
    r"(?:PEXELS_API_KEY|(?:api[_-]?key|access[_-]?token|authorization|private[_-]?key)\s*[\"']?\s*[:=]|-----BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~+/=-]{12,})",
    re.IGNORECASE,
)

# Deliberately ordered to keep the first home-page rows visually varied while
# covering the main search and category paths.
KEEP_PEXELS_IDS = (
    1432236, 3394656, 7772548,
    7772524, 8539298, 37546205,
    3850236, 7068406, 3945679,
    3585032, 265136, 7610532,
    30238385, 30946801, 38317221, 30946800,
    925709, 36777527, 7796691, 4498916, 15626318, 34991783,
    36111405, 8286629, 15569114,
    21875758, 32713615, 14642108, 19679301, 6990411,
    7154760, 14629572,
    27046143, 17792786, 19895960, 19034219,
    14703446, 30707531, 18972408, 36743233, 3944693,
    27174554, 37008332,
    31779444, 12361140,
    28912830, 5124971, 6344228,
    35723203, 9483507,
)


def write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def public_manifest_entry(item: dict) -> dict:
    filename = str(item.get("filename") or "")
    if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename:
        raise SystemExit(f"Invalid Pexels asset filename: {filename!r}")
    entry: dict = {}
    for field in PUBLIC_MANIFEST_FIELDS:
        if field == "filename":
            entry[field] = filename
        elif field == "localPath":
            entry[field] = f"/images/products/pexels-selected/{filename}"
        elif field in item and item[field] is not None:
            entry[field] = item[field]
    unexpected = set(entry) - set(PUBLIC_MANIFEST_FIELDS)
    if unexpected or set(entry) & FORBIDDEN_MANIFEST_FIELDS:
        raise SystemExit(f"Selected manifest contains disallowed fields: {sorted(unexpected | (set(entry) & FORBIDDEN_MANIFEST_FIELDS))}")
    encoded = json.dumps(entry, ensure_ascii=False)
    if ABSOLUTE_PATH_PATTERN.search(encoded):
        raise SystemExit("Selected manifest contains a local absolute path")
    if SECRET_PATTERN.search(encoded):
        raise SystemExit("Selected manifest contains a secret-like value")
    return entry


def main() -> int:
    source = json.loads(MANIFEST.read_text(encoding="utf-8"))
    by_id = {int(item["pexelsId"]): item for item in source}
    missing = [pexels_id for pexels_id in KEEP_PEXELS_IDS if pexels_id not in by_id]
    if missing:
        raise SystemExit(f"Selected Pexels IDs are missing from the manifest: {missing}")

    selected = [public_manifest_entry(by_id[pexels_id]) for pexels_id in KEEP_PEXELS_IDS]
    if len(selected) != 50 or len({int(item["pexelsId"]) for item in selected}) != 50:
        raise SystemExit("The curated catalog must contain exactly 50 unique items")

    write_json(MANIFEST, selected)
    counts = Counter(f"{item['category']} / {item['subcategory']}" for item in selected)
    write_json(
        SUMMARY,
        {
            "sourceManifestCount": len(source),
            "catalogCount": len(selected),
            "unusedSelectedImageCount": len(source) - len(selected),
            "curation": "manual-balanced-50",
            "keptByCategory": dict(sorted(counts.items())),
            "selectedFolder": "/images/products/pexels-selected",
        },
    )
    print(json.dumps({"sourceManifestCount": len(source), "catalogCount": len(selected), "keptByCategory": dict(sorted(counts.items()))}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
