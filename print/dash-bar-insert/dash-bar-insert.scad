// =====================================================================
// Slate Cockpit - dash bar insert + sun hood
// Waveshare 12.3" 1920x720 HDMI capacitive touch LCD in one of the two
// large Slate dash panel openings.
//
// Render one part:  openscad -D 'part="bezel_left"' -o x.stl dash-bar-insert.scad
// Parts: "assembly" (preview only), "bezel_left", "bezel_right",
//        "cover_left", "cover_right", "tab", "key", "hood_left",
//        "hood_right", "hood_splice", "fit_test"
// Every printable part is emitted already in its PRINT orientation.
//
// ---------------------------------------------------------------------
// WHERE THE NUMBERS COME FROM
//  VERIFIED (Waveshare's own wiki + drawing, 12.3inch_1920x720_LCD,
//  fetched 2026-11-05, and the STEP file 12_3inch-1920x720-lcd_3d.stp):
//   - outline 301.20 x 123.35 mm, 12.40 mm deep including the driver
//     board; the glass/LCD panel itself is 3.00 mm thick
//   - active area 293.10 x 110.20 mm, 4.05 mm from each end, 10.00 mm
//     from the BOTTOM edge (so 3.15 mm from the top edge)
//   - driver board 86.5 x 56 mm, 4x 3.0 mm holes; it sits on the panel
//     back at u = 25.8..112.3, v = 27.35..83.35 (front-view mm from the
//     panel's lower-left corner, read from the STEP assembly)
//   - all connectors on the board edge nearest the LEFT end (seen from
//     the front), pointing left: HDMI (v 35.85), USB-C touch/full
//     (v 53.35), USB-C power (v 66.85), 3.5 mm jack (v 78.35)
//   - the panel has NO mounting holes: it must be clamped by its edges
//  FORUM-MEASURED, NOT VERIFIED ON JEFF'S TRUCK (EV Trek, Nov 2026):
//   - opening 13 7/8 x 5 1/4 in = 352.4 x 133.35 mm
//  ASSUMED (measure before printing; see README.md):
//   - insert_depth (room behind the dash face), dash_skin_t (thickness
//     of the dash skin the snap hooks catch behind), that the opening
//     is a clean rectangle with square-ish corners, and everything about
//     how the factory panel is retained
// =====================================================================

part = "assembly";

/* ---------- dash opening (FORUM, unverified) ---------- */
opening_w   = 352.4;   // mm, 13 7/8 in, forum-measured width of the large dash opening
opening_h   = 133.35;  // mm, 5 1/4 in, forum-measured height
fit_clear   = 0.5;     // mm per side, sleeve-to-opening clearance (raise if ASA shrinks less than you expect)
dash_skin_t = 3.0;     // ASSUMED mm, thickness of the dash skin around the opening (snap hooks catch behind it)

/* ---------- depth (UNKNOWN) ---------- */
insert_depth = 40;     // ASSUMED mm, dash face to back of rear cover; forum says "over 3 in" of room, unmeasured

/* ---------- display (VERIFIED, Waveshare drawing) ---------- */
panel_w     = 301.2;   // mm outline width
panel_h     = 123.35;  // mm outline height
panel_t     = 3.0;     // mm glass+LCD thickness at the edges
panel_total = 12.4;    // mm including driver board
aa_w        = 293.1;   // mm active area width
aa_h        = 110.2;   // mm active area height
aa_left     = 4.05;    // mm active area inset from the left/right ends
aa_bottom   = 10.0;    // mm active area inset from the bottom edge
board_u0    = 25.8;    // mm driver board connector edge, from panel left end (front view)
board_u1    = 112.3;   // mm driver board far edge
board_v0    = 27.35;   // mm driver board bottom edge, from panel bottom
board_v1    = 83.35;   // mm driver board top edge
conn_v      = [35.85, 53.35, 66.85, 78.35]; // HDMI, USB-C touch, USB-C power, 3.5 mm jack

