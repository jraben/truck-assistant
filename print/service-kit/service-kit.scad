// =====================================================================
// Slate Cockpit - service kit
// The parts that make the install clean and quick to service:
//   "rail"       slide-out rail for the brain enclosure. Its existing ears
//                slide into the two channels; one thumbscrew locks it.
//                Pulling the brain = loosen 1 thumbscrew, unplug 1 connector.
//   "dt_bracket" service-point bracket: holds the Deutsch DT plugs where every
//                run meets (12 V, screen, cams, truck box), zip-tied in saddles.
//   "loom_clip"  snap clip for split loom, on a VHB pad or an M5 screw.
//   "dock"       tray for the Carlinkit + powered USB hub, velcro-strapped,
//                bolts beside the rail on the same dash rail slots.
//   "assembly"   all of the above in place (preview only).
//
// WHERE THE NUMBERS COME FROM
//  FROM THIS REPO: the brain enclosure's ears (brain-enclosure.scad):
//   18 mm long, 4 mm thick, slots on a 70 mm pitch, body 93 x 126 mm.
//  ASSUMED - CHECK BEFORE PRINTING:
//   - THE DASH RAIL IS UNMEASURED (same as the enclosure). The rail plate
//     has slots on rail_mount_pitch for 1/4-20 or M6.
//   - Deutsch DT plug body widths (dt_w) are estimates from TE drawings
//     seen in listings, not measured: 2/4/6/12-pin ~ 16/19/23/33 mm. Print one
//     saddle strip and try the real plugs first.
//   - Carlinkit CPC200-CCPA and hub sizes (dock_*) are listing sizes.
// =====================================================================

part = "assembly";

/* ---------- brain enclosure (from brain-enclosure.scad) ---------- */
box_l        = 93;     // mm along X (ears at each X end)
box_w        = 126;    // mm along Y (slide direction)
ear_len      = 18;     // mm
ear_t        = 4;      // mm
ear_pitch    = 70;     // mm between the two slots on an ear (along Y)

/* ---------- rail ---------- */
clear        = 0.5;    // mm slide clearance per side
plate_t      = 4;      // mm
lip_over     = 7;      // mm the channel lip overlaps the ear
lip_t        = 3;      // mm
rail_len     = box_w + 10;
stop_t       = 4;      // mm back stop
thumb_d      = 6.6;    // mm 1/4-20 / M6 lock screw (into a heat-set insert)
insert_d     = 8.0;    // mm 1/4-20 heat-set insert hole (use 7.9 for M6)
rail_mount_d = 6.6;    // mm
rail_mount_pitch = 60; // mm ASSUMED, slots along Y on the plate centre line
slot_len     = 10;     // mm adjustment

/* ---------- DT service bracket ---------- */
dt_w         = [16, 19, 23, 33];   // mm ASSUMED plug body widths (2/4/6/12-pin)
dt_h         = 18;     // mm saddle height
dt_gap       = 6;      // mm between saddles
dt_base_t    = 3.5;    // mm
dt_depth     = 30;     // mm along the plug
tie_slot     = [4.5, 2.2]; // mm zip-tie slot

/* ---------- loom clip ---------- */
loom_d       = 13;     // mm split loom OD (10 or 13 are common)
clip_t       = 2.4;    // mm
clip_w       = 12;     // mm
clip_open    = 0.72;   // fraction of loom_d left open for the snap
pad          = [28, 20, 3]; // mm VHB pad base
screw_d      = 5.4;    // mm M5

/* ---------- dock ---------- */
dock_cl      = [67, 67, 14];  // mm Carlinkit CPC200-CCPA (listing size)
dock_hub     = [110, 45, 22]; // mm powered USB hub (typical 4-port)
dock_wall    = 2.5;
dock_floor   = 3;
strap_slot   = [3.2, 22];     // mm velcro strap slots

$fn = 48;
eps = 0.01;

/* ---------- derived ---------- */
ch_in   = box_l + 2*ear_len + 2*clear;   // channel inside width (X)
plate_w = ch_in + 2*(lip_t + 1);         // plate width (X)

module rbox(l, w, h, r=2) { translate([r, r, 0]) linear_extrude(h) offset(r) square([l - 2*r, w - 2*r]); }
module slot(d, len, h) { hull() for (s=[-1,1]) translate([0, s*len/2, 0]) cylinder(d=d, h=h); }

