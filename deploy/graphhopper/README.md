# Offline routing: GraphHopper on the Pi

The road-trip planner and the airport pickup need road routes: miles, driving
time and the shape of the road, so they can work out energy per leg and which
chargers are on the way. Without this, those come from OSRM's public demo
server, which needs the internet. With it, they come from a GraphHopper server
on the Pi, built for the states you drive, so they work with no signal at all.

Turn-by-turn navigation is not this. That stays in Waze, or an offline app on the
tablet (Settings, Truck, Navigation).

```
homelab (internet, memory)            Pi (in the truck)
  build-graph.sh arizona nevada  ──►   /opt/graphhopper/graph-cache
  = graph-YYYYMMDD.tar.gz              graphhopper.service on 127.0.0.1:8989
                                       brain: Settings, Truck, Route planning
```

GraphHopper 10.2 (Apache-2.0), from Maven Central. It runs on Java 17 or newer,
which Raspberry Pi OS ships. GraphHopper 11 needs Java 25.

## 1. Build the graph on the homelab

Building is the memory-hungry part, so do it on the NAS or a desktop, not the
Pi. You need Java 17+ (`apt install openjdk-17-jre-headless`), and
`osmium-tool` if you combine more than one state.

```sh
cd deploy/graphhopper
./build-graph.sh arizona nevada utah        # Geofabrik's US state names
HEAP=12g ./build-graph.sh california        # big states need more memory
./build-graph.sh --pbf my-region.osm.pbf    # or an extract you already have
```

It downloads the GraphHopper jar and the states, merges them, builds the graph
and leaves `gh-build/graph-YYYYMMDD.tar.gz`. It also prints the unpacked size,
which is roughly the memory the Pi will need (see Memory).

## 2. Install on the Pi

```sh
sudo apt install openjdk-17-jre-headless
sudo mkdir -p /opt/graphhopper && sudo chown slate: /opt/graphhopper
# from the homelab:
scp gh-build/graphhopper-web-10.2.jar pi:/opt/graphhopper/graphhopper-web.jar
scp config.yml graphhopper.service gh-build/graph-*.tar.gz pi:/opt/graphhopper/
# on the Pi:
cd /opt/graphhopper && tar -xzf graph-*.tar.gz
sudo cp graphhopper.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now graphhopper
curl -s localhost:8989/info | head -c 200    # bbox, profiles, version
```

Then in the cockpit, go to **Settings, Truck, Route planning** and set the local
router to `http://localhost:8989`. The card says what it covers and whether it
has elevation. You can also set `GRAPHHOPPER_URL=http://localhost:8989` in the
brain's environment. The setting in Settings wins.

Updating: rebuild on the homelab every month or two. Copy the new tarball,
replace `graph-cache`, and `sudo systemctl restart graphhopper`.

## How the brain uses it

- **Order of routers.** It asks the local GraphHopper first. If the trip leaves
  the graph's area or GraphHopper isn't running, it asks OSRM (`ROUTER_URL`, or
  the public demo when "Use the public router" is on and the truck is online).
  If neither answers, it uses a straight line plus 25%, and says so.
- **Towing.** While a trailer is hitched (Parked, Tow), each route request sends a
  custom model that caps the speed at the towing limit (Settings, default 65 mph).
  That is why the graph is prepared with landmarks (LM), not CH: CH can't take a
  per-request custom model. LM keeps those requests fast.
- **Elevation.** Uncomment `graph.elevation.provider: srtm` in `config.yml` before
  building. Climbs then come from the graph with no internet, instead of from
  Open-Meteo. The SRTM data is downloaded during the build. This path is
  untested so far, so check the Route planning card says "with elevation".

## Memory

The graph is held in RAM (`RAM_STORE`). Give the service a heap a little over
the unpacked `graph-cache` size (`HEAP=` in `graphhopper.service`), plus about
200 MB for Java itself. That 200 MB was measured on a tiny test graph.
GraphHopper publishes no per-state figures, so check your own build's printed
size before relying on it. On an 8 GB Pi 5 a few states should leave plenty for
the brain, the cockpit and the cameras.

If a region is too big for RAM, set `graph.dataaccess.default_type: MMAP` in
`config.yml`. The graph is then read from disk as needed, which uses less memory
but routes more slowly, especially on an SD card.

## What's been tested

On a hand-built OpenStreetMap network around Phoenix (a 12×12 grid of 25 mph
streets and a 65 mph freeway): the build script imported it, the service
command served the prebuilt graph, and the brain routed through it. It took the
freeway (9.9 mi, 10.2 min). The towing cap at 45 mph gave the same road in
13.3 min. It fell back correctly outside the graph and with the router down.

Not yet tested: a real state extract (Geofabrik couldn't be reached from the
build sandbox), the memory a real state needs, and SRTM elevation.