/* ---------- placement of the panel in the opening ---------- */
panel_dx    = 0;       // mm shift of the panel right (+) in the opening; up to ~21 gives the cables more room on the left
panel_dy    = 0;       // mm shift up (+); -1.7 max down. 0 puts the picture 3.4 mm above centre (wide bottom border)
panel_clear = 0.4;     // mm per side around the glass in its pocket
window_grow = 0.5;     // mm the bezel window is larger than the active area on each side (+ shows a hairline of black)

/* ---------- bezel / sleeve ---------- */
flange_t       = 4.0;  // mm, bezel flange thickness, proud of the dash face
flange_overlap = 8.0;  // mm the flange laps over the dash beyond the opening on each side
flange_round   = 4.0;  // mm corner radius of the flange
window_chamfer = 2.5;  // mm 45 deg chamfer on the window's front edge (viewing angle)
wall           = 2.4;  // mm sleeve wall
split_x        = 0;    // mm, where the bezel is cut in two for the bed (the panel bridges the cut)
key_len        = 16;   // mm butterfly key length across the split
key_w_end      = 6;    // mm key end width
key_w_mid      = 3;    // mm key waist width
key_t          = 2.0;  // mm key thickness (pocket depth in the flange back)
key_clear      = 0.15; // mm key pocket clearance
tongue_t       = 1.6;  // mm tongue-and-groove on the flange split faces
tongue_d       = 3.0;  // mm how far the tongue reaches across the split
tongue_clear   = 0.2;  // mm groove clearance

/* ---------- retaining tabs (clamp the glass from behind) ---------- */
tab_y        = 42;     // mm +/- from panel centre; kept clear of the connector band at the left end
tab_boss_off = 6.5;    // mm from glass end to tab boss centre
tab_boss_d   = 8;      // mm
tab_foam     = 0.5;    // mm EVA/neoprene pad under each tab
tab_overlap  = 5;      // mm the tab reaches over the glass
tab_t        = 3;      // mm
tab_w        = 10;     // mm

/* ---------- heat-set inserts / screws ---------- */
m3_insert_d   = 4.0;   // mm hole for an M3 heat-set insert (check your insert's datasheet)
m3_insert_len = 4.5;   // mm insert length + a little
m3_clear_d    = 3.4;   // mm M3 clearance
m3_nut_af     = 5.5;   // mm M3 nut across flats
m3_head_d     = 6.0;   // mm M3 pan/socket head
boss_d        = 8;     // mm corner boss diameter

/* ---------- snap latches into the opening ---------- */
latch_x      = [-95, 95]; // mm positions on top and bottom walls (keep away from split_x)
latch_w      = 12;     // mm tongue width
latch_len    = 22;     // mm tongue length (along depth)
latch_slot   = 1.0;    // mm slot around the tongue
latch_hook_h = 1.2;    // mm hook protrusion outward
latch_ramp   = 6;      // mm ramp length (leading side)

/* ---------- vents in the sleeve top/bottom walls ---------- */
sleeve_vents  = true;
vent_w        = 3;     // mm
vent_pitch    = 10;    // mm
vent_z0       = 18;    // mm start of vents behind the dash face

/* ---------- rear cover ---------- */
cover_t        = 4;    // mm
cover_split_x  = 50;   // mm, deliberately NOT at split_x so the cover bridges the bezel joint
cover_lap      = 12;   // mm lap joint width between the cover halves
cover_lap_y    = [-40, 40]; // mm M3 bolts through the lap
spigot_t       = 1.6;  // mm locating lip that drops inside the sleeve
spigot_h       = 4;    // mm
spigot_clear   = 0.3;  // mm
cover_vent_w   = 3;    // mm slot width
cover_vent_l   = 40;   // mm slot length
cover_vent_px  = 8;    // mm slot pitch
cable_exit_x   = -135; // mm centre of the cable exit (cables leave the board to the LEFT)
cable_exit_y   = 0;
cable_exit_w   = 34;   // mm, passes an HDMI plug
cable_exit_h   = 16;   // mm
tie_bridge_w   = 5;    // mm zip-tie tunnel width
tie_bridge_h   = 3;    // mm zip-tie tunnel height
press_posts    = true; // posts from the cover that hold the panel back against the bezel
press_foam     = 3;    // mm foam pad thickness the post leaves room for
press_post_d   = 10;   // mm
press_uv       = [[140, 20], [140, 103], [230, 20], [230, 103], [285, 20], [285, 103]]; // panel u,v; clear of the driver board and its FPC

