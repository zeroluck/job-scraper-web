#!/usr/bin/env python3

import csv
import re
import sys
import unicodedata
from pathlib import Path


ADMIN1 = {
    "01": "ab",
    "02": "bc",
    "03": "mb",
    "04": "nb",
    "05": "nl",
    "07": "ns",
    "08": "on",
    "09": "pe",
    "10": "qc",
    "11": "sk",
    "12": "yt",
    "13": "nt",
    "14": "nu",
}

FIXED = {
    "p:ab": (55.0, -115.0),
    "p:bc": (53.7267, -127.6476),
    "p:mb": (53.7609, -98.8139),
    "p:nb": (46.5653, -66.4619),
    "p:nl": (53.1355, -57.6604),
    "p:ns": (44.682, -63.7443),
    "p:nt": (64.8255, -124.8457),
    "p:nu": (70.2998, -83.1076),
    "p:on": (50.0007, -85.3232),
    "p:pe": (46.5107, -63.4168),
    "p:qc": (52.9399, -73.5491),
    "p:sk": (52.9399, -106.4509),
    "p:yt": (64.2823, -135.0),
    "m:calgary": (51.0447, -114.0719),
    "m:edmonton": (53.5461, -113.4938),
    "m:halifax": (44.6488, -63.5752),
    "m:hamilton": (43.2557, -79.8711),
    "m:kitchener_waterloo": (43.4516, -80.4925),
    "m:london": (42.9849, -81.2453),
    "m:montreal": (45.5019, -73.5674),
    "m:ottawa_gatineau": (45.4215, -75.6972),
    "m:quebec_city": (46.8139, -71.2080),
    "m:regina": (50.4452, -104.6189),
    "m:saskatoon": (52.1579, -106.6702),
    "m:toronto": (43.6532, -79.3832),
    "m:vancouver": (49.2827, -123.1207),
    "m:victoria": (48.4284, -123.3656),
    "m:winnipeg": (49.8951, -97.1384),
}


def normalize(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "", ascii_value.lower().replace("'", ""))


def target_buckets(seed_path: Path) -> set[str]:
    return set(re.findall(r"'((?:c|m|p):[^']+)'", seed_path.read_text()))


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("usage: generate_canada_place_coordinates.py GEONAMES_CA POPULATION_SEED OUTPUT")

    geonames_path = Path(sys.argv[1])
    buckets = target_buckets(Path(sys.argv[2]))
    output_path = Path(sys.argv[3])
    matches: dict[str, tuple[int, float, float]] = {}

    with geonames_path.open(newline="", encoding="utf-8") as source:
        for row in csv.reader(source, delimiter="\t"):
            if len(row) < 15 or row[6] != "P" or row[8] != "CA":
                continue
            province = ADMIN1.get(row[10])
            if not province:
                continue
            names = {row[1], row[2], *row[3].split(",")}
            population = int(row[14] or 0)
            latitude = float(row[4])
            longitude = float(row[5])
            for name in names:
                bucket = f"c:{normalize(name)}|{province}"
                if bucket not in buckets:
                    continue
                previous = matches.get(bucket)
                if previous is None or population > previous[0]:
                    matches[bucket] = (population, latitude, longitude)

    coordinates = {bucket: (lat, lon) for bucket, (_, lat, lon) in matches.items()}
    coordinates.update(FIXED)
    values = []
    for bucket, (latitude, longitude) in sorted(coordinates.items()):
        admin1 = bucket.rsplit("|", 1)[1].upper() if bucket.startswith("c:") else None
        admin_sql = f"'{admin1}'" if admin1 else "NULL"
        values.append(
            f"  ('{bucket}', 'CA', {admin_sql}, {latitude:.6f}, {longitude:.6f}, "
            "'GeoNames', 'place_centroid')"
        )

    sql = "-- Generated from GeoNames CA.txt (CC BY 4.0) plus province and metro centroids.\n"
    sql += "INSERT INTO public.insight_place_coordinates (\n"
    sql += "  bucket, country_code, admin1_code, latitude, longitude, coordinate_source, coordinate_quality\n"
    sql += ") VALUES\n"
    sql += ",\n".join(values)
    sql += "\nON CONFLICT (bucket) DO UPDATE SET\n"
    sql += "  country_code = EXCLUDED.country_code,\n"
    sql += "  admin1_code = EXCLUDED.admin1_code,\n"
    sql += "  latitude = EXCLUDED.latitude,\n"
    sql += "  longitude = EXCLUDED.longitude,\n"
    sql += "  coordinate_source = EXCLUDED.coordinate_source,\n"
    sql += "  coordinate_quality = EXCLUDED.coordinate_quality,\n"
    sql += "  updated_at = now();\n"
    output_path.write_text(sql)
    print(f"wrote {len(coordinates)} coordinate rows to {output_path}")


if __name__ == "__main__":
    main()
