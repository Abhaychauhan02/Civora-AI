"""
Evaluation script to benchmark any YOLO checkpoint on the independent test set.
Computes overall and per-class metrics, confusion matrix, and exports results to JSON.
"""

import sys
import json
from pathlib import Path
from ultralytics import YOLO

def run_evaluation(model_path: str, data_yaml: str = "datasets/civic_detection_v2/data.yaml", split: str = "test", project: str = "eval_results", name: str = "baseline"):
    model = YOLO(model_path)
    print(f"\n--- Running evaluation for: {model_path} on split: {split} ---")
    metrics = model.val(
        data=data_yaml,
        split=split,
        project=project,
        name=name,
        plots=True,
        save_json=True
    )

    class_names = model.names
    per_class_results = {}

    # Extract per-class metrics if available
    for i, c_name in class_names.items():
        try:
            p = float(metrics.box.p[i])
            r = float(metrics.box.r[i])
            f1 = float(metrics.box.f1[i])
            map50 = float(metrics.box.all_ap[i, 0])
            map50_95 = float(metrics.box.all_ap[i].mean())
        except Exception:
            p, r, f1, map50, map50_95 = 0.0, 0.0, 0.0, 0.0, 0.0

        per_class_results[c_name] = {
            "precision": round(p, 4),
            "recall": round(r, 4),
            "f1": round(f1, 4),
            "mAP50": round(map50, 4),
            "mAP50_95": round(map50_95, 4),
        }

    overall_results = {
        "model_path": model_path,
        "split": split,
        "overall": {
            "precision": round(float(metrics.box.mp), 4),
            "recall": round(float(metrics.box.mr), 4),
            "f1": round(float(2 * (metrics.box.mp * metrics.box.mr) / (metrics.box.mp + metrics.box.mr + 1e-16)), 4),
            "mAP50": round(float(metrics.box.map50), 4),
            "mAP50_95": round(float(metrics.box.map), 4),
        },
        "per_class": per_class_results
    }

    out_file = Path(project) / name / "evaluation_summary.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w") as f:
        json.dump(overall_results, f, indent=2)

    print("\n--- EVALUATION METRICS ---")
    print(json.dumps(overall_results, indent=2))
    return overall_results

if __name__ == "__main__":
    model_p = sys.argv[1] if len(sys.argv) > 1 else "models/baseline_best.pt"
    eval_name = sys.argv[2] if len(sys.argv) > 2 else "baseline_test"
    run_evaluation(model_p, name=eval_name)