/* ---------- sun hood (detachable) ---------- */
hood_depth      = 60;  // mm how far the hood reaches forward
hood_tilt       = 8;   // deg the canopy slopes down toward the driver
hood_t          = 2.5; // mm canopy and cheek thickness
hood_side_front = 20;  // mm cheek height at the front tip
hood_pad_t      = 2.5; // mm pads that sit on the flange
hood_boss_xin   = 9.5; // mm hood screw from the sleeve inner end wall
hood_boss_y     = 50;  // mm +/- hood screw positions
hood_boss_len   = 8;   // mm boss length behind the flange
hood_splice_w   = 60;  // mm splice plate width
hood_splice_t   = 2.5; // mm

$fn = 40;
eps = 0.01;

/* ================= derived ================= */
sleeve_w = opening_w - 2*fit_clear;
sleeve_h = opening_h - 2*fit_clear;
flange_w = opening_w + 2*flange_overlap;
flange_h = opening_h + 2*flange_overlap;
in_w = sleeve_w - 2*wall;
in_h = sleeve_h - 2*wall;
sleeve_d = insert_depth - cover_t;          // sleeve runs Z 0..sleeve_d, cover sleeve_d..insert_depth

px0 = panel_dx - panel_w/2;                 // panel left edge x
py0 = panel_dy - panel_h/2;                 // panel bottom edge y
function pu(u) = px0 + u;
function pv(v) = py0 + v;

win_x0 = pu(aa_left) - window_grow;
win_x1 = pu(aa_left + aa_w) + window_grow;
win_y0 = pv(aa_bottom) - window_grow;
win_y1 = pv(aa_bottom + aa_h) + window_grow;

tab_bx = panel_w/2 + panel_clear + tab_boss_off;   // |x| of tab bosses (about panel centre)
corner_bx = in_w/2 - boss_d/2;
corner_by = in_h/2 - boss_d/2;
hood_bx = in_w/2 - hood_boss_xin;

assert(abs(panel_dy) + panel_h/2 + panel_clear < in_h/2, "panel does not fit the sleeve height");
assert(abs(panel_dx) + panel_w/2 + panel_clear + tab_boss_off + tab_boss_d/2 < in_w/2, "panel_dx too large for the tab bosses");
assert(insert_depth > panel_total + cover_t + 6, "insert_depth too small for the panel");

/* ================= helpers ================= */
module rrect(w, h, r, t) {   // rounded rectangle slab centred in XY, Z 0..t
    linear_extrude(t) offset(r) offset(-r) square([w, h], center = true);
}
module butterfly(l, we, wm, t) {
    linear_extrude(t) polygon([[-l/2, -we/2], [0, -wm/2], [l/2, -we/2],
                               [l/2, we/2], [0, wm/2], [-l/2, we/2]]);
}
key_ys = [ sleeve_h/2 + fit_clear + flange_overlap/2, -(sleeve_h/2 + fit_clear + flange_overlap/2) ];

/* ================= bezel + sleeve (one piece, split later) ================= */
module flange() {
    difference() {
        translate([0, 0, -flange_t]) rrect(flange_w, flange_h, flange_round, flange_t);
        // window with front chamfer
        hull() {
            translate([win_x0, win_y0, -flange_t + window_chamfer]) cube([win_x1 - win_x0, win_y1 - win_y0, flange_t]);
            translate([win_x0 - window_chamfer, win_y0 - window_chamfer, -flange_t - eps])
                cube([win_x1 - win_x0 + 2*window_chamfer, win_y1 - win_y0 + 2*window_chamfer, eps]);
        }
    }
}

