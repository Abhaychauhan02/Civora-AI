"""
Civora - Merge streetlight ("Not Working") data into the main civic_detection dataset.
Appends to existing train/val/test splits without disturbing pothole/garbage data.
"""

import random
import shutil
from pathlib import Path

RAW_ROOT = Path("datasets/civic_detection_raw/streetlight")
OUTPUT_ROOT = Path("datasets/civic_detection")

TARGET_CLASS_ID_IN_RAW = 0   # "Not Working"
CIVORA_CLASS_ID = 2          # damaged_streetlight

SPLIT_RATIOS = {"train": 0.8, "val": 0.1, "test": 0.1}
RANDOM_SEED = 42


def filter_and_remap_label(label_path):
    new_lines = []
    with open(label_path, "r") as f:
        for line in f:
            parts = line.strip().split()
            if not parts:
                continue
            orig_id = int(parts[0])
            if orig_id == TARGET_CLASS_ID_IN_RAW:
                new_line = " ".join([str(CIVORA_CLASS_ID)] + parts[1:])
                new_lines.append(new_line)
    return new_lines


def collect_from_split(raw_split_name):
    """Scan a raw split folder (train/valid/test) for Not Working images."""
    img_dir = RAW_ROOT / raw_split_name / "images"
    lbl_dir = RAW_ROOT / raw_split_name / "labels"
    items = []
    if not lbl_dir.exists():
        return items

    for label_path in sorted(lbl_dir.glob("*.txt")):
        new_lines = filter_and_remap_label(label_path)
        if new_lines:
            stem = label_path.stem
            img_path = None
            for ext in [".jpg", ".jpeg", ".png"]:
                candidate = img_dir / f"{stem}{ext}"
                if candidate.exists():
                    img_path = candidate
                    break
            if img_path:
                items.append((img_path, new_lines))
    return items


def main():
    random.seed(RANDOM_SEED)

    all_items = []
    for raw_split in ["train", "valid", "test"]:
        found = collect_from_split(raw_split)
        print(f"Found {len(found)} 'Not Working' images in raw '{raw_split}' folder")
        all_items.extend(found)

    print(f"\nTotal streetlight images to merge: {len(all_items)}")
    if not all_items:
        print("ERROR: No 'Not Working' images found. Check folder structure.")
        return

    random.shuffle(all_items)
    n = len(all_items)
    n_train = int(n * SPLIT_RATIOS["train"])
    n_val = int(n * SPLIT_RATIOS["val"])

    splits = {
        "train": all_items[:n_train],
        "val": all_items[n_train:n_train + n_val],
        "test": all_items[n_train + n_val:],
    }

    for split_name, items in splits.items():
        img_out_dir = OUTPUT_ROOT / "images" / split_name
        lbl_out_dir = OUTPUT_ROOT / "labels" / split_name
        img_out_dir.mkdir(parents=True, exist_ok=True)
        lbl_out_dir.mkdir(parents=True, exist_ok=True)

        for img_path, lines in items:
            # prefix filename to avoid collisions with existing pothole/garbage images
            new_name = f"streetlight_{img_path.name}"
            shutil.copy(img_path, img_out_dir / new_name)

            label_out_path = lbl_out_dir / (Path(new_name).stem + ".txt")
            with open(label_out_path, "w") as f:
                f.write("\n".join(lines) + "\n")

        print(f"Appended to {split_name}: {len(items)} images")

    print("\nDone. Streetlight data merged into datasets/civic_detection/")


if __name__ == "__main__":
    main()