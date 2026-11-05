// =====================================================================
// Slate Cockpit - hitch camera mount
// A two-piece collar that clamps round the OUTSIDE of a 2" square hitch
// receiver tube, near its mouth, so a ball mount or bike rack can still
// go in. The side walls carry a slot so the hitch pin passes straight
// through. The top is the camera plate: it takes the cam-bracket base
// (2x M4 at 34 mm) or a cube cam's 1/4-20 directly.
//
// Parts: "assembly", "collar", "strap"   (each emitted in print orientation)
//
// Frame: X along the receiver (x = 0 at the mouth, -X into the truck),
//        Y across, Z up. The tube is centred on Y = Z = 0.
//
// WHERE THE NUMBERS COME FROM
//  STANDARD (SAE Class III/IV 2" receiver, not measured on the Slate):
//   - 2.0" (50.8 mm) inside, typically 2.5" (63.5 mm) outside, 0.25" wall
//   - 5/8" (15.9 mm) hitch pin, hole centred on the tube's height
//  ASSUMED - MEASURE ON THE TRUCK (Slate's receiver is an accessory and
//  hadn't been delivered when this was drawn):
//   - tube_w / tube_h outside size, and whether the tube is square-cornered
//     (outer corner radius tube_r)
//   - pin_from_mouth: pin-hole centre to the mouth face
//   - any reinforcing collar at the mouth (mouth_collar_*), safety-chain
//     loops or welds on the sides/bottom within clamp_len of the mouth:
//     those will stop the collar sliding on
// =====================================================================

part = "assembly";

/* ---------- receiver (ASSUMED / standard) ---------- */
tube_w         = 63.5;   // mm outside width, 2.5 in
tube_h         = 63.5;   // mm outside height
tube_r         = 3;      // mm outside corner radius of the tube
pin_d          = 15.9;   // mm 5/8 in hitch pin
pin_from_mouth = 38;     // mm ASSUMED pin-hole centre from the mouth face (often 1.5 in)
mouth_collar_len = 0;    // mm length of a thicker reinforcing ring at the mouth (0 = none)
mouth_collar_w   = 70;   // mm its outside size, if present

/* ---------- clamp ---------- */
liner        = 1.5;      // mm per side for a rubber/TPU liner (bicycle inner tube works); also the fit clearance
clamp_len    = 70;       // mm collar length along the tube
mouth_setback = 2;       // mm collar starts this far behind the mouth face
wall         = 5;        // mm side walls
top_t        = 7;        // mm top / camera plate
corner_r     = 4;        // mm inside corner relief for the tube's radius
pin_adjust   = 7;        // mm the pin slot lets the collar slide +/- this much
pin_clear    = 1.0;      // mm slot clearance on the pin diameter
ear_w        = 13;       // mm ear width beyond the side wall
ear_t        = 7;        // mm
clamp_gap    = 2;        // mm ear-to-strap gap left to close when tightening
strap_t      = 7;        // mm bottom strap thickness
bolt_d       = 5.4;      // mm M5 clearance
nut_af       = 8.0;      // mm M5 nut across flats
bolt_head_d  = 10;       // mm clearance for an M5 head or washer
nut_t        = 4.2;      // mm nut pocket depth in the strap
bolt_x       = [10, 60]; // mm bolt positions back from the collar's front edge

/* ---------- camera plate ---------- */
plate_ext    = 0;        // mm the plate overhangs the mouth (camera further back toward a trailer)
cam_x        = 35;       // mm camera hole pattern centre back from the collar's front edge
m4_pitch     = 34;       // mm cam-bracket base hole pitch (along X)
m4_d         = 4.5;      // mm M4 clearance
m4_nut_af    = 7.0;      // mm M4 nut across flats
m4_nut_t     = 3.4;      // mm
tripod       = true;     // also a 1/4-20 hole + nut trap at cam_x
tripod_d     = 6.6;      // mm 1/4-20 clearance
tripod_nut_af = 11.2;    // mm 7/16 in nut across flats
tripod_nut_t = 5.8;      // mm
drain_d      = 6;        // mm drain hole in the strap (water sits on a receiver)

$fn = 48;
eps = 0.01;

/* ---------- derived ---------- */
in_w  = tube_w + 2*liner;
in_h  = tube_h + 2*liner;
out_w = in_w + 2*wall;
x0    = -mouth_setback;                // collar front edge
x1    = x0 - clamp_len;                // collar back edge
z_top = in_h/2;                        // underside of the top plate
z_bar = -in_h/2;                       // top face of the strap
z_ear = z_bar + clamp_gap;             // bottom of the ears / side walls

module hex(af, h) { rotate([0, 0, 30]) cylinder(d = af / cos(30), h = h, $fn = 6); }

