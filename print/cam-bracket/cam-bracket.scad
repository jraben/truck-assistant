// =====================================================================
// Slate Cockpit - universal small camera bracket
// For cheap 360 / AHD "cube" cameras. A flat base (3M VHB pad or 2x M4),
// a fork, and a tilting arm whose hinge locks with serrated (rosette)
// faces and one M5 bolt + nut, so it holds its angle on a vibrating truck
// instead of relying on friction.
//
// Parts: "assembly", "base", "arm"   (each emitted in print orientation)
//
// WHERE THE NUMBERS COME FROM
//  MEASURED: nothing yet - no camera has been chosen.
//  ASSUMED (measure your camera and surface before printing):
//   - cam_holes: default is one 1/4-20 tripod hole in the middle, the
//     most common mount on small AHD/360 cube cams. Many instead have
//     2-3 M3/M4 holes on a small circle; list them in cam_holes.
//   - the mounting surface is flat over at least base_l x base_w
//   - base_hole_pitch 34 mm matches the hitch-cam-mount top plate
// =====================================================================

part = "assembly";

/* ---------- base ---------- */
base_l          = 56;    // mm along the hinge-perpendicular direction (VHB pad length)
base_w          = 34;    // mm (VHB pad width; 3M 5952 comes in 1/2 and 1 in strips)
base_t          = 4;     // mm
base_r          = 4;     // mm corner radius
base_hole_d     = 4.5;   // mm M4 clearance
base_hole_pitch = 34;    // mm between the two M4 holes (shared with hitch-cam-mount)
base_csk        = true;  // countersink the M4 holes (flat-head screws keep the VHB face flat)
vhb_recess      = 0.0;   // mm optional recess for the VHB pad (0 = flat; 0.3 keeps squeeze-out tidy)

/* ---------- hinge ---------- */
pivot_h        = 20;     // mm hinge axis height above the base bottom
pivot_r        = 9;      // mm hinge boss radius
knuckle_w      = 12;     // mm arm knuckle width (between its tooth tips: + 2*tooth_h)
cheek_t        = 6;      // mm fork cheek thickness (leaves ~1.8 mm behind the nut trap)
bolt_d         = 5.4;    // mm M5 clearance
nut_af         = 8.0;    // mm M5 nut across flats
nut_clear      = 0.3;    // mm
nut_depth      = 4.2;    // mm M5 nut is 4 mm thick
head_d         = 9.5;    // mm M5 head counterbore (socket head 8.5)
head_depth     = 2.0;    // mm
teeth          = 24;     // number of serrations: 15 deg steps
tooth_h        = 0.8;    // mm serration height
tooth_r_in     = 4.0;    // mm serrations start this far from the axis
hinge_clear    = 0.3;    // mm extra fork gap so the faces close under the bolt

/* ---------- arm and camera plate ---------- */
arm_len      = 22;       // mm hinge axis to camera plate underside
arm_t        = 6;        // mm arm thickness (along the tilt direction)
plate_l      = 40;       // mm camera plate length (along the tilt direction)
plate_w      = 30;       // mm
plate_t      = 4;        // mm
plate_offset = 17;       // mm plate centre ahead of the arm, so the tripod screw clears the arm
cam_holes    = [[0, 0]]; // mm hole centres on the plate, about the plate centre
cam_hole_d   = 6.6;      // mm 1/4-20 clearance (use 3.4 for M3, 4.5 for M4)
cam_cbore_d  = 12;       // mm counterbore for the screw head, underside
cam_cbore_h  = 2;        // mm
cam_slot     = 3;        // mm extra slot length on each hole so the camera can slide (0 = round hole)

$fn = 48;
eps = 0.01;

/* ---------- derived ---------- */
gap = knuckle_w + 2*tooth_h + hinge_clear;    // flat-face to flat-face fork gap
fork_w = gap + 2*cheek_t;

/* ---------- helpers ---------- */
// ring of radial serrations on the XY plane, teeth pointing +Z, height tooth_h
module rosette(r_out, n = teeth, h = tooth_h, r_in = tooth_r_in) {
    pitch = 360 / n;
    hw = r_out * tan(pitch / 2) * 1.02;   // half width of one tooth at r_out
    intersection() {
        union() for (i = [0 : n - 1]) rotate([0, 0, i * pitch])
            // wedge: zero width on the axis, full width at r_out, constant height h
            hull() {
                translate([0, -eps / 2, 0]) cube([eps, eps, h]);
                translate([r_out, 0, 0]) rotate([90, 0, 90]) linear_extrude(eps)
                    polygon([[-hw, 0], [hw, 0], [0, h]]);
            }
        difference() { cylinder(r = r_out, h = h + eps); translate([0, 0, -1]) cylinder(r = r_in, h = h + 2); }
    }
}
module rbox(l, w, t, r) { linear_extrude(t) offset(r) offset(-r) square([l, w], center = true); }