module latch_cut(x, top) {      // U-slot freeing a tongue hinged at its rear end
    s = top ? 1 : -1;
    translate([x, s*(sleeve_h/2 - wall/2), 0]) {
        for (dx = [-latch_w/2 - latch_slot/2, latch_w/2 + latch_slot/2])
            translate([dx, 0, 1 + latch_len/2]) cube([latch_slot, wall + 1, latch_len], center = true);
        translate([0, 0, 1 + latch_slot/2]) cube([latch_w + 2*latch_slot, wall + 1, latch_slot], center = true);
    }
}
module latch_hook(x, top) {     // 45 deg catch face (prints without support flange-down) + leading ramp
    zc = dash_skin_t + 0.3;
    m = top ? [0, 0, 0] : [0, 1, 0];
    mirror(m) translate([x - latch_w/2, sleeve_h/2, 0])
        rotate([90, 0, 90]) linear_extrude(latch_w)
            polygon([[0, zc], [latch_hook_h, zc + latch_hook_h], [0, zc + latch_hook_h + latch_ramp]]);
}

module sleeve() {
    difference() {
        union() {
            difference() {
                translate([-sleeve_w/2, -sleeve_h/2, -eps]) cube([sleeve_w, sleeve_h, sleeve_d + eps]);
                translate([-in_w/2, -in_h/2, -1]) cube([in_w, in_h, sleeve_d + 2]);
            }
            // corner columns for the rear-cover screws
            for (sx = [-1, 1], sy = [-1, 1]) translate([sx*corner_bx, sy*corner_by, 0]) {
                cylinder(d = boss_d, h = sleeve_d);
                translate([sx > 0 ? 0 : -boss_d/2, sy > 0 ? 0 : -boss_d/2, 0]) cube([boss_d/2, boss_d/2, sleeve_d]);
            }
            // retaining-tab bosses
            for (sx = [-1, 1], sy = [-1, 1]) translate([panel_dx + sx*tab_bx, panel_dy + sy*tab_y, 0])
                cylinder(d = tab_boss_d, h = panel_t + tab_foam);
            // hood-screw bosses
            for (sx = [-1, 1], sy = [-1, 1]) translate([sx*hood_bx, sy*hood_boss_y, 0])
                cylinder(d = boss_d, h = hood_boss_len);
            // end stops locate the glass left/right
            for (sx = [-1, 1], sy = [-1, 1])
                translate([panel_dx + sx*(panel_w/2 + panel_clear + 1), panel_dy + sy*20, panel_t/2])
                    cube([2, 8, panel_t], center = true);
            // crush ribs locate the glass up/down
            for (x = [-120, -60, 60, 120]) {
                top_gap = in_h/2 - (panel_dy + panel_h/2 + panel_clear);
                bot_gap = in_h/2 + (panel_dy - panel_h/2 - panel_clear);
                translate([x - 1.5, in_h/2 - top_gap - eps, 0]) cube([3, top_gap + 2*eps, panel_t]);
                translate([x - 1.5, -in_h/2 - eps, 0]) cube([3, bot_gap + 2*eps, panel_t]);
            }
            for (x = latch_x) { latch_hook(x, true); latch_hook(x, false); }
        }
        // rear-cover inserts
        for (sx = [-1, 1], sy = [-1, 1]) translate([sx*corner_bx, sy*corner_by, sleeve_d - m3_insert_len - 1])
            cylinder(d = m3_insert_d, h = m3_insert_len + 2);
        // tab inserts, blind, stop 1.2 mm short of the bezel face
        for (sx = [-1, 1], sy = [-1, 1]) translate([panel_dx + sx*tab_bx, panel_dy + sy*tab_y, -flange_t + 1.2])
            cylinder(d = m3_insert_d, h = 20);
        for (x = latch_x) { latch_cut(x, true); latch_cut(x, false); }
        if (sleeve_vents) for (x = [-sleeve_w/2 + 30 : vent_pitch : sleeve_w/2 - 30])
            if (abs(x - split_x) > 6 && min([for (lx = latch_x) abs(x - lx)]) > latch_w/2 + 4)
                translate([x - vent_w/2, -sleeve_h/2 - 1, vent_z0]) cube([vent_w, sleeve_h + 2, sleeve_d - vent_z0 - 6]);
    }
}

