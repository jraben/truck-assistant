// =====================================================================
// Slate Cockpit - brain enclosure
// Vented box for a Raspberry Pi 4 or 5 + a CarPiHAT-style car power HAT
// on top, with a bay beside it for a USB SSD (or an M.2-in-USB caddy).
// Mounting ears for the lower dash rail; glands/cutouts for 12 V, CAN,
// HDMI and USB.
//
// Parts: "assembly", "box", "lid"   (each emitted in print orientation)
// Frame: X along the Pi's long side (USB/Ethernet end at +X), Y across
//        (Pi's HDMI edge at -Y, SSD bay at +Y), Z up.
//
// WHERE THE NUMBERS COME FROM
//  STANDARD (Raspberry Pi mechanical drawings, Pi 4 B and Pi 5):
//   - board 85 x 56 x 1.6 mm, 4x M2.5 holes on 58 x 49 mm, 3.5 mm in
//     from the corners on the USB-C/HDMI-side end
//   - USB-A + Ethernet along the far short edge; USB-C and 2x micro-HDMI
//     along one long edge (USB-C ~11.2, HDMI ~26 and ~39.5 mm from the
//     corner); microSD on the near short edge
//   - HAT spec board 65 x 56 mm on the same hole pattern
//  ASSUMED - CHECK BEFORE PRINTING:
//   - stack height (stack_h): Pi 5 + active cooler + a HAT on ~16-18 mm
//     spacers + its screw terminals. Measure the assembled stack.
//   - the CarPiHAT's terminal positions (12 V in, CAN H/L): glands are
//     placed on the -X end above the SSD bay, away from the HAT edge
//   - SSD size (ssd_*): default is a Samsung T7-class drive, 85 x 57 x 8
//   - THE DASH RAIL IS UNMEASURED. The ears are plain slotted flanges for
//     whatever bolts or T-nuts the rail takes; nothing here models the rail.
// =====================================================================

part = "assembly";

/* ---------- Pi (standard) ---------- */
pi_l        = 85;      // mm
pi_w        = 56;      // mm
pi_t        = 1.6;     // mm
pi_holes    = [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]; // mm, 58 x 49 pattern
pi_x0       = 3;       // mm gap from the -X wall (the microSD card sticks out ~2.5 mm)
pi_y0       = 1.5;     // mm gap from the -Y wall (HDMI/USB-C edge)
standoff_h  = 6;       // mm floor to underside of the Pi
standoff_d  = 6.5;     // mm
m25_hole_d  = 3.6;     // mm M2.5 heat-set insert hole (2.2 for self-tapping screws instead)
m25_hole_h  = 5;       // mm

/* ---------- stack ---------- */
stack_h     = 38;      // ASSUMED mm, Pi underside to the top of the tallest HAT part; measure it
lid_clear   = 3;       // mm above the stack

/* ---------- SSD bay ---------- */
ssd_bay     = true;
ssd_l       = 85;      // mm Samsung T7: 85 x 57 x 8
ssd_w       = 57;      // mm
ssd_t       = 8;       // mm
ssd_clear   = 1;       // mm per side
ssd_gap     = 4;       // mm between the Pi and the bay (a strap passes here)
strap_slot  = [3, 22]; // mm floor slots for a velcro strap / zip tie over the SSD

/* ---------- box ---------- */
wall        = 2.5;     // mm
floor_t     = 2.5;     // mm
corner_r    = 3;       // mm outside corner radius
lug_d       = 9;       // mm outside corner columns carrying the lid screws
m3_insert_d = 4.0;     // mm M3 heat-set insert hole
m3_insert_h = 6;       // mm
m3_clear_d  = 3.4;     // mm
lid_t       = 2.5;     // mm
lid_lip     = 3;       // mm lip that drops inside the walls
lid_lip_t   = 1.6;     // mm
lid_lip_clear = 0.3;   // mm

/* ---------- cutouts ---------- */
usb_win     = [54, 17];   // mm (along Y, tall) window at +X for USB-A x2/x4 + Ethernet
hdmi_win_x  = [4, 49];    // mm along the Pi from its corner: USB-C + 2x micro-HDMI
hdmi_win_h  = 10;         // mm
sd_slot     = [14, 4];    // mm microSD access slot at -X
gland_d     = 12.5;       // mm PG7 / M12 cable gland hole (12 V, CAN, spare)
glands_x_end = [[78, 24], [100, 24]];  // [y, z] on the -X wall, above the SSD bay
glands_y_side = [[50, 24]];            // [x, z] on the +Y wall

