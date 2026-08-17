[Unit]
Description=dsh-fleet frpc tunnel
After=network-online.target

[Service]
Type=simple
ExecStart=__FRPC_BIN__ -c __FRPC_CFG__
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
