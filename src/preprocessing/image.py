"""Image preprocessing utilities for Civora pipeline."""
import os
from PIL import Image, ImageOps

def preprocess_image(image_path: str, max_size: tuple = (1280, 1280)) -> str:
    """
    Fixes EXIF orientation, validates format, and optionally downsizes high-res images
    for reliable inference and storage. Returns validated image path.
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at {image_path}")

    with Image.open(image_path) as img:
        # Transpose according to EXIF orientation tag if present
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGB")
        img.thumbnail(max_size, Image.Resampling.LANCZOS)
        img.save(image_path, "JPEG", quality=90)

    return image_path
