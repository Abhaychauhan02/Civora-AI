"""
Benchmark script for the baseline authenticity detector (screen_baseline.py).
Evaluates both Val and Test splits, computes precision, recall, F1, ROC-AUC, and confusion matrix
using pure Python (no scikit-learn dependency).
"""

import sys
import json
import time
from pathlib import Path
from src.authenticity.screen_baseline import screen_authenticity

def compute_metrics(y_true, y_scores, y_pred):
    tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 1)
    fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 1)
    tn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 0 and yp == 0)
    fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == 1 and yp == 0)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    # ROC AUC via Mann-Whitney U test rank-sum
    pairs = sorted(zip(y_scores, y_true), key=lambda x: x[0], reverse=True)
    pos_count = sum(y_true)
    neg_count = len(y_true) - pos_count
    if pos_count == 0 or neg_count == 0:
        auc = 0.5
    else:
        rank_sum = 0
        for rank, (score, label) in enumerate(reversed(pairs), 1):
            if label == 1:
                rank_sum += rank
        u = rank_sum - (pos_count * (pos_count + 1)) / 2
        auc = u / (pos_count * neg_count)

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "roc_auc": round(auc, 4),
        "false_positive_rate_on_real": round(fpr, 4),
        "confusion_matrix": {
            "true_negative_real_as_real": tn,
            "false_positive_real_flagged_fake": fp,
            "false_negative_fake_missed": fn,
            "true_positive_fake_caught": tp
        }
    }

def evaluate_baseline(split_dir: Path):
    real_images = sorted(list((split_dir / "real").glob("*.*")))
    synth_images = sorted(list((split_dir / "synthetic").glob("*.*")))

    y_true = []
    y_scores = []
    y_pred = []
    latencies = []

    print(f"\nEvaluating Baseline on {split_dir.name} split ({len(real_images)} real, {len(synth_images)} synthetic)...")

    # Real images
    for p in real_images:
        t0 = time.time()
        res = screen_authenticity(str(p))
        latencies.append(time.time() - t0)

        fake_prob = res["ai_generated_probability"]
        status = res["status"]

        y_true.append(0)
        y_scores.append(fake_prob)
        # Baseline classifies as suspicious/fake if real_prob < 0.75
        is_pred_fake = 1 if status in ["SUSPICIOUS", "HIGHLY_SUSPICIOUS"] else 0
        y_pred.append(is_pred_fake)

    # Synthetic images
    for p in synth_images:
        t0 = time.time()
        res = screen_authenticity(str(p))
        latencies.append(time.time() - t0)

        fake_prob = res["ai_generated_probability"]
        status = res["status"]

        y_true.append(1)
        y_scores.append(fake_prob)
        is_pred_fake = 1 if status in ["SUSPICIOUS", "HIGHLY_SUSPICIOUS"] else 0
        y_pred.append(is_pred_fake)

    metrics = compute_metrics(y_true, y_scores, y_pred)
    results = {
        "split": split_dir.name,
        "detector": "baseline_dima806",
        "total_images": len(y_true),
        "real_count": len(real_images),
        "synthetic_count": len(synth_images),
        "mean_latency_ms": round(float(sum(latencies) / len(latencies) * 1000), 2),
        **metrics
    }

    print(json.dumps(results, indent=2))
    return results

if __name__ == "__main__":
    base_dir = Path("datasets/authenticity_splits")
    val_res = evaluate_baseline(base_dir / "val")
    test_res = evaluate_baseline(base_dir / "test")

    out_file = Path("eval_results/authenticity_baseline_eval.json")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w") as f:
        json.dump({"val": val_res, "test": test_res}, f, indent=2)
    print(f"\nSaved baseline evaluation to {out_file}")
