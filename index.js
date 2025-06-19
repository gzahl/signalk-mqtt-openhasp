const mqtt = require('mqtt');
const _ = require('underscore');

module.exports = function (app) {
  var plugin = {};

  plugin.id = 'signalk-mqtt-openhasp';
  plugin.name = 'Bridge between SignalK and OpenHASP using MQTT';
  plugin.description = 'SignalK Node server plugin that acts as a bridge between SignalK data and OpenHASP using MQTT';

  // Infer system id
  // If mmsi is set, this will match the mmsi
  // If mmsi is not set, this will be the last segment of the generated uuid
  plugin.systemId = app.selfId === undefined ? undefined : app.selfId.split(':').pop().split('-').pop();

  plugin.schema = {
    title: 'SignalK <> OpenHASP Bridge',
    type: 'object',
    required: ['mqttBrokerAddress'],
    description: `SignalK will use system id ${plugin.systemId} to interact with MQTT`,
    properties: {
      mqttBrokerAddress: {
        type: "string",
        title: "MQTT broker address to connect to. Format: mqtt://user:pass@ip_or_host:1883"
      },
      rejectUnauthorized: {
        type: 'boolean',
        title: 'Reject self signed and invalid server certificates',
        default: true
      },
      keepaliveTtl: {
        type: 'number',
        title: 'TTL of the MQTT keepalive in seconds',
        default: 60
      },
      nodes: {
        type: 'array',
        title: 'Signal K self paths to send to OpenHASP',
        items: {
          type: 'object',
          properties: {
            nodename: {
              type: 'string',
              title: 'OpenHASP node name to use for this path',
              default: 'plate',
            },
            pages: {
              type: 'string',
              title: 'OpenHASP pages to send to this node in jsonl format',
            },
            paths: {
              type: 'array',
              title: 'Signal K self paths to send to OpenHASP',
              default: [{ path: 'electrical.batteries.1.voltage', interval: 2, keyword: 'p5b51.val' }],
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    title: 'Signalk path',
                  },
                  keyword: {
                    type: 'string',
                    title: 'OpenHASP keyword to use for this path',
                  },
                  interval: {
                    type: 'number',
                    title: 'Minimum interval between updates for this path to be sent to the server',
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  // Functions to call when the plugin stops
  plugin.onStop = [];

  // Delta subscriptions from MQTT
  plugin.subscriptions = [];

  plugin.start = function (options, restartPlugin) {
    app.debug('Plugin starting');

    if (plugin.systemId === undefined) {
      var uuidErrorMessage = 'Please configure either an UUID or MMSI in SignalK server settings to use this plugin';
      app.error(uuidErrorMessage);
      app.setPluginError(uuidErrorMessage);
      return;
    }

    plugin.keepaliveTtl = parseInt(options.keepaliveTtl) || plugin.schema.properties.keepaliveTtl.default;

    // Initialize delta subscriptions
    plugin.subscriptions = [];

    // Connect to mqtt broker
    plugin.client = mqtt.connect(options.mqttBrokerAddress, {
      rejectUnauthorized: Boolean(options.rejectUnauthorized),
      reconnectPeriod: 5000,
      clientId: 'signalk/' + plugin.systemId,
    });

    // Handle graceful stop
    plugin.onStop.push(_ => plugin.client.end());

    // Handle errors
    plugin.client.on('error', (err) => {
      app.error(`Error connecting to MQTT broker: ${err}`);
      app.setPluginError(`Error connecting to MQTT broker: ${err}`);
    });

    // Start bridge when MQTT client is connected
    plugin.client.on('connect', () => {
      app.debug('MQTT connected');
      app.setPluginStatus('MQTT Connected');
      sendPagess(options);
      startSending(options, plugin.onStop);
    });

    plugin.client.on('close', () => {
      app.debug('MQTT connection closed');
      app.setPluginError('MQTT connection closed');
    });

    // Handle incoming MQTT messages
    plugin.client.on('message', onMessage);

    // Remove stale subscriptions each second
    if (plugin.expireSubscriptionsInterval === undefined) {
      plugin.expireSubscriptionsInterval = setInterval(expireSubscriptions, 1000);
      plugin.onStop.push(() => {
        clearInterval(plugin.expireSubscriptionsInterval);
        plugin.expireSubscriptionsInterval = undefined;
      });
    }
  };

  // Handle plugin stop
  plugin.stop = function () {
    plugin.onStop.forEach(f => f());
    plugin.onStop = [];

    app.debug('Plugin stopped');
  };

  function sendPagess(options) {
    options.nodes.forEach(haspNode => {
      publishMqtt(
        'hasp/' + haspNode.nodename + '/command',
        'jsonl ' + haspNode.pages,
        {
          qos: 1,
          retain: true
        }
      )
    });

  }

  function startSending(options, onStop) {
    options.nodes.forEach(haspNode => {
      haspNode.paths.forEach(haspPath => {
        onStop.push(
          app.streambundle
            .getSelfBus(haspPath.path)
            .debounceImmediate(haspPath.interval * 1000)
            .onValue(normalizedPathValue => {
              publishMqtt(
                'hasp/' + haspNode.nodename + '/command',
                haspPath.keyword + '=' + normalizedPathValue.value,
                {
                  qos: 1,
                  retain: true
                }
              )
            })
        );
      });
    });
  }

  // Handle incomming MQTT messages
  function onMessage(topic, messageBuffer) {
    var message = messageBuffer.toString().trim();

    app.debug('Received message to topic ' + topic + ': ' + message);

    var topicParts = topic.split('/');
    var action = topicParts[0];
    var signalk = topicParts[1];
    var systemId = topicParts[2];
    var subTopic = topicParts.slice(3).join('/');

    if (signalk != 'signalk' || systemId != plugin.systemId) {
      app.debug('Unknown system id ' + systemId + '. Ignoring');
      return;
    }

    switch (action) {
      /*
      case 'R':
        if (subTopic == 'keepalive') {
          handleKeepalive(message);
        } else {
          handleRead(subTopic);
        }
        break;
      case 'W':
        handleWrite(subTopic, message);
        break;
      case 'P':
        handlePut(subTopic, message);
        break;
      */
      default:
        app.debug('Unknown action ' + action + '. Ignoring');
        break;
    }
  }


  // Expire subscriptions
  function expireSubscriptions() {
    // Iterate from the back of the array so i keeps being valid
    for (var i = plugin.subscriptions.length - 1; i > -1; i--) {
      if (plugin.subscriptions[i].expires < getNow()) {
        app.debug('Expiring subscription to topic ' + plugin.subscriptions[i].topic);
        plugin.subscriptions.splice(i, 1);
      }
    }
  }

  // Gets the current timestamp in seconds
  function getNow() {
    return Math.floor(Date.now() / 1000);
  }

  // Publish MQTT message only if broker is connected, drop it otherwise
  function publishMqtt(topic, message, options = {}) {
    if (plugin.client.connected) {
      plugin.client.publish(topic, message, options);
    }
  }

  return plugin;
};
