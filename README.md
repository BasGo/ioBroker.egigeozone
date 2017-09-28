![Logo](admin/egigeozone.png)
# ioBroker.egigeozone

This is an ioBroker adapter for Android geofencing app "EgiGeoZone" ([website](https://egigeozone.de/)). It is able to receive geofence events as HTTP requests when entering or leaving a defined area with your mobile device. The implementation is mostly based on dschaedls [ioBroker.geofency](https://github.com/ioBroker/ioBroker.geofency) adapter.

# Contributors
https://github.com/ioBroker/ioBroker.geofency

# Security advice
It is not recommended to expose this adapter to the public internet (e.g. by opening the configured port in your router). This means that any request to this port will be forwarded to the ioBroker instance the adapter is running on. There are multiple options for gaining more security for accessing this adapter:
* Always use a VPN connection for requests or
* integrate a proxy server (e.g. nginx) for filtering incoming requests.

# Changelog

### 0.0.1
* (BasGo) Initial release

## License
This adapter is licensed under [the MIT license](../blob/master/LICENSE) which is part of this repository.
