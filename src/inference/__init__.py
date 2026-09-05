"""Inference modules for Civora detection and pipeline."""
from src.inference.detect import detect_civic_issue
from src.inference.predict import predict

__all__ = ["detect_civic_issue", "predict"]
