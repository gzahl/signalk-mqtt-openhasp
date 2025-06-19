# SignalK MQTT OpenHASP Bridge

This SignalK plugin acts as a bridge between SignalK data and [OpenHASP](https://www.openhasp.com/) displays using MQTT. It allows you to visualize your boat's data on OpenHASP-compatible displays by automatically publishing SignalK values to MQTT topics that OpenHASP understands.

## Features

- Connects SignalK data to OpenHASP displays via MQTT
- Supports multiple OpenHASP nodes/displays
- Configurable update intervals for each data point
- Allows custom page configurations in JSONL format
- Secure MQTT connection support with optional certificate validation

## Installation

1. Install this plugin through the SignalK app store or manually:
   ```bash
   npm install signalk-mqtt-openhasp
   ```

## Configuration

The plugin requires the following configuration:

### MQTT Settings
- **MQTT Broker Address**: URL of your MQTT broker in the format `mqtt://user:pass@ip_or_host:1883`
- **Reject Unauthorized Certificates**: Enable/disable validation of SSL certificates (default: true)
- **Keepalive TTL**: Time in seconds between keepalive messages (default: 60)

### Node Configuration
For each OpenHASP display you want to connect, configure:

- **Node Name**: The name of your OpenHASP device (default: 'plate')
- **Pages**: OpenHASP page configuration in JSONL format
- **Paths**: Array of SignalK paths to monitor and send to the display
  - **Path**: The SignalK path to monitor (e.g., 'electrical.batteries.1.voltage')
  - **Keyword**: The OpenHASP object to update (e.g., 'p5b51.val')
  - **Interval**: Minimum time in seconds between updates

Example configuration:
```json
{
  "nodes": [
    {
      "nodename": "helm",
      "pages": "...",
      "paths": [
        {
          "path": "electrical.batteries.1.voltage",
          "keyword": "p5b51.val",
          "interval": 2
        }
      ]
    }
  ]
}
```

## MQTT Topics

The plugin publishes to the following MQTT topics:
- `hasp/<nodename>/command`: Used to send page configurations and value updates

## Requirements

- MQTT broker
- OpenHASP-compatible display

## Acknowledments

Thanks two these two MQTT signalk-server plugins, which i have used as a base for this plugin:

- https://github.com/iuriaranda/signalk-mqtt-bridge
- https://github.com/tkurki/signalk-mqtt-gw

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Author

Manuel Jung <manuel.jung@hotmail.com>
