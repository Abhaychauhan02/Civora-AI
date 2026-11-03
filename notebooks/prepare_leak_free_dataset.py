"""
Civora Phase 1: Dataset Audit, Integrity Check, and Leak-Free Group Splitting.

This script:
1. Audits all images and labels in datasets/civic_detection.
2. Verifies file integrity, bounding box coordinates, and class IDs.
3. Computes SHA-256 hashes to detect exact file duplicates.
4. Identifies base scene stems to eliminate data leakage.
5. Performs stratified scene-level partitioning (80% train, 10% val, 10% test, seed=42).
6. Generates datasets/civic_detection_v2 without touching datasets/civic_detection.
7. Produces a detailed statistical audit report.
"""

import os
import re
import hashlib
import random
import shutil
from pathlib import Path
from collections import defaultdict, Counter
from PIL import Image

SOURCE_DIR = Path("datasets/civic_detection")
TARGET_DIR = Path("datasets/civic_detection_v2")
RANDOM_SEED = 42

CLASS_NAMES = {0: "pothole", 1: "garbage", 2: "damaged_streetlight"}


def get_base_stem(filename: str) -> str:
    """Extracts the underlying scene/photo stem prior to Roboflow augmentation hashes."""
    base = Path(filename).stem
    # Match patterns like _jpg.rf.<hash>, .rf.<hash>, _png.rf.<hash>
    parts = re.split(r'(_jpg|_png|_jpeg)?\.rf\.[a-f0-9]+', base, flags=re.IGNORECASE)
    return parts[0]


