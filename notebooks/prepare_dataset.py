"""
Civora - Dataset Preparation Script
Filters the raw Smartathon dataset down to our 3 target classes
(pothole, garbage, bad_streetlight), remaps class IDs, and creates
a clean train/val/test split in YOLO format.
"""

import random
import shutil
from pathlib import Path

RAW_IMAGES_DIR = Path("datasets/civic_detection_raw/smartathon/train/images")
RAW_LABELS_DIR = Path("datasets/civic_detection_raw/smartathon/train/labels")
OUTPUT_ROOT = Path("datasets/civic_detection")

ORIGINAL_CLASSES = [
    "bad billboard", "bad streetlight", "broken_signage", "clutter_sidewalk",
    "construction road", "faded signage", "garbage", "graffiti",
    "potholes", "sand on road", "unkept_facade"
]

TARGET_CLASS_MAP = {
    "potholes": 0,
    "garbage": 1,
    "bad streetlight": 2,
}

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
            orig_name = ORIGINAL_CLASSES[orig_id]
            if orig_name in TARGET_CLASS_MAP:
                new_id = TARGET_CLASS_MAP[orig_name]
                new_line = " ".join([str(new_id)] + parts[1:])
                new_lines.append(new_line)
    return new_lines


def main():
    random.seed(RANDOM_SEED)
    keep_items = []
    label_files = sorted(RAW_LABELS_DIR.glob("*.txt"))

    print(f"Scanning {len(label_files)} label files...")
    for label_path in label_files:
        new_lines = filter_and_remap_label(label_path)
        if new_lines:
            stem = label_path.stem
            img_path = None
            for ext in [".jpg", ".jpeg", ".png"]:
                candidate = RAW_IMAGES_DIR / f"{stem}{ext}"
                if candidate.exists():
                    img_path = candidate
                    break
            if img_path:
                keep_items.append((img_path, new_lines))

    print(f"Found {len(keep_items)} images with at least one target-class annotation.")
    if len(keep_items) == 0:
        print("ERROR: No matching images found. Check ORIGINAL_CLASSES order against your data.yaml")
        return

    random.shuffle(keep_items)
    n = len(keep_items)
    n_train = int(n * SPLIT_RATIOS["train"])
    n_val = int(n * SPLIT_RATIOS["val"])

    splits = {
        "train": keep_items[:n_train],
        "val": keep_items[n_train:n_train + n_val],
        "test": keep_items[n_train + n_val:],
    }

    for split_name, items in splits.items():
        img_out_dir = OUTPUT_ROOT / "images" / split_name
        lbl_out_dir = OUTPUT_ROOT / "labels" / split_name
        img_out_dir.mkdir(parents=True, exist_ok=True)
        lbl_out_dir.mkdir(parents=True, exist_ok=True)

        for img_path, lines in items:
            shutil.copy(img_path, img_out_dir / img_path.name)
            label_out_path = lbl_out_dir / (img_path.stem + ".txt")
            with open(label_out_path, "w") as f:
                f.write("\n".join(lines) + "\n")

        print(f"{split_name}: {len(items)} images")

    yaml_content = f"""train: {(OUTPUT_ROOT / 'images' / 'train').resolve()}
val: {(OUTPUT_ROOT / 'images' / 'val').resolve()}
test: {(OUTPUT_ROOT / 'images' / 'test').resolve()}

nc: 3
names: ['pothole', 'garbage', 'damaged_streetlight']
"""
    with open(OUTPUT_ROOT / "data.yaml", "w") as f:
        f.write(yaml_content)

    print(f"\nDone. Wrote {OUTPUT_ROOT / 'data.yaml'}")

    counts = {0: 0, 1: 0, 2: 0}
    for _, lines in keep_items:
        for line in lines:
            cid = int(line.split()[0])
            counts[cid] += 1
    print(f"Instance counts -> pothole: {counts[0]}, garbage: {counts[1]}, damaged_streetlight: {counts[2]}")


if __name__ == "__main__":
    main()