<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.dsh-fleet.frpc</string>
  <key>ProgramArguments</key>
  <array>
    <string>__FRPC_BIN__</string>
    <string>-c</string>
    <string>__FRPC_CFG__</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>__FLEET_DIR__/frpc.log</string>
  <key>StandardErrorPath</key>
  <string>__FLEET_DIR__/frpc.log</string>
</dict>
</plist>