// ---------------- rail ----------------
module rail() {
  difference() {
    union() {
      rbox(plate_w, rail_len, plate_t, 3);
      // two channels: wall + lip over each ear
      for (side=[0,1]) {
        x0 = side == 0 ? 0 : plate_w - (lip_t + 1);
        translate([x0, 0, 0]) cube([lip_t + 1, rail_len, plate_t + ear_t + clear + lip_t]);
        lx = side == 0 ? 0 : plate_w - (lip_t + 1) - lip_over;
        translate([lx, 0, plate_t + ear_t + clear]) cube([lip_over + lip_t + 1, rail_len, lip_t]);
      }
      // back stop
      translate([0, rail_len - stop_t, 0]) cube([plate_w, stop_t, plate_t + ear_t + clear + lip_t]);
      // lock boss at the front, under the first ear slot
      for (side=[0,1]) translate([side == 0 ? lip_t + 1 + ear_len/2 : plate_w - lip_t - 1 - ear_len/2, (rail_len - ear_pitch)/2 - 3, 0])
        cylinder(d=insert_d + 5, h=plate_t);
    }
    // mounting slots to the dash rail
    for (s=[-1,1]) translate([plate_w/2, rail_len/2 + s*rail_mount_pitch/2, -eps]) slot(rail_mount_d, slot_len, plate_t + 2*eps);
    // lock inserts (one per side; use one or both)
    for (side=[0,1]) translate([side == 0 ? lip_t + 1 + ear_len/2 : plate_w - lip_t - 1 - ear_len/2, (rail_len - ear_pitch)/2 - 3, -eps])
      cylinder(d=insert_d, h=plate_t + 2*eps);
    // vents / weight
    for (y=[20:16:rail_len-30]) if (abs(y + 4 - (rail_len/2 - rail_mount_pitch/2)) > 14 && abs(y + 4 - (rail_len/2 + rail_mount_pitch/2)) > 14)
      translate([plate_w/2 - 25, y, -eps]) rbox(50, 8, plate_t + 2*eps, 2);
    // lead-in chamfer on the channels
    for (side=[0,1]) translate([side == 0 ? lip_t + 1 : plate_w - lip_t - 1, -eps, plate_t + ear_t/2 + clear])
      rotate([-90,0,0]) cylinder(d1=ear_t + 4, d2=ear_t, h=6, $fn=4);
  }
}

// ---------------- DT bracket ----------------
function dt_total(i=0) = i >= len(dt_w) ? dt_gap : dt_w[i] + 2*2.4 + dt_gap + dt_total(i + 1);
function dt_x(i) = i == 0 ? dt_gap : dt_x(i - 1) + dt_w[i - 1] + 2*2.4 + dt_gap;
module dt_bracket() {
  L = dt_total();
  difference() {
    union() {
      rbox(L, dt_depth, dt_base_t, 2);
      for (i=[0:len(dt_w)-1]) translate([dt_x(i), 0, 0]) difference() {
        cube([dt_w[i] + 4.8, dt_depth, dt_h]);
        translate([2.4, -eps, dt_base_t]) cube([dt_w[i], dt_depth + 2*eps, dt_h]);
      }
      // mounting tab
      translate([L/2 - 12, dt_depth - eps, 0]) rbox(24, 16, dt_base_t, 3);
    }
    for (i=[0:len(dt_w)-1]) for (y=[7, dt_depth - 7]) translate([dt_x(i) + 2.4 + dt_w[i]/2 - tie_slot[1]/2 - 0, y - tie_slot[0]/2, -eps])
      cube([tie_slot[1], tie_slot[0], dt_base_t + 2*eps]);
    translate([L/2, dt_depth + 8, -eps]) cylinder(d=screw_d, h=dt_base_t + 2*eps);
  }
}

// ---------------- loom clip ----------------
module loom_clip(screw=false) {
  r = loom_d/2;
  difference() {
    union() {
      translate([-pad[0]/2, -pad[1]/2, 0]) rbox(pad[0], pad[1], pad[2], 3);
      translate([0, clip_w/2, pad[2] + r]) rotate([90,0,0]) difference() {
        cylinder(r=r + clip_t, h=clip_w);
        translate([0,0,-eps]) cylinder(r=r, h=clip_w + 2*eps);
        // snap opening at the top
        a = asin(clip_open/2) * 2;
        translate([0,0,-eps]) linear_extrude(clip_w + 2*eps) polygon([[0,0], [ (r+clip_t+2)*sin(a/2), (r+clip_t+2)*cos(a/2) ], [ -(r+clip_t+2)*sin(a/2), (r+clip_t+2)*cos(a/2) ]]);
      }
      translate([-(r + clip_t)*0.7, -clip_w/2, 0]) cube([(r + clip_t)*1.4, clip_w, pad[2] + r*0.6]);
    }
    translate([0, 0, pad[2] + r]) rotate([90,0,0]) translate([0,0,-clip_w]) cylinder(r=r, h=2*clip_w);
    if (screw) translate([pad[0]/2 - 6, 0, -eps]) cylinder(d=screw_d, h=pad[2] + 2*eps);
  }
}