module bezel_whole() {
    difference() {
        union() { flange(); sleeve(); }
        // hood inserts pressed in from the front face
        for (sx = [-1, 1], sy = [-1, 1]) translate([sx*hood_bx, sy*hood_boss_y, -flange_t - eps])
            cylinder(d = m3_insert_d, h = m3_insert_len + 1);
        // butterfly key pockets in the flange back, across the split
        for (y = key_ys) translate([split_x, y, -key_t])
            butterfly(key_len + 2*key_clear, key_w_end + 2*key_clear, key_w_mid + 2*key_clear, key_t + eps);
    }
}

// tongue lives on the left half's split face, in the flange only, outside the window
module tongue_region(grow) {
    for (r = [[win_y1 + 1, flange_h/2 - 1], [-flange_h/2 + 1, win_y0 - 1]])
        translate([split_x - eps, r[0] - grow, -flange_t/2 - tongue_t/2 - grow])
            cube([tongue_d + grow + eps, r[1] - r[0] + 2*grow, tongue_t + 2*grow]);
}
module bezel_left() {
    intersection() {
        bezel_whole();
        union() {
            translate([-1000 + split_x, -500, -500]) cube(1000);
            tongue_region(0);
        }
    }
}
module bezel_right() {
    difference() {
        intersection() { bezel_whole(); translate([split_x, -500, -500]) cube(1000); }
        tongue_region(tongue_clear);
    }
}

/* ================= retaining tab & key ================= */
module tab() {
    l = tab_boss_off + tab_overlap + tab_boss_d/2 + panel_clear;
    difference() {
        hull() {
            cylinder(d = tab_w, h = tab_t);
            translate([l - tab_w/2, -tab_w/2, 0]) cube([tab_w/2, tab_w, tab_t]);
        }
        translate([0, 0, -1]) cylinder(d = m3_clear_d, h = tab_t + 2);
    }
}
module key() { butterfly(key_len, key_w_end, key_w_mid, key_t - 0.2); }

/* ================= rear cover ================= */
cz0 = sleeve_d;  // inner face of the cover
module cover_whole() {
    difference() {
        union() {
            translate([-sleeve_w/2, -sleeve_h/2, cz0]) cube([sleeve_w, sleeve_h, cover_t]);
            // locating spigot along top and bottom, between the corner columns
            sx_lim = corner_bx - boss_d/2 - 1;
            for (s = [-1, 1]) translate([-sx_lim, s > 0 ? in_h/2 - spigot_clear - spigot_t : -in_h/2 + spigot_clear, cz0 - spigot_h])
                cube([2*sx_lim, spigot_t, spigot_h + eps]);
            if (press_posts) for (p = press_uv) translate([pu(p[0]), pv(p[1]), panel_t + press_foam])
                cylinder(d = press_post_d, h = cz0 - panel_t - press_foam + eps);
            // zip-tie bridges on the INSIDE face, below the cable exit: tie the cables here so a tug
            // pulls on the cover, not on the board's connectors
            for (dx = [-8, 8]) translate([cable_exit_x + dx, cable_exit_y - cable_exit_h/2 - 9, cz0 - tie_bridge_h - 2])
                difference() {
                    translate([-tie_bridge_w/2 - 2, -4, 0]) cube([tie_bridge_w + 4, 8, tie_bridge_h + 2 + eps]);
                    translate([-tie_bridge_w/2, -5, 2]) cube([tie_bridge_w, 10, tie_bridge_h + 1]);
                }
        }
        // screw holes into the corner inserts
        for (sx = [-1, 1], sy = [-1, 1]) translate([sx*corner_bx, sy*corner_by, cz0 - 1]) cylinder(d = m3_clear_d, h = cover_t + 2);
        // cable exit, rounded
        translate([cable_exit_x, cable_exit_y, cz0 - 1]) rrect(cable_exit_w, cable_exit_h, 4, cover_t + 2);
        // vent slots, kept off the edges, the lap, the posts and the cable exit
        for (x = [-sleeve_w/2 + 20 : cover_vent_px : sleeve_w/2 - 20], y = [-25, 25])
            if (abs(x - cover_split_x) > cover_lap/2 + 4
                && abs(x - cable_exit_x) > cable_exit_w/2 + 6
                && abs(x) < corner_bx - boss_d
                && min([for (p = press_uv) abs(x - pu(p[0]))]) > press_post_d/2 + 2)
                translate([x - cover_vent_w/2, y - cover_vent_l/2, cz0 - 1]) cube([cover_vent_w, cover_vent_l, cover_t + 2]);
        // lap bolts
        for (y = cover_lap_y) translate([cover_split_x, y, cz0 - 1]) cylinder(d = m3_clear_d, h = cover_t + 2);
    }
}
lap_c = 0.2;   // mm clearance at the ends of the lap
module cover_left() {   // keeps the inner half of the lap
    intersection() {
        cover_whole();
        union() {
            translate([-1000 + cover_split_x - cover_lap/2, -500, -500]) cube(1000);
            translate([cover_split_x - cover_lap/2 - eps, -500, -500]) cube([cover_lap - lap_c + eps, 1000, 500 + cz0 + cover_t/2]);
        }
    }
}
module cover_right() {  // keeps the outer half of the lap
    intersection() {
        cover_whole();
        union() {
            translate([cover_split_x + cover_lap/2, -500, -500]) cube(1000);
            translate([cover_split_x - cover_lap/2 + lap_c, -500, cz0 + cover_t/2]) cube([cover_lap - lap_c + eps, 1000, 500]);
        }
    }
}

