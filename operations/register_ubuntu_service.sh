#!/usr/bin/env bash
# Registers reeweb to restart after Ubuntu reboot using pm2 + systemd.
#   ./operations/register_ubuntu_service.sh             - install and start
#   ./operations/register_ubuntu_service.sh --uninstall - remove systemd unit and pm2 app
#
# pm2 starts the app now and saves the process list (pm2 save). "pm2 startup systemd"
# installs a pm2-$USER systemd unit that runs "pm2 resurrect" at boot (sudo prompt expected).
set -eu

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ecosystem_config="$project_root/operations/ecosystem.config.cjs"

if ! command -v pm2 >/dev/null 2>&1; then
	echo "pm2 not found on PATH. Install it first: npm install -g pm2" >&2
	exit 1
fi

node_bin_dir="$(dirname "$(command -v node)")"

if [ "${1:-}" = "--uninstall" ]; then
	sudo env PATH="$PATH:$node_bin_dir" "$(command -v pm2)" unstartup systemd -u "$USER" --hp "$HOME"
	pm2 delete reeweb || true
	pm2 save --force
	echo "reeweb removed from pm2 and systemd startup unregistered."
	exit 0
fi

pm2 startOrRestart "$ecosystem_config"
pm2 save

sudo env PATH="$PATH:$node_bin_dir" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME"

echo ""
echo "Done. reeweb is running under pm2 and will resurrect at boot."
echo "Check status:    pm2 status"
echo "Check the unit:  systemctl status pm2-$USER"
