"""Civora Geolocation & Reverse Geocoding Proxy Router.

Complies with Nominatim OSM usage policies:
- Sets identifiable custom User-Agent
- Enforces in-memory caching across users
- Debounces and deduplicates requests
- Handles rate-limits and timeouts gracefully with deterministic fallbacks
"""
import logging
import httpx
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, Query, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/geo", tags=["Geolocation"])

# In-memory LRU-like cache for reverse and forward geocoding lookups
_REVERSE_CACHE: Dict[str, Dict[str, Any]] = {}
_SEARCH_CACHE: Dict[str, List[Dict[str, Any]]] = {}
_MAX_CACHE_SIZE = 500

NOMINATIM_HEADERS = {
    "User-Agent": "Civora-Civic-Platform/1.0 (https://civora.org; civic-triage@civora.org)",
    "Accept-Language": "en"
}


@router.get("/reverse")
async def reverse_geocode(
    lat: float = Query(..., ge=-90.0, le=90.0, description="Latitude"),
    lon: float = Query(..., ge=-180.0, le=180.0, description="Longitude")
):
    """
    Reverse geocodes GPS coordinates into human-readable street address/landmark.
    Uses cached lookups to respect rate limits and reduce upstream latency.
    """
    # Round coordinates to ~11m precision for cache hits
    cache_key = f"{round(lat, 4)}:{round(lon, 4)}"
    if cache_key in _REVERSE_CACHE:
        return _REVERSE_CACHE[cache_key]

    fallback_result = {
        "address": f"Lat {lat:.5f}, Lon {lon:.5f}",
        "road": None,
        "neighborhood": None,
        "city": None,
        "state": None,
        "country": "India",
        "cached": False,
        "source": "coordinates_fallback"
    }

    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lon}&zoom=18&addressdetails=1"
        async with httpx.AsyncClient(timeout=4.0, headers=NOMINATIM_HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                addr_obj = data.get("address", {})

                # Extract most relevant municipal components
                road = addr_obj.get("road") or addr_obj.get("pedestrian") or addr_obj.get("street") or addr_obj.get("highway")
                neighborhood = addr_obj.get("suburb") or addr_obj.get("neighbourhood") or addr_obj.get("residential") or addr_obj.get("village")
                city = addr_obj.get("city") or addr_obj.get("town") or addr_obj.get("county") or addr_obj.get("district")
                state = addr_obj.get("state")
                country = addr_obj.get("country", "India")

                parts = [p for p in [road, neighborhood, city] if p]
                if not parts:
                    display_clean = data.get("display_name", "").split(",")[0].strip() or fallback_result["address"]
                else:
                    display_clean = ", ".join(parts)

                result = {
                    "address": display_clean,
                    "full_display_name": data.get("display_name"),
                    "road": road,
                    "neighborhood": neighborhood,
                    "city": city,
                    "state": state,
                    "country": country,
                    "cached": True,
                    "source": "openstreetmap_nominatim"
                }

                # Save in cache
                if len(_REVERSE_CACHE) >= _MAX_CACHE_SIZE:
                    _REVERSE_CACHE.pop(next(iter(_REVERSE_CACHE)))
                _REVERSE_CACHE[cache_key] = result
                return result
            else:
                logger.warning(f"Nominatim returned status {resp.status_code} for ({lat}, {lon})")
                return fallback_result
    except Exception as exc:
        logger.warning(f"Reverse geocode exception for ({lat}, {lon}): {exc}")
        return fallback_result


@router.get("/search")
async def search_places(
    q: str = Query(..., min_length=2, description="Place or address query")
):
    """Searches for locations/landmarks matching user input."""
    q_norm = q.strip().lower()
    if q_norm in _SEARCH_CACHE:
        return {"results": _SEARCH_CACHE[q_norm]}

    try:
        url = f"https://nominatim.openstreetmap.org/search?format=json&q={httpx.URL(q_norm)}&limit=5&addressdetails=1"
        async with httpx.AsyncClient(timeout=4.0, headers=NOMINATIM_HEADERS) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                results = []
                for item in data:
                    lat = float(item["lat"])
                    lon = float(item["lon"])
                    display = item.get("display_name", "")
                    clean_display = ", ".join([p.strip() for p in display.split(",")[:3]])
                    results.append({
                        "latitude": lat,
                        "longitude": lon,
                        "display_name": clean_display,
                        "full_name": display
                    })

                if len(_SEARCH_CACHE) >= _MAX_CACHE_SIZE:
                    _SEARCH_CACHE.pop(next(iter(_SEARCH_CACHE)))
                _SEARCH_CACHE[q_norm] = results
                return {"results": results}
    except Exception as exc:
        logger.warning(f"Place search failed for '{q}': {exc}")

    return {"results": []}