// ---------------- dock ----------------
module dock() {
  L = dock_hub[0] + 2*dock_wall;
  W = dock_cl[1] + dock_hub[1] + 3*dock_wall;
  H = 10;
  difference() {
    union() {
      rbox(L, W, dock_floor, 3);
      difference() {
        rbox(L, W, H, 3);
        translate([dock_wall, dock_wall, dock_floor]) cube([dock_hub[0], dock_hub[1], H]);
        translate([dock_wall, 2*dock_wall + dock_hub[1], dock_floor]) cube([dock_cl[0], dock_cl[1], H]);
        translate([2*dock_wall + dock_cl[0], 2*dock_wall + dock_hub[1], dock_floor]) cube([L, dock_cl[1], H]);
        // cable exits
        for (y=[dock_wall + dock_hub[1]/2, 2*dock_wall + dock_hub[1] + dock_cl[1]/2]) translate([-eps, y - 9, dock_floor + 2]) cube([L + 2*eps, 18, H]);
      }
      // ears onto the same dash rail as the brain rail
      for (s=[-1,1]) translate([L/2 + s*(L/2 + 9) - 9, W/2 - 15, 0]) rbox(18, 30, 4, 3);
    }
    for (s=[-1,1]) translate([L/2 + s*(L/2 + 9), W/2, -eps]) slot(rail_mount_d, slot_len, 4 + 2*eps);
    // velcro strap slots across each bay
    for (x=[L*0.25, L*0.7]) translate([x - strap_slot[1]/2, dock_wall + dock_hub[1]/2 - strap_slot[0]/2 - 14, -eps]) cube([strap_slot[1], strap_slot[0], dock_floor + 2*eps]);
    for (x=[L*0.25, L*0.7]) translate([x - strap_slot[1]/2, dock_wall + dock_hub[1]/2 - strap_slot[0]/2 + 14, -eps]) cube([strap_slot[1], strap_slot[0], dock_floor + 2*eps]);
    translate([dock_wall + dock_cl[0]/2 - strap_slot[1]/2, 2*dock_wall + dock_hub[1] + 10, -eps]) cube([strap_slot[1], strap_slot[0], dock_floor + 2*eps]);
    translate([dock_wall + dock_cl[0]/2 - strap_slot[1]/2, 2*dock_wall + dock_hub[1] + dock_cl[1] - 13, -eps]) cube([strap_slot[1], strap_slot[0], dock_floor + 2*eps]);
    // vents
    for (x=[12:10:L-14]) translate([x, W - dock_wall - dock_cl[1]/2 - 15, -eps]) cube([4, 30, dock_floor + 2*eps]);
  }
}

// ---------------- dummies for the assembly ----------------
module brain_dummy() {
  color("#3a4048") translate([lip_t + 1 + clear + ear_len, 5, plate_t + clear]) {
    cube([box_l, box_w, 50]);
    for (side=[0,1]) translate([side == 0 ? -ear_len : box_l, 0, 0]) cube([ear_len, box_w, ear_t]);
  }
}

if (part == "rail") rail();
else if (part == "dt_bracket") dt_bracket();
else if (part == "loom_clip") loom_clip(false);
else if (part == "loom_clip_screw") loom_clip(true);
else if (part == "dock") dock();
else if (part == "assembly") {
  color("#c9d1d9") rail();
  brain_dummy();
  color("#c9d1d9") translate([plate_w + 25, 0, 0]) dock();
  color("#3a4048") translate([plate_w + 25 + dock_wall, dock_wall, dock_floor]) cube(dock_hub);
  color("#1f6feb") translate([plate_w + 25 + dock_wall, 2*dock_wall + dock_hub[1], dock_floor]) cube(dock_cl);
  color("#c9d1d9") translate([0, -60, 0]) dt_bracket();
  color("#c9d1d9") for (i=[0:2]) translate([plate_w + 60 + i*40, -40, 0]) loom_clip(i == 2);
}