module collar() {
    difference() {
        union() {
            // top plate (extends past the mouth by plate_ext)
            translate([x1, -out_w/2, z_top]) cube([clamp_len + plate_ext + mouth_setback * (plate_ext > 0 ? 1 : 0), out_w, top_t]);
            // side walls
            for (s = [-1, 1]) translate([x1, s > 0 ? in_w/2 : -out_w/2, z_ear]) cube([clamp_len, wall, z_top - z_ear + eps]);
            // ears, with 45 deg chamfers above them (they hang off the walls when printed upside down)
            for (s = [-1, 1]) {
                translate([x1, s > 0 ? out_w/2 - eps : -out_w/2 - ear_w, z_ear]) cube([clamp_len, ear_w + eps, ear_t]);
                hull() {
                    translate([x1, s > 0 ? out_w/2 - eps : -out_w/2 - ear_w, z_ear + ear_t - eps]) cube([clamp_len, ear_w + eps, eps]);
                    translate([x1, s > 0 ? out_w/2 - eps : -out_w/2 - eps, z_ear + ear_t + ear_w]) cube([clamp_len, 2*eps, eps]);
                }
            }
        }
        // tube, with corner relief
        translate([x1 - 1, 0, 0]) rotate([0, 90, 0]) linear_extrude(clamp_len + plate_ext + 10)
            offset(r = max(tube_r, 0.5)) square([in_h - 2*max(tube_r, 0.5), in_w - 2*max(tube_r, 0.5)], center = true);
        // optional mouth collar relief
        if (mouth_collar_len > 0) translate([x0 - mouth_collar_len, -(mouth_collar_w/2 + liner), -(mouth_collar_w/2 + liner)])
            cube([mouth_collar_len + 10, mouth_collar_w + 2*liner, mouth_collar_w + 2*liner]);
        // hitch-pin slot through both walls (and ears are below it)
        translate([-pin_from_mouth, 0, 0]) rotate([90, 0, 0]) hull()
            for (d = [-pin_adjust, pin_adjust]) translate([d, 0, 0]) cylinder(d = pin_d + pin_clear, h = out_w + 2*ear_w + 2, center = true);
        // bolts through the ears
        for (bx = bolt_x, s = [-1, 1]) translate([x0 - bx, s*(out_w/2 + ear_w/2), z_ear - 1]) {
            cylinder(d = bolt_d, h = ear_t + ear_w + 2);
            translate([0, 0, ear_t + 1]) cylinder(d = bolt_head_d, h = ear_w + 2);   // flat seat for the head through the chamfer
        }
        // camera holes: M4 pair + nut traps from the underside
        for (d = [-m4_pitch/2, m4_pitch/2]) translate([x0 - cam_x + d, 0, z_top - eps]) {
            cylinder(d = m4_d, h = top_t + 1);
            hex(m4_nut_af + 0.3, m4_nut_t);
        }
        if (tripod) translate([x0 - cam_x, 0, z_top - eps]) {
            cylinder(d = tripod_d, h = top_t + 1);
            hex(tripod_nut_af + 0.3, tripod_nut_t);
        }
    }
}

module strap() {
    difference() {
        translate([x1, -out_w/2 - ear_w, z_bar - strap_t]) cube([clamp_len, out_w + 2*ear_w, strap_t]);
        for (bx = bolt_x, s = [-1, 1]) translate([x0 - bx, s*(out_w/2 + ear_w/2), z_bar - strap_t - 1]) {
            cylinder(d = bolt_d, h = strap_t + 2);
            hex(nut_af + 0.3, nut_t + 1);          // nut pocket on the underside
        }
        translate([x0 - clamp_len/2, 0, z_bar - strap_t - 1]) cylinder(d = drain_d, h = strap_t + 2);
    }
}

module tube_dummy() {
    color("dimgray", 0.5) difference() {
        translate([-200, 0, 0]) rotate([0, 90, 0]) linear_extrude(200) offset(r = tube_r) square([tube_h - 2*tube_r, tube_w - 2*tube_r], center = true);
        translate([-201, 0, 0]) rotate([0, 90, 0]) linear_extrude(202) square([50.8, 50.8], center = true);
        translate([-pin_from_mouth, 0, 0]) rotate([90, 0, 0]) cylinder(d = 17, h = 100, center = true);
    }
    color("silver") translate([-pin_from_mouth, 0, 0]) rotate([90, 0, 0]) cylinder(d = pin_d, h = out_w + 2*ear_w + 20, center = true);
}

if (part == "assembly") { tube_dummy(); color("steelblue") collar(); color("orange") strap(); }
// collar prints upside down: camera plate on the bed, walls up, ear chamfers keep it support-free
else if (part == "collar") translate([0, 0, z_top + top_t]) rotate([180, 0, 0]) collar();
else if (part == "strap")  translate([0, 0, -(z_bar - strap_t)]) strap();
