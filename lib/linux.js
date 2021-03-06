// Generated by CoffeeScript 2.2.1
(function() {
  var connectionStateMap, parsePatterns, powerStateMap;

  parsePatterns = {
    nmcli_line: new RegExp(/([^:]+):\s+(.+)/)
  };

  connectionStateMap = {
    connected: "connected", // Win32 & Linux
    disconnected: "disconnected", // Win32 & Linux
    connecting: "connecting" // Linux
  };

  powerStateMap = {
    enabled: true, // linux
    disabled: false // linux
  };

  module.exports = {
    autoFindInterface: function() {
      var _iface, _interface, _interfaceLine, _msg, findInterfaceCom, parsedLine;
      this.WiFiLog("Host machine is Linux.");
      // On linux, we use the results of `nmcli device status` and parse for
      // active `wlan*` interfaces.
      findInterfaceCom = "nmcli -m multiline dev status | grep -B 1 -w ' wifi' | head -n 1";
      this.WiFiLog(`Executing: ${findInterfaceCom}`);
      _interfaceLine = this.execSync(findInterfaceCom);
      parsedLine = parsePatterns.nmcli_line.exec(_interfaceLine.trim());
      _interface = parsedLine[2];
      if (_interface) {
        _iface = _interface.trim();
        _msg = `Automatically located wireless interface ${_iface}.`;
        this.WiFiLog(_msg);
        return {
          success: true,
          msg: _msg,
          interface: _iface
        };
      } else {
        _msg = "Error: No network interface found.";
        this.WiFiLog(_msg, true);
        return {
          success: false,
          msg: _msg,
          interface: null
        };
      }
    },
    
    // For Linux, parse nmcli to acquire networking interface data.

    getIfaceState: function() {
      var KEY, VALUE, connectionData, connectionName, error, foundInterface, i, interfaceState, k, len, ln, parsedLine, powerData, ref, ssidData;
      interfaceState = {};
      
      // (1) Get Interface Power State

      powerData = this.execSync("nmcli networking");
      interfaceState.power = powerStateMap[powerData.trim()];
      if (interfaceState.power) {
        
        // (2) First, we get connection name & state

        foundInterface = false;
        connectionData = this.execSync("nmcli -m multiline device status");
        connectionName = null;
        ref = connectionData.split('\n');
        for (k = i = 0, len = ref.length; i < len; k = ++i) {
          ln = ref[k];
          try {
            parsedLine = parsePatterns.nmcli_line.exec(ln.trim());
            KEY = parsedLine[1];
            VALUE = parsedLine[2];
            if (VALUE === "--") {
              VALUE = null;
            }
          } catch (error1) {
            error = error1;
            continue; // this line was not a key: value pair!
          }
          switch (KEY) {
            case "DEVICE":
              if (VALUE === this.WiFiControlSettings.iface) {
                foundInterface = true;
              }
              break;
            case "STATE":
              if (foundInterface) {
                interfaceState.connection = connectionStateMap[VALUE];
              }
              break;
            case "CONNECTION":
              if (foundInterface) {
                connectionName = VALUE;
              }
          }
          if (KEY === "CONNECTION" && foundInterface) { // we have everything we need!
            break;
          }
        }
        // If we didn't find anything...
        if (!foundInterface) {
          return {
            success: false,
            msg: `Unable to retrieve state of network interface ${this.WiFiControlSettings.iface}.`
          };
        }
        if (connectionName) {
          try {
            
            // (3) Next, we get the actual SSID

            ssidData = this.execSync(`nmcli -m multiline connection show "${connectionName}" | grep 802-11-wireless.ssid`);
            parsedLine = parsePatterns.nmcli_line.exec(ssidData.trim());
            interfaceState.ssid = parsedLine[2];
          } catch (error1) {
            error = error1;
            return {
              success: false,
              msg: `Error while retrieving SSID information of network interface ${this.WiFiControlSettings.iface}: ${error.stderr}`
            };
          }
        } else {
          interfaceState.ssid = null;
        }
      } else {
        interfaceState.connection = connectionStateMap[VALUE];
        interfaceState.ssid = null;
      }
      return interfaceState;
    },
    
    // We leverage nmcli to scan nearby APs in Linux

    scanForWiFi: function() {
      var KEY, VALUE, _network, c, error, i, j, k, len, len1, ln, networks, nwk, parsedLine, ref, ref1, scanResults;
      
      // Use nmcli to list visible wifi networks.

      scanResults = this.execSync(`nmcli -m multiline device wifi list ifname ${this.WiFiControlSettings.iface}`);
      
      // Parse the results into an array of AP objects to match
      // the structure found in node-wifiscanner2 for win32 and MacOS.

      networks = [];
      ref = scanResults.split('\nSSID:');
      for (c = i = 0, len = ref.length; i < len; c = ++i) {
        nwk = ref[c];
        if (c !== 0) {
          nwk = `SSID:${nwk}`;
        }
        _network = {};
        ref1 = nwk.split('\n');
        for (k = j = 0, len1 = ref1.length; j < len1; k = ++j) {
          ln = ref1[k];
          try {
            parsedLine = parsePatterns.nmcli_line.exec(ln.trim());
            KEY = parsedLine[1];
            VALUE = parsedLine[2];
          } catch (error1) {
            error = error1;
            continue; // this line was not a key: value pair!
          }
          switch (KEY) {
            case "SSID":
              _network.ssid = String(VALUE);
              break;
            case "CHAN":
              _network.channel = String(VALUE);
              break;
            case "SIGNAL":
              _network.signal_level = String(VALUE);
              break;
            case "SECURITY":
              _network.security = String(VALUE);
          }
        }
        if (_network.ssid !== "--") {
          networks.push(_network);
        }
      }
      return networks;
    },
    
    // With Linux, we can use nmcli to do the heavy lifting.

    connectToAP: function(_ap) {
      var COMMANDS, _msg, com, connectToAPChain, error, i, len, ssidExist, stdout;
      
      // (1) Does a connection that matches the name of the ssid
      //     already exist?

      COMMANDS = {
        delete: `nmcli connection delete "${_ap.ssid}"`,
        connect: `nmcli device wifi connect "${_ap.ssid}"`
      };
      if (_ap.password.length) {
        COMMANDS.connect += ` password "${_ap.password}"`;
      }
      try {
        stdout = this.execSync(`nmcli connection show "${_ap.ssid}"`);
        if (stdout.length) {
          ssidExist = true;
        }
      } catch (error1) {
        error = error1;
        ssidExist = false;
      }
      
      // (2) Delete the old connection, if there is one.
      //     Then, create a new connection.

      connectToAPChain = [];
      if (ssidExist) {
        this.WiFiLog("It appears there is already a connection for this SSID.");
        connectToAPChain.push("delete");
      }
      connectToAPChain.push("connect");

// (3) Connect to AP using using the above constructed
//     command chain.

      for (i = 0, len = connectToAPChain.length; i < len; i++) {
        com = connectToAPChain[i];
        this.WiFiLog(`Executing:\t${COMMANDS[com]}`);
        try {
          
          // Run the command, handle any errors that get thrown.

          stdout = this.execSync(COMMANDS[com]);
        } catch (error1) {
          error = error1;
          if (error.stderr.toString().trim() === `Error: No network with SSID '${_ap.ssid}' found.`) {
            _msg = `Error: No network called ${_ap.ssid} could be found.`;
            this.WiFiLog(_msg, true);
            return {
              success: false,
              msg: _msg
            };
          } else if (error.stderr.toString().search(/Error:/ !== -1)) {
            _msg = error.stderr.toString().trim();
            this.WiFiLog(_msg, true);
            return {
              success: false,
              msg: _msg
            };
          }
          // Ignore nmcli's add/modify errors, this is a system bug
          if (!/nmcli device wifi connect/.test(COMMANDS[com])) {
            this.WiFiLog(error, true);
            return {
              success: false,
              msg: error
            };
          }
        }
        
        // Otherwise, so far so good!

        this.WiFiLog("Success!");
      }
    },
    
    // With Linux, we just restart the network-manager, which will
    // immediately force its own preferences and defaults.

    resetWiFi: function() {
      var COMMANDS, _msg, com, i, len, resetWiFiChain, results, stdout;
      
      // (1) Construct a chain of commands to restart
      //     the Network Manager service

      COMMANDS = {
        disableNetworking: "nmcli networking off",
        enableNetworking: "nmcli networking on"
      };
      resetWiFiChain = ["disableNetworking", "enableNetworking"];

// (2) Execute each command.

      results = [];
      for (i = 0, len = resetWiFiChain.length; i < len; i++) {
        com = resetWiFiChain[i];
        this.WiFiLog(`Executing:\t${COMMANDS[com]}`);
        stdout = this.execSync(COMMANDS[com]);
        _msg = "Success!";
        results.push(this.WiFiLog(_msg));
      }
      return results;
    }
  };

}).call(this);