/* ---------- vents and fan ---------- */
vent_w      = 2.5;     // mm slot width
vent_pitch  = 6;       // mm
fan         = true;    // 40 mm fan on the lid above the Pi
fan_size    = 40;      // mm
fan_holes   = 32;      // mm hole pitch
fan_screw_d = 3.4;     // mm (M3 or the fan's self-tappers)
fan_at      = [35, 28];// mm on the Pi, from its corner

/* ---------- logo on the lid ---------- */
logo        = true;    // engrave the Truck Assistant glyph and name in the lid's top face
logo_depth  = 0.6;     // mm (3 layers at 0.2); the top face prints on the bed, so no supports
logo_w      = 22;      // mm, the glyph beside the fan
logo_text   = "TRUCK ASSISTANT";
logo_font   = "Liberation Sans:style=Bold";
logo_text_h = 5;       // mm cap height, in the band between the vents and the fan

/* ---------- mounting ears (DASH RAIL UNMEASURED) ---------- */
ears        = true;
ear_len     = 18;      // mm beyond the box at each X end
ear_t       = 4;       // mm
ear_slot_d  = 6.6;     // mm 1/4-20 or M6 (T-track bolts are usually 1/4-20); 5.4 for M5
ear_slot_len= 8;       // mm slot length (along X) for adjustment
ear_hole_pitch = 70;   // mm between the two slots on each ear (along Y)

$fn = 40;
eps = 0.01;

/* ---------- derived ---------- */
in_l = max(pi_x0 + pi_l + 1, ssd_bay ? ssd_l + 2*ssd_clear + 2 : 0);
in_w = pi_y0 + pi_w + (ssd_bay ? ssd_gap + ssd_w + 2*ssd_clear + strap_slot[0] + 1.5 : 2);
in_h = standoff_h + stack_h + lid_clear;
out_l = in_l + 2*wall;
out_w = in_w + 2*wall;
out_h = floor_t + in_h;
pz = floor_t + standoff_h;                  // underside of the Pi
ssd_y0 = pi_y0 + pi_w + ssd_gap;            // bay start (inside coords)
ssd_x0 = (in_l - ssd_l) / 2 - ssd_clear;    // bay start along X, centred
function ix(x) = wall + x;                  // inside coords -> box coords
function iy(y) = wall + y;

module rbox(l, w, h, r) { translate([r, r, 0]) linear_extrude(h) offset(r) square([l - 2*r, w - 2*r]); }
lug_pos = [[0, 0], [out_l, 0], [0, out_w], [out_l, out_w]];

