"""Keep the curated 50-item catalog manifest.

The selected images remain in the runtime folder until the 50-item UI has
been visually verified. This script only narrows the manifest and its review
summary; unused image files can then be removed as a separate, verified step.
"""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "public/images/products/pexels-selected/manifest.json"
SUMMARY = ROOT / "public/images/products/pexels-selected/summary.json"

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


def main() -> int:
    source = json.loads(MANIFEST.read_text(encoding="utf-8"))
    by_id = {int(item["pexelsId"]): item for item in source}
    missing = [pexels_id for pexels_id in KEEP_PEXELS_IDS if pexels_id not in by_id]
    if missing:
        raise SystemExit(f"Selected Pexels IDs are missing from the manifest: {missing}")

    selected = [dict(by_id[pexels_id]) for pexels_id in KEEP_PEXELS_IDS]
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
            "selectedFolder": str(MANIFEST.parent.resolve()),
        },
    )
    print(json.dumps({"sourceManifestCount": len(source), "catalogCount": len(selected), "keptByCategory": dict(sorted(counts.items()))}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
