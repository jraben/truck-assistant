#!/usr/bin/env bash
# Backup targets for the brain's nightly backup (Settings, Backups). Idempotent.
#   sudo ./deploy/pi/backup/setup-backup.sh nas //nas.local/slate-backups backupuser
#       SMB share mounted at /mnt/nas-backup (asks for the password once; kept
#       root-only in /etc/slate-cockpit/nas-credentials). Then pick "NAS share" with
#       folder /mnt/nas-backup in Settings.
#   sudo ./deploy/pi/backup/setup-backup.sh ssh-key
#       an SSH key for the slate user, for "rsync over SSH". Prints the public key:
#       add it to ~/.ssh/authorized_keys of the backup user on the NAS.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
DATA=/var/lib/slate-cockpit
MNT="${MNT:-/mnt/nas-backup}"

case "${1:-}" in
  nas)
    SHARE="${2:?usage: nas //host/share user}"; USER_="${3:?usage: nas //host/share user}"
    case "$SHARE" in //*/*) ;; *) echo "share looks like //nas.local/slate-backups"; exit 2 ;; esac
    apt-get install -y -qq cifs-utils >/dev/null
    install -d -m 0700 /etc/slate-cockpit
    CRED=/etc/slate-cockpit/nas-credentials
    if [ ! -f "$CRED" ] || [ "${RESET:-0}" = 1 ]; then
      read -r -s -p "Password for $USER_ on $SHARE: " PW; echo
      umask 077; printf 'username=%s\npassword=%s\n' "$USER_" "$PW" > "$CRED"
    fi
    install -d -m 0755 "$MNT"
    UID_=$(id -u slate); GID_=$(id -g slate)
    LINE="$SHARE $MNT cifs credentials=$CRED,uid=$UID_,gid=$GID_,file_mode=0600,dir_mode=0700,vers=3.0,nofail,_netdev,x-systemd.automount,x-systemd.mount-timeout=20 0 0"
    grep -v " $MNT cifs " /etc/fstab > /etc/fstab.slate.tmp || true
    echo "$LINE" >> /etc/fstab.slate.tmp && mv /etc/fstab.slate.tmp /etc/fstab
    systemctl daemon-reload
    mount "$MNT" 2>/dev/null || true
    if mountpoint -q "$MNT"; then echo "== $SHARE mounted at $MNT"; else echo "== added to /etc/fstab; it mounts when the truck is on home Wi-Fi ($SHARE unreachable now)"; fi
    systemctl restart slate-brain   # picks up ReadWritePaths for $MNT
    ;;
  ssh-key)
    install -d -o slate -g slate -m 0700 "$DATA/.ssh"
    [ -f "$DATA/.ssh/id_ed25519" ] || sudo -u slate ssh-keygen -q -t ed25519 -N '' -C "slate-cockpit-backup" -f "$DATA/.ssh/id_ed25519"
    echo "== public key (add to the NAS backup user's ~/.ssh/authorized_keys):"
    cat "$DATA/.ssh/id_ed25519.pub"
    echo "   In Settings, Backups: rsync over SSH, key $DATA/.ssh/id_ed25519"
    ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac
