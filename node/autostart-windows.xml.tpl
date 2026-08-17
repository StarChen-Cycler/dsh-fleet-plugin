<service>
  <id>dsh-fleet-frpc</id>
  <name>dsh-fleet frpc tunnel</name>
  <description>Keeps this machine reachable through its dsh-fleet hub.</description>
  <executable>__FRPC_BIN__</executable>
  <arguments>-c "__FRPC_CFG__"</arguments>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <logpath>__FLEET_DIR__/logs</logpath>
  <onfailure action="restart" delay="5 sec" />
</service>
