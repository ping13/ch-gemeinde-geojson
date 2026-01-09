#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   GEMEINDE_CODE=261  ./gemeinde_json.sh
# or
#   GEMEINDE_NAME="Zürich" ./gemeinde_json.sh
#
# Note: INSPIRE “Administrative Units” is based on swissBOUNDARIES3D.  [oai_citation:0‡inspire-geoportal.ec.europa.eu](https://inspire-geoportal.ec.europa.eu/srv/api/records/fc2c80e5-fc87-415a-ac05-b2520957d155?language=eng&utm_source=chatgpt.com)

GEMEINDE_CODE="${GEMEINDE_CODE:-}"   # BFS number (if available in parquet)
GEMEINDE_NAME="${GEMEINDE_NAME:-}"   # name (preferred for slim parquet)
OUT="${OUT:-gemeinde.geojson}"
NAME_FIELD="${NAME_FIELD:-text}"
LAYER="${LAYER:-swissboundaries}"

WORKDIR="${WORKDIR:-$(dirname "$0")/assets}"
PARQUET="${PARQUET:-$WORKDIR/swissboundaries.parquet}"

make -s -f "$(dirname "$0")/Makefile" \
  WORKDIR="$WORKDIR" PARQUET="$PARQUET" LAYER="${LAYER:-}" parquet

# Build a filter (field names depend on the layer schema; adjust after running:
#   ogrinfo -ro -so "$GML" "$LAYER"
BASE_WHERE=""
if [[ -n "$GEMEINDE_CODE" ]]; then
  # INSPIRE commonly uses nationalCode / nationalCode_href-like fields for identifiers
  if ogrinfo -ro -so "$PARQUET" "$LAYER" | rg -q '^nationalCode:'; then
    BASE_WHERE="nationalCode = '$GEMEINDE_CODE'"
  else
    echo "GEMEINDE_CODE requires a parquet with a nationalCode field."
    echo "Current parquet appears to be slimmed to name + type + geometry."
    exit 2
  fi
elif [[ -n "$GEMEINDE_NAME" ]]; then
  if [[ -n "$NAME_FIELD" ]]; then
    BASE_WHERE="$NAME_FIELD = '$GEMEINDE_NAME'"
  else
    echo "Could not find a suitable name field in $PARQUET."
    echo "Try setting NAME_FIELD explicitly after inspecting fields:"
    echo "  ogrinfo -ro -so \"$PARQUET\""
    exit 2
  fi
fi

if [[ -z "$BASE_WHERE" ]]; then
  echo "Set GEMEINDE_CODE (BFS) or GEMEINDE_NAME. To inspect fields:"
  echo "  ogrinfo -ro -so \"$PARQUET\""
  exit 2
fi

WHERE="$BASE_WHERE"

if [[ -n "$WHERE" ]]; then
  if [[ -f "$OUT" ]]; then
    rm -f "$OUT"
  fi
  ogr2ogr -overwrite -f GeoJSON "$OUT" "$PARQUET" -where "$WHERE"
else
  echo "Set GEMEINDE_CODE (BFS) or GEMEINDE_NAME. To inspect fields:"
  echo "  ogrinfo -ro -so \"$PARQUET\""
  exit 2
fi

echo "Wrote: $OUT"