/* ================= sun hood ================= */
hood_y_rear  = win_y1 + 3;                       // canopy rear edge, on the flange above the window
hood_L       = hood_depth / cos(hood_tilt);
hood_y_front = hood_y_rear - hood_depth * tan(hood_tilt);
hood_cheek_x = (win_x1 - win_x0)/2 + 1;           // cheek inner face, |x| about the window centre
hood_cx      = (win_x0 + win_x1)/2;
hood_pad_top = flange_h/2 - 1.5;
hood_cheek_bot = win_y0 - 1;
module canopy_frame() {   // local x across, local y forward along the canopy, local z up out of the canopy
    multmatrix([[1, 0, 0, 0],
                [0, -sin(hood_tilt), cos(hood_tilt), hood_y_rear],
                [0, -cos(hood_tilt), -sin(hood_tilt), -flange_t - hood_pad_t],
                [0, 0, 0, 1]]) children();
}
splice_holes = [for (x = [-20, 20], s = [0.3, 0.7]) [x, s]];
module hood_whole() {
    hw = hood_cheek_x + hood_t;
    difference() {
        union() {
            canopy_frame() translate([hood_cx - hw, -2, 0]) cube([2*hw, hood_L + 2, hood_t]);   // -2: buried in the pad, no edge-only contact
            // top pad on the flange
            translate([hood_cx - hw, win_y1 + 1, -flange_t - hood_pad_t]) cube([2*hw, hood_pad_top - win_y1 - 1, hood_pad_t]);
            for (s = [-1, 1]) {
                // cheek
                xc = hood_cx + s*(hood_cheek_x + hood_t/2) - hood_t/2;
                multmatrix([[0, 0, 1, xc], [0, 1, 0, 0], [1, 0, 0, 0], [0, 0, 0, 1]])
                    linear_extrude(hood_t) polygon([
                        [-flange_t - hood_pad_t + eps, hood_y_rear + hood_t],
                        [-flange_t - hood_pad_t + eps, hood_cheek_bot],
                        [-flange_t - hood_pad_t - hood_depth, hood_y_front - hood_side_front],
                        [-flange_t - hood_pad_t - hood_depth, hood_y_front + hood_t]]);
                // end pad carrying the screws
                x0 = s > 0 ? hood_cx + hood_cheek_x : -flange_w/2 + 1.5;
                x1 = s > 0 ? flange_w/2 - 1.5 : hood_cx - hood_cheek_x;
                translate([x0, hood_cheek_bot, -flange_t - hood_pad_t]) cube([x1 - x0, hood_pad_top - hood_cheek_bot, hood_pad_t]);
            }
        }
        for (sx = [-1, 1], sy = [-1, 1]) translate([sx*hood_bx, sy*hood_boss_y, -flange_t - hood_pad_t - 1])
            cylinder(d = m3_clear_d, h = hood_pad_t + 2);
        canopy_frame() for (h = splice_holes) translate([hood_cx + h[0], h[1]*hood_L, -1]) cylinder(d = m3_clear_d, h = hood_t + 2);
    }
}
module hood_left()  { intersection() { hood_whole(); translate([-1000 + hood_cx, -500, -500]) cube(1000); } }
module hood_right() { intersection() { hood_whole(); translate([hood_cx, -500, -500]) cube(1000); } }
module hood_splice() {  // flat plate bolted under the canopy across the split (M3 + nuts)
    difference() {
        translate([-hood_splice_w/2, 0.2*hood_L, -hood_splice_t]) cube([hood_splice_w, 0.6*hood_L, hood_splice_t]);
        for (h = splice_holes) translate([h[0], h[1]*hood_L, -hood_splice_t - 1]) cylinder(d = m3_clear_d, h = hood_splice_t + 2);
    }
}