/* ---------- base + fork ---------- */
module base() {
    difference() {
        union() {
            rbox(base_l, base_w, base_t, base_r);
            for (s = [-1, 1]) translate([0, s * (gap / 2 + cheek_t / 2), 0]) {
                // cheek: a plate rising to the hinge boss
                hull() {
                    translate([-pivot_r, -cheek_t / 2, 0]) cube([2 * pivot_r, cheek_t, base_t]);
                    translate([0, 0, pivot_h]) rotate([90, 0, 0]) cylinder(r = pivot_r, h = cheek_t, center = true);
                }
                // inner-face serrations
                translate([0, -s * cheek_t / 2, pivot_h]) rotate([s > 0 ? 90 : -90, 0, 0])
                    rosette(pivot_r - 0.5);
            }
            // gussets outside each cheek, below the nut / head recesses
            for (s = [-1, 1]) hull() {
                translate([-1.5, s > 0 ? fork_w / 2 - eps : -fork_w / 2 - 4, 0]) cube([3, 4 + eps, base_t]);
                translate([-1.5, s > 0 ? fork_w / 2 - eps : -fork_w / 2, 0]) cube([3, eps, pivot_h - pivot_r]);
            }
        }
        // bolt
        translate([0, 0, pivot_h]) rotate([90, 0, 0]) cylinder(d = bolt_d, h = fork_w + 20, center = true);
        // nut trap on -Y cheek, head counterbore on +Y cheek
        translate([0, -fork_w / 2 - eps, pivot_h]) rotate([-90, 0, 0])
            rotate([0, 0, 30]) cylinder(d = (nut_af + nut_clear) / cos(30), h = nut_depth, $fn = 6);
        translate([0, fork_w / 2 + eps, pivot_h]) rotate([90, 0, 0]) cylinder(d = head_d, h = head_depth);
        // M4 holes
        for (s = [-1, 1]) translate([s * base_hole_pitch / 2, 0, -eps]) {
            cylinder(d = base_hole_d, h = base_t + 1);
            if (base_csk) translate([0, 0, base_t - 2.3]) cylinder(d1 = base_hole_d, d2 = base_hole_d + 4.6 + eps, h = 2.3 + 2*eps);  // 90 deg csk for M4 flat heads
        }
        if (vhb_recess > 0) translate([0, 0, -eps]) rbox(base_l - 4, base_w - 4, vhb_recess, base_r);
    }
}

/* ---------- arm (knuckle + arm + camera plate), modelled at the hinge ---------- */
module arm() {
    difference() {
        union() {
            // knuckle body
            rotate([90, 0, 0]) cylinder(r = pivot_r, h = knuckle_w, center = true);
            for (s = [-1, 1]) translate([0, s * knuckle_w / 2, 0]) rotate([s > 0 ? -90 : 90, 0, 0]) rosette(pivot_r - 0.5);
            // arm
            translate([-arm_t / 2, -knuckle_w / 2, 0]) cube([arm_t, knuckle_w, arm_len]);
            // 45 deg skirt under the knuckle (it prints upside down, knuckle on top)
            hull() {
                translate([-pivot_r * 0.7, -knuckle_w / 2, pivot_r * 0.7]) cube([1.4 * pivot_r, knuckle_w, eps]);
                translate([-arm_t / 2, -knuckle_w / 2, pivot_r * 1.4 - arm_t / 2]) cube([arm_t, knuckle_w, eps]);
            }
            // camera plate (its underside at arm_len)
            translate([plate_offset - plate_l / 2, -plate_w / 2, arm_len]) cube([plate_l, plate_w, plate_t]);
            // fillet the arm into the plate
            hull() {
                translate([-arm_t / 2, -knuckle_w / 2, arm_len - 6]) cube([arm_t, knuckle_w, eps]);
                translate([-arm_t / 2 - 4, -knuckle_w / 2, arm_len]) cube([arm_t + 8, knuckle_w, eps]);
            }
        }
        rotate([90, 0, 0]) cylinder(d = bolt_d, h = knuckle_w + 4, center = true);
        for (h = cam_holes) translate([plate_offset + h[0], h[1], arm_len - 1]) {
            hull() for (d = [-cam_slot, cam_slot]) translate([d, 0, 0]) cylinder(d = cam_hole_d, h = plate_t + 2);
            if (h[0] + plate_offset - cam_cbore_d / 2 - cam_slot >= arm_t / 2 + 4)   // counterbore only where the arm isn't
                hull() for (d = [-cam_slot, cam_slot]) translate([d, 0, 0]) cylinder(d = cam_cbore_d, h = cam_cbore_h + 1);
        }
    }
}

if (part == "assembly") {
    color("steelblue") base();
    color("orange") translate([0, 0, pivot_h]) rotate([0, 20, 0]) arm();
}
else if (part == "base") base();
// arm prints plate-down: the knuckle stands on top with its serrations on vertical faces
else if (part == "arm") translate([0, 0, arm_len + plate_t]) mirror([0, 0, 1]) arm();