module box() {
    difference() {
        union() {
            rbox(out_l, out_w, out_h, corner_r);
            for (p = lug_pos) translate([p[0], p[1], 0]) cylinder(d = lug_d, h = out_h);
            if (ears) for (s = [0, 1]) translate([s ? out_l - eps : -ear_len, 0, 0]) {
                cube([ear_len + eps, out_w, ear_t]);
                // gussets
                for (y = [3, out_w - 3]) translate([0, y - 1.5, 0])   // at the edges, clear of the port windows
                    hull() {
                        translate([s ? 0 : ear_len - eps, 0, 0]) cube([eps, 3, ear_t + ear_len * 0.8]);
                        translate([s ? ear_len * 0.8 : ear_len * 0.2, 0, 0]) cube([eps, 3, ear_t]);
                    }
            }
        }
        // cavity
        translate([wall, wall, floor_t]) cube([in_l, in_w, in_h + 1]);
        // lid inserts in the lugs
        for (p = lug_pos) translate([p[0], p[1], out_h - m3_insert_h]) cylinder(d = m3_insert_d, h = m3_insert_h + 1);
        // USB / Ethernet window, +X wall
        translate([out_l - wall - 1, iy(pi_y0 + pi_w/2) - usb_win[0]/2, pz - 0.5]) cube([wall + 2, usb_win[0], usb_win[1]]);
        // USB-C + micro-HDMI window, -Y wall
        translate([ix(pi_x0 + hdmi_win_x[0]), -1, pz - 1]) cube([hdmi_win_x[1] - hdmi_win_x[0], wall + 2, hdmi_win_h + 1]);
        // microSD slot, -X wall
        translate([-1, iy(pi_y0 + pi_w/2) - sd_slot[0]/2, pz - sd_slot[1]/2 - 0.5]) cube([wall + 2, sd_slot[0], sd_slot[1] + 1]);
        // glands
        for (g = glands_x_end) translate([-1, iy(g[0]), g[1]]) rotate([0, 90, 0]) cylinder(d = gland_d, h = wall + 2);
        for (g = glands_y_side) translate([ix(g[0]), out_w - wall - 1, g[1]]) rotate([-90, 0, 0]) cylinder(d = gland_d, h = wall + 2);
        // floor vents under the Pi (clear of the standoffs)
        for (x = [ix(pi_x0 + 10) : vent_pitch : ix(pi_x0 + 56)]) translate([x, iy(pi_y0 + 9), -1]) cube([vent_w, 38, floor_t + 2]);
        // floor vents under the SSD, between the strap slots
        if (ssd_bay) for (x = [ix(20) : vent_pitch : ix(in_l - 22)]) translate([x, iy(ssd_y0 + 8), -1]) cube([vent_w, ssd_w - 14, floor_t + 2]);
        // strap slots either side of the SSD (a velcro strap or zip tie goes over it, across Y)
        if (ssd_bay) for (y = [ssd_y0 - strap_slot[0] - 0.2, ssd_y0 + ssd_w + 2*ssd_clear + 0.2])
            translate([ix(in_l/2 - strap_slot[1]/2), iy(y), -1]) cube([strap_slot[1], strap_slot[0], floor_t + 2]);
        // side vents high on the +Y wall and on the -Y wall past the HDMI window (hot air out)
        for (x = [ix(10) : vent_pitch : ix(in_l - 10)]) if (abs(x - ix(glands_y_side[0][0])) > gland_d/2 + 3)
            translate([x, out_w - wall - 1, out_h - 16]) cube([vent_w, wall + 2, 10]);
        for (x = [ix(pi_x0 + hdmi_win_x[1] + 6) : vent_pitch : ix(in_l - 6)])
            translate([x, -1, out_h - 16]) cube([vent_w, wall + 2, 10]);
        // ear slots
        if (ears) for (s = [0, 1], y = [out_w/2 - ear_hole_pitch/2, out_w/2 + ear_hole_pitch/2])
            translate([s ? out_l + ear_len/2 : -ear_len/2, y, -1]) hull()
                for (d = [-ear_slot_len/2, ear_slot_len/2]) translate([d, 0, 0]) cylinder(d = ear_slot_d, h = ear_t + 2);
    }
    // Pi standoffs
    for (h = pi_holes) translate([ix(pi_x0 + h[0]), iy(pi_y0 + h[1]), floor_t - eps]) difference() {
        cylinder(d = standoff_d, h = standoff_h + eps);
        translate([0, 0, standoff_h - m25_hole_h]) cylinder(d = m25_hole_d, h = m25_hole_h + 1);
    }
    // SSD corner guides
    if (ssd_bay) for (cx = [0, 1], cy = [0, 1]) {
        gx = cx ? ssd_x0 + ssd_l + 2*ssd_clear : ssd_x0 - 2;
        gy = cy ? ssd_y0 + ssd_w + 2*ssd_clear : ssd_y0 - 2;
        if (gx >= 0 && gx + 2 <= in_l) translate([ix(gx), iy(gy), floor_t - eps]) cube([2, 2, 5]);
    }
}