/* ================= fit test: one bezel corner, short ================= */
module fit_test() {
    intersection() {
        bezel_left();
        translate([-flange_w/2 - 1, flange_h/2 - 70, -flange_t - 1]) cube([80, 71, flange_t + 1 + 12]);
    }
}

/* ================= output ================= */
module panel_dummy() {
    color("black") translate([px0, py0, 0]) cube([panel_w, panel_h, panel_t]);
    color("royalblue") translate([pu(board_u0), pv(board_v0), panel_t + 3.5]) cube([board_u1 - board_u0, board_v1 - board_v0, panel_total - panel_t - 3.5]);
}
// MODEL FRAME: X+ = right and Y+ = up as seen from the driver's seat, Z+ = INTO the dash.
// A viewer looking into +Z sees that frame mirror-imaged, so every output below
// is reflected once (mirror Z, or the equivalent rotate+mirror) to give the real part.
module print_bezel() translate([0, 0, flange_t]) mirror([0, 1, 0]) children();          // flange face on the bed
module print_cover() translate([0, 0, insert_depth]) mirror([0, 0, 1]) children();      // outside face on the bed
module print_hood()  translate([0, 0, -flange_t]) mirror([0, 0, 1]) children(); // pads on the bed

if (part == "assembly") rotate([90, 0, 0]) mirror([0, 0, 1]) {   // real handedness, upright, dash face toward -Y
    color("dimgray") bezel_left();
    color("gray") bezel_right();
    color("silver", 0.6) { cover_left(); cover_right(); }
    panel_dummy();
    color("darkslategray") hood_whole();
    color("orange") for (sx = [-1, 1], sy = [-1, 1])
        translate([panel_dx + sx*tab_bx, panel_dy + sy*tab_y, panel_t + tab_foam]) rotate([0, 0, sx > 0 ? 180 : 0]) tab();
    color("red") canopy_frame() translate([hood_cx, 0, 0]) hood_splice();
}
else if (part == "bezel_left")  print_bezel() bezel_left();
else if (part == "bezel_right") print_bezel() bezel_right();
else if (part == "cover_left")  print_cover() cover_left();
else if (part == "cover_right") print_cover() cover_right();
else if (part == "tab")         tab();
else if (part == "key")         key();
else if (part == "hood_left")   print_hood() hood_left();
else if (part == "hood_right")  print_hood() hood_right();
else if (part == "hood_splice") translate([0, 0, hood_splice_t]) hood_splice();
else if (part == "fit_test")    print_bezel() fit_test();
