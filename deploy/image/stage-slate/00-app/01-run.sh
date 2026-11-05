#!/bin/bash -e
# Bake the app into the image: the release tarball (brain + ui already built),
# Node 24, the brain/updater/kiosk units. The same files deploy/pi/install.sh
# installs, minus anything that needs a running system (that happens on first boot).
APP=/opt/slate-cockpit
install -d "${ROOTFS_DIR}${APP}"
tar xzf files/app.tar.gz -C "${ROOTFS_DIR}${APP}" --strip-components=1
install -m 0755 files/slate-firstboot.sh "${ROOTFS_DIR}/usr/local/sbin/slate-firstboot"
install -m 0644 files/slate-firstboot.service "${ROOTFS_DIR}/etc/systemd/system/slate-firstboot.service"
install -m 0755 files/chroot-setup.sh "${ROOTFS_DIR}/tmp/slate-chroot-setup.sh"

on_chroot << CHROOT
FIRST_USER_NAME="${FIRST_USER_NAME}" bash /tmp/slate-chroot-setup.sh
rm -f /tmp/slate-chroot-setup.sh
CHROOT