module lid() {
    difference() {
        union() {
            hull() {
                rbox(out_l, out_w, lid_t, corner_r);
                for (p = lug_pos) translate([p[0], p[1], 0]) cylinder(d = lug_d, h = lid_t);
            }
            // lip that drops inside the walls (lid is modelled upside down: lip on +Z)
            translate([wall + lid_lip_clear, wall + lid_lip_clear, lid_t - eps])
                difference() {
                    cube([in_l - 2*lid_lip_clear, in_w - 2*lid_lip_clear, lid_lip]);
                    translate([lid_lip_t, lid_lip_t, -1]) cube([in_l - 2*lid_lip_clear - 2*lid_lip_t, in_w - 2*lid_lip_clear - 2*lid_lip_t, lid_lip + 2]);
                }
        }
        for (p = lug_pos) translate([p[0], p[1], -1]) cylinder(d = m3_clear_d, h = lid_t + 2);
        // fan (lid is upside down here, so mirror the Pi's Y position)
        fy = out_w - iy(pi_y0 + fan_at[1]);
        fx = ix(pi_x0 + fan_at[0]);
        if (fan) translate([fx, fy, -1]) {
            difference() {
                cylinder(d = fan_size - 3, h = lid_t + 2);
                for (a = [45, 135]) rotate([0, 0, a]) cube([fan_size, 2, 2*lid_t + 4], center = true);   // finger guard
                cylinder(d = 10, h = lid_t + 2);
            }
            for (sx = [-1, 1], sy = [-1, 1]) translate([sx*fan_holes/2, sy*fan_holes/2, 0]) cylinder(d = fan_screw_d, h = lid_t + 2);
        }
        // lid vents over the SSD half
        if (ssd_bay) for (x = [ix(12) : vent_pitch : ix(in_l - 12)]) translate([x, out_w - iy(ssd_y0 + ssd_w - 6), -1]) cube([vent_w, ssd_w - 12, lid_t + 2]);
        if (!fan) for (x = [ix(pi_x0 + 8) : vent_pitch : ix(pi_x0 + 70)]) translate([x, out_w - iy(pi_y0 + 50), -1]) cube([vent_w, 44, lid_t + 2]);
        // the logo, engraved into the top face
        if (logo && fan) translate([0, 0, -1]) linear_extrude(logo_depth + 1) lid_logo_2d();
    }
}

/* ---------- the brand glyph (docs/brand/truck-assistant/logo-06-glyph.svg) ----------
   The truck's profile as one stroked line, and two wheel rings, on the SVG's
   512 grid. Drawn here because OpenSCAD's SVG import keeps fills, not strokes.
   Curves are cut to straight segments, which is plenty at 20-odd mm. */
glyph_path = [[60,324],[60,246],[232,246],[240,150],[244,142],[252,140],[316,140],[323,141],[328,146],[376,230],[440,240],[448,243],[452,254],[452,324]];
module glyph_2d(w) {
    s = w / 392;   // the drawing spans x 40..472 including strokes; 392 = 452-60 between line ends
    scale([s, -s]) translate([-256, -256]) {
        for (i = [0 : len(glyph_path) - 2]) hull() { translate(glyph_path[i]) circle(r = 20, $fn = 24); translate(glyph_path[i + 1]) circle(r = 20, $fn = 24); }
        for (cx = [150, 370]) translate([cx, 372]) difference() { circle(r = 44, $fn = 48); circle(r = 24, $fn = 48); }
    }
}

/* Where the logo goes, in the lid's frame (modelled upside down: top face at z = 0,
   so the artwork is mirrored in Y to read right once fitted). */
module lid_logo_2d() {
    fy = out_w - iy(pi_y0 + fan_at[1]);
    fx = ix(pi_x0 + fan_at[0]);
    vent_end = out_w - iy(ssd_y0 + ssd_w - 6) + (ssd_w - 12);   // the vents' edge nearest the fan
    band_y = (vent_end + (fy - fan_size / 2)) / 2;
    side_x = (fx + fan_size / 2 + out_l - wall) / 2;            // centred in the space beside the fan
    translate([side_x, fy]) mirror([0, 1, 0]) glyph_2d(logo_w);
    translate([out_l / 2, band_y]) mirror([0, 1, 0])
        text(logo_text, size = logo_text_h, font = logo_font, halign = "center", valign = "center", spacing = 1.05);
}

module pi_dummy() {
    color("green") translate([ix(pi_x0), iy(pi_y0), pz]) cube([pi_l, pi_w, pi_t]);
    color("darkgreen", 0.7) translate([ix(pi_x0), iy(pi_y0), pz + 18]) cube([65, pi_w, pi_t]);
    color("silver") translate([ix(pi_x0 + pi_l - 20), iy(pi_y0 + 2), pz + pi_t]) cube([22.5, 52, 14]);
    if (ssd_bay) color("dimgray") translate([ix(ssd_x0 + ssd_clear), iy(ssd_y0 + ssd_clear), floor_t]) cube([ssd_l, ssd_w, ssd_t]);
}

if (part == "assembly") {
    color("steelblue") box();
    pi_dummy();
    color("lightsteelblue", 0.5) translate([0, out_w, out_h + lid_t]) rotate([180, 0, 0]) lid();
}
else if (part == "box") box();
else if (part == "lid") lid();   // top face on the bed, lip up
