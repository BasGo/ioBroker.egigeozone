/**
 *
 * geofency adapter
 * This Adapter is based on the geofency adapter of ccu.io
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var url = require('url');

var webServer =  null;
var activate_server = false;

var adapter = utils.adapter({
    name: 'egigeozone',

    unload: function (callback) {
        try {
            adapter.log.info("Terminating HTTP" + (webServer.settings.secure ? "S" : "") + " server on port " + webServer.settings.port);
            callback();
        } catch (e) {
            callback();
        }
    },
    ready: function () {
        adapter.log.info("Adapter got 'ready' signal: calling main function ...");
        main();
    },
    message: function (msg) {
        processMessage(msg);
    }
});

function main() {
    checkCreateNewObjects();
    if (adapter.config.activate_server !== undefined) activate_server = adapter.config.activate_server;
        else activate_server = true;
    if (activate_server) {
        if (adapter.config.ssl) {
            // subscribe on changes of permissions
            adapter.subscribeForeignObjects('system.group.*');
            adapter.subscribeForeignObjects('system.user.*');

            if (!adapter.config.certPublic) {
                adapter.config.certPublic = 'defaultPublic';
            }
            if (!adapter.config.certPrivate) {
                adapter.config.certPrivate = 'defaultPrivate';
            }

            // Load certificates
            adapter.getForeignObject('system.certificates', function (err, obj) {
                if (err || !obj || !obj.native.certificates || !adapter.config.certPublic || !adapter.config.certPrivate || !obj.native.certificates[adapter.config.certPublic] || !obj.native.certificates[adapter.config.certPrivate]
                ) {
                    adapter.log.error('Cannot enable secure web server, because no certificates found: ' + adapter.config.certPublic + ', ' + adapter.config.certPrivate);
                } else {
                    adapter.config.certificates = {
                        key: obj.native.certificates[adapter.config.certPrivate],
                        cert: obj.native.certificates[adapter.config.certPublic]
                    };

                }
                webServer = initWebServer(adapter.config);
            });
        } else {
            webServer = initWebServer(adapter.config);
        }
    }
}

function initWebServer(settings) {

    var server = {
        server:    null,
        settings:  settings
    };

    if (settings.port) {
        if (settings.ssl) {
            if (!adapter.config.certificates) {
                return null;
            }
        }

        if (settings.ssl) {
            server.server = require('https').createServer(adapter.config.certificates, requestProcessor);
        } else {
            server.server = require('http').createServer(requestProcessor);
        }

        server.server.__server = server;
    } else {
        adapter.log.error('Port missing');
        process.exit(1);
    }

    if (server.server) {
        adapter.getPort(settings.port, function (port) {
            if (port != settings.port && !adapter.config.findNextPort) {
                adapter.log.error('Port ' + settings.port + ' already in use');
                process.exit(1);
            }
            server.server.listen(port);
            adapter.log.info('HTTP' + (settings.ssl ? 'S' : '') + ' server is listening on port ' + port);
        });
    }

    if (server.server) {
        return server;
    } else {
        return null;
    }
}

function requestProcessor(req, res) {
    var check_user = adapter.config.user;
    var check_pass = adapter.config.pass;
    if (check_user.length > 0 || check_pass.length > 0) {
        // If they pass in a basic auth credential it'll be in a header called "Authorization" (note NodeJS lowercases the names of headers in its request object)
        var auth = req.headers.authorization;  // auth is in base64(username:password)  so we need to decode the base64
        adapter.log.debug("Authorization header is: ", auth);

        var username = '';
        var password = '';
        var request_valid = true;
        if (auth) {
            var tmp = auth.split(' ');   // Split on a space, the original auth looks like  "Basic Y2hhcmxlczoxMjM0NQ==" and we need the 2nd part
            var buf = new Buffer(tmp[1], 'base64'); // create a buffer and tell it the data coming in is base64
            var plain_auth = buf.toString();        // read it back out as a string

            adapter.log.debug("Decoded authorization ", plain_auth);
            // At this point plain_auth = "username:password"
            var creds = plain_auth.split(':');      // split on a ':'
            username = creds[0];
            password = creds[1];
            if ((username != check_user) || (password != check_pass)) {
                adapter.log.warn("User credentials invalid");
                request_valid = false;
            }
        }
        else {
            adapter.log.warn("Authorization header missing but user/pass defined");
            request_valid = false;
        }
        if (!request_valid) {
            res.statusCode = 403;
            res.end();
            return;
        }
    }

    if (req.method === 'GET' && req.url.indexOf('name') !== -1 && req.url.indexOf('latitude') !== -1 && req.url.indexOf('longitude') !== -1) {
        adapter.log.debug("Received request: " + req.url);
        var parsedUrl = url.parse(req.url, true);
        var reqData = parsedUrl.query;

        adapter.log.debug("Analyzed request data: " + JSON.stringify(reqData));
        var user = parsedUrl.pathname.slice(1);
        handleRequest(user, reqData);

        res.writeHead(200);
        res.write("OK");
        res.end();
    } else {
        res.writeHead(500);
        res.write("Request error");
        res.end();
    }
}

var lastStateNames = ["lastLeave", "lastEnter"],
    stateAtHomeCount = "atHomeCount",
    stateAtHome = "atHome";

function handleRequest(userId, reqData) {
    if (adapter.config.ignoreLeaving && reqData.entry == "0") {
        adapter.log.debug("Ignoring leaving message (as configured)");
        return;
    }

    var msg = (reqData.entry == "1") ? "entered" : "left";
    adapter.log.info("Location changed: " + userId + " " +  msg + " " + reqData.name);

    // setting new values
    var locationName = reqData.name.replace(/\s|\./g, '_');
    
    // create user device (if not exists)
    adapter.getObject(userId, function (err, obj) {
        if (err || !obj) {
            adapter.log.debug("Creating device '" + userId + "'");
            adapter.setObjectNotExists(userId, {
                type: 'device',
                common: {id: userId, name: userId},
                native: {name: userId, device: reqData.device}
            });

            // create states
            createState(userId, "changed", "string");
            createState(userId, "location", "string");
            createState(userId, "lastLatitude", "string");
            createState(userId, "lastLongitude", "string");

            setStateValues(userId, reqData);
        } else if (!err && obj) {
            setStateValues(userId, reqData);
        }
    });
}

function setStateValues(userId, reqData) {
    var ts = adapter.formatDate(new Date(reqData.date), "YYYY-MM-DD hh:mm:ss");

    setValue(userId, 'changed', ts);
    if (reqData.entry == "1")
    {
        setValue(userId, 'location', reqData.name);
        setValue(userId, 'lastLatitude', reqData.latitude);
        setValue(userId, 'lastLongitude', reqData.longitude);
    } else {
        setValue(userId, 'location', "");
    }

    setAtHome(userId, reqData);
}

function setValue(id, name, value) {
    var stateId = id + "." + name;
    adapter.setState(stateId, {val: value, ack: true});
}

function createState(parentId, commonName, commonType) {
    var obj = {
        type: 'state',
        common: {name: commonName, read: true, write: true, type: commonType},
        native: {}
    };

    adapter.setObjectNotExists(parentId + "." + commonName, obj);
}

function setAtHome(userName, reqData) {
    if (reqData.name.trim().toLowerCase() !== adapter.config.atHome.trim().toLowerCase()) return;
    var atHomeCount, atHome;
    adapter.getState(stateAtHomeCount, function (err, obj) {
        if (err) return;
        atHomeCount = obj ? obj.val : 0;
        adapter.getState(stateAtHome, function (err, obj) {
            if (err) return;
            atHome = obj ? (obj.val ? JSON.parse(obj.val) : []) : [];
            var idx = atHome.indexOf(userName);
            if (reqData.entry === '1') {
                if (idx < 0) {
                    atHome.push(userName);
                    adapter.setState(stateAtHome, JSON.stringify(atHome), true);
                }
            } else {
                if (idx >= 0) {
                    atHome.splice(idx, 1);
                    adapter.setState(stateAtHome, JSON.stringify(atHome), true);
                }
            }
            if (atHomeCount !== atHome.length) adapter.setState(stateAtHomeCount, atHome.length, true);
        });
    });
}

function createAndSetObject(id, obj) {
    adapter.setObjectNotExists(id, obj, function (err) {
        adapter.setState(id, 0, true);
    });
}

function checkCreateNewObjects() {

    function doIt() {
        var fs = require('fs'),
            io = fs.readFileSync(__dirname + "/io-package.json"),
            objs = JSON.parse(io);

        for (var i = 0; i < objs.instanceObjects.length; i++) {
            createAndSetObject(objs.instanceObjects[i]._id, objs.instanceObjects[i]);
        }
    }

    var timer = setTimeout(doIt, 2000);
    adapter.getState(stateAtHome, function (err, obj) {
        clearTimeout(timer);
        if (!obj) {
            doIt();
        }
    });
}

function processMessage(message) {
    if (!message || !message.message.user || !message.message.data) return;

    adapter.log.info('Message received = ' + JSON.stringify(message));

    handleRequest(message.message.user, message.message.data);
}