def compute_sha256(filepath: Path) -> str:
    hasher = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def audit_and_prepare():
    random.seed(RANDOM_SEED)

    print("=================================================================")
    print("STEP 1: AUDITING SOURCE DATASET (datasets/civic_detection)")
    print("=================================================================")

    all_records = []
    hash_to_files = defaultdict(list)
    stem_to_records = defaultdict(list)
    corrupted_images = []
    invalid_boxes = []
    empty_labels = []
    missing_labels = []

    # Iterate through all current splits to collect the full universe of data
    for current_split in ["train", "val", "test"]:
        img_dir = SOURCE_DIR / "images" / current_split
        lbl_dir = SOURCE_DIR / "labels" / current_split

        for img_path in sorted(img_dir.glob("*.*")):
            if img_path.suffix.lower() not in [".jpg", ".jpeg", ".png", ".webp"]:
                continue

            # Verify image
            try:
                with Image.open(img_path) as img:
                    img.verify()
                    width, height = img.size
            except Exception as e:
                corrupted_images.append((img_path, str(e)))
                continue

            # Check label
            lbl_path = lbl_dir / f"{img_path.stem}.txt"
            if not lbl_path.exists():
                missing_labels.append(img_path)
                continue

            boxes = []
            classes_in_image = set()
            with open(lbl_path, "r") as f:
                for line_num, line in enumerate(f, 1):
                    parts = line.strip().split()
                    if not parts:
                        continue
                    try:
                        cls_id = int(parts[0])
                        coords = [float(x) for x in parts[1:]]
                    except ValueError:
                        invalid_boxes.append((lbl_path, line_num, "Non-numeric values"))
                        continue

                    if cls_id not in CLASS_NAMES:
                        invalid_boxes.append((lbl_path, line_num, f"Invalid class ID {cls_id}"))
                        continue

                    if len(coords) != 4:
                        invalid_boxes.append((lbl_path, line_num, f"Expected 4 coords, got {len(coords)}"))
                        continue

                    x, y, w, h = coords
                    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0 and 0.0 < w <= 1.0 and 0.0 < h <= 1.0):
                        invalid_boxes.append((lbl_path, line_num, f"Coords out of bounds: {coords}"))
                        continue

                    boxes.append((cls_id, coords))
                    classes_in_image.add(cls_id)

            if not boxes:
                empty_labels.append(lbl_path)

            file_hash = compute_sha256(img_path)
            hash_to_files[file_hash].append(img_path)

            base_stem = get_base_stem(img_path.name)

            record = {
                "img_path": img_path,
                "lbl_path": lbl_path,
                "base_stem": base_stem,
                "boxes": boxes,
                "classes": classes_in_image,
                "hash": file_hash,
                "orig_split": current_split
            }
            all_records.append(record)
            stem_to_records[base_stem].append(record)

    print(f"Total valid image/label pairs found: {len(all_records)}")
    print(f"Corrupted images: {len(corrupted_images)}")
    print(f"Missing label files: {len(missing_labels)}")
    print(f"Empty label files: {len(empty_labels)}")
    print(f"Invalid bounding boxes: {len(invalid_boxes)}")

    # Check exact SHA256 duplicates
    exact_duplicates = {h: paths for h, paths in hash_to_files.items() if len(paths) > 1}
    print(f"Identical file duplicates (by SHA256): {len(exact_duplicates)}")

    print(f"\nTotal unique scene stems identified: {len(stem_to_records)}")

    # Class box breakdown across the whole dataset
    total_class_boxes = Counter()
    for r in all_records:
        for cls_id, _ in r["boxes"]:
            total_class_boxes[cls_id] += 1

    print("\nTotal bounding box distribution across entire dataset:")
    for cls_id, count in sorted(total_class_boxes.items()):
        print(f"  Class {cls_id} ({CLASS_NAMES[cls_id]}): {count} boxes ({count/sum(total_class_boxes.values())*100:.1f}%)")

    print("\n=================================================================")
    print("STEP 2: STRATIFIED SCENE-LEVEL PARTITIONING (LEAK-FREE)")
    print("=================================================================")

    # Group stems by their class signature (e.g., (0,), (1,), (2,), (0, 1), etc.)
    signature_to_stems = defaultdict(list)
    for stem, recs in stem_to_records.items():
        all_classes_in_scene = tuple(sorted(set().union(*(r["classes"] for r in recs))))
        signature_to_stems[all_classes_in_scene].append(stem)

    split_stems = {"train": [], "val": [], "test": []}

    # Stratified split per class signature
    for sig, stems in sorted(signature_to_stems.items(), key=lambda x: str(x[0])):
        random.shuffle(stems)
        n = len(stems)
        n_train = max(1, int(round(n * 0.80)))
        n_val = max(1, int(round(n * 0.10))) if n >= 10 else (1 if n >= 3 else 0)
        n_test = n - n_train - n_val

        if n_test < 0:
            n_train = n - 2 if n >= 2 else 1
            n_val = 1 if n >= 2 else 0
            n_test = 1 if n >= 3 else 0

        # Assign
        train_part = stems[:n_train]
        val_part = stems[n_train:n_train + n_val]
        test_part = stems[n_train + n_val:]

        split_stems["train"].extend(train_part)
        split_stems["val"].extend(val_part)
        split_stems["test"].extend(test_part)

        print(f"Signature {sig} ({[CLASS_NAMES[c] for c in sig]}): {n} scenes -> Train: {len(train_part)}, Val: {len(val_part)}, Test: {len(test_part)}")

    # Verify zero overlap between scenes
    s_train = set(split_stems["train"])
    s_val = set(split_stems["val"])
    s_test = set(split_stems["test"])

    assert len(s_train & s_val) == 0, "Train-Val scene overlap detected!"
    assert len(s_train & s_test) == 0, "Train-Test scene overlap detected!"
    assert len(s_val & s_test) == 0, "Val-Test scene overlap detected!"
    print("\n✅ Verification Passed: ZERO overlapping scenes between train, val, and test splits!")

    print("\n=================================================================")
    print("STEP 3: MATERIALIZING datasets/civic_detection_v2")
    print("=================================================================")

    if TARGET_DIR.exists():
        shutil.rmtree(TARGET_DIR)

    split_summary = {}
    for split_name in ["train", "val", "test"]:
        img_out = TARGET_DIR / "images" / split_name
        lbl_out = TARGET_DIR / "labels" / split_name
        img_out.mkdir(parents=True, exist_ok=True)
        lbl_out.mkdir(parents=True, exist_ok=True)

        stems_in_split = split_stems[split_name]
        records_in_split = []
        for s in stems_in_split:
            records_in_split.extend(stem_to_records[s])

        # Copy files
        split_boxes = Counter()
        for rec in records_in_split:
            shutil.copy2(rec["img_path"], img_out / rec["img_path"].name)
            shutil.copy2(rec["lbl_path"], lbl_out / rec["lbl_path"].name)
            for c, _ in rec["boxes"]:
                split_boxes[c] += 1

        split_summary[split_name] = {
            "scenes": len(stems_in_split),
            "images": len(records_in_split),
            "boxes": split_boxes,
            "total_boxes": sum(split_boxes.values())
        }

    # Write data.yaml for v2
    data_yaml_content = f"""path: {TARGET_DIR}
train: images/train
val: images/val
test: images/test

nc: 3
names: ['pothole', 'garbage', 'damaged_streetlight']
"""
    with open(TARGET_DIR / "data.yaml", "w") as f:
        f.write(data_yaml_content)

    print(f"\nCreated {TARGET_DIR / 'data.yaml'}")
    print("\n=== FINAL DATASET SPLIT SUMMARY (LEAK-FREE v2) ===")
    for s, stats in split_summary.items():
        print(f"\nSplit: {s.upper()}")
        print(f"  Unique scenes: {stats['scenes']}")
        print(f"  Total images:  {stats['images']}")
        print(f"  Total boxes:   {stats['total_boxes']}")
        for cid in [0, 1, 2]:
            b_cnt = stats['boxes'][cid]
            pct = (b_cnt / stats['total_boxes'] * 100) if stats['total_boxes'] > 0 else 0
            print(f"    - {CLASS_NAMES[cid]}: {b_cnt} boxes ({pct:.1f}%)")


if __name__ == "__main__":
    audit_and_prepare()
