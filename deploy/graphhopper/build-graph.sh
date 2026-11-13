#!/usr/bin/env bash
# Build the truck's offline routing graph on the homelab (needs internet, Java 17+,
# and osmium-tool when merging more than one state). Copy the result to the Pi.
#
#   ./build-graph.sh arizona nevada utah            # Geofabrik US state names
#   ./build-graph.sh --pbf my-region.osm.pbf        # an extract you already have
#   HEAP=12g ./build-graph.sh california            # more memory for big states
#
# Output: graph-<date>.tar.gz (the graph-cache folder) and the jar it was built with.
set -euo pipefail
GH_VERSION="${GH_VERSION:-10.2}"
HEAP="${HEAP:-6g}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$PWD/gh-build}"
mkdir -p "$WORK"; cd "$WORK"

JAR="graphhopper-web-$GH_VERSION.jar"
if [ ! -f "$JAR" ]; then
  echo "Downloading GraphHopper $GH_VERSION from Maven Central..."
  curl -fSL -o "$JAR" "https://repo1.maven.org/maven2/com/graphhopper/graphhopper-web/$GH_VERSION/graphhopper-web-$GH_VERSION.jar"
fi

PBF=""
if [ "${1:-}" = "--pbf" ]; then
  PBF="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
else
  [ $# -ge 1 ] || { echo "usage: $0 state [state...]  |  $0 --pbf file.osm.pbf" >&2; exit 2; }
  files=()
  for s in "$@"; do
    f="$s-latest.osm.pbf"
    if [ ! -f "$f" ]; then
      echo "Downloading $s from Geofabrik..."
      curl -fSL -A "truck-assistant-graph-build" -o "$f" "https://download.geofabrik.de/north-america/us/$s-latest.osm.pbf"
    fi
    files+=("$f")
  done
  if [ ${#files[@]} -eq 1 ]; then PBF="$PWD/${files[0]}"
  else
    command -v osmium >/dev/null || { echo "Merging states needs osmium-tool (apt install osmium-tool)" >&2; exit 1; }
    osmium merge --overwrite -o region.osm.pbf "${files[@]}"
    PBF="$PWD/region.osm.pbf"
  fi
fi

rm -rf graph-cache
echo "Building the graph from $(basename "$PBF") with ${HEAP} of memory..."
start=$(date +%s)
java -Xmx"$HEAP" -XX:+UseParallelGC \
  -Ddw.graphhopper.datareader.file="$PBF" -Ddw.graphhopper.graph.location="$WORK/graph-cache" \
  -jar "$JAR" import "$HERE/config.yml"
out="graph-$(date +%Y%m%d).tar.gz"
tar -czf "$out" graph-cache
echo "Done in $(( $(date +%s) - start ))s: $WORK/$out ($(du -sh graph-cache | cut -f1) unpacked)."
echo "On the Pi: see $HERE/README.md, 'Install on the Pi'."
