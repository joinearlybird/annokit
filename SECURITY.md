# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it
privately through GitHub instead: on this repository, open **Security →
Report a vulnerability**. Only the maintainers can see the report. If you
cannot use GitHub, email **founders@joinearlybird.com**.

Include what you can of: the affected version, the configuration
(endpoint scheme, server flavor, platform), and a minimal reproduction.

We aim to acknowledge a report within 5 working days and to agree a fix
and disclosure date with you before anything is published.

## Supported versions

Before 1.0, only the latest published `0.x` release receives fixes.

## Scope

This package is a development-time overlay: it activates only under
`__DEV__`, and only when an endpoint is configured. In scope are defects
in this package that leak data the README says stays on the device, send
data or credentials to an origin other than the configured endpoint, or
let a server response crash or take over the host app.

The protocol server is out of scope here — its obligations are listed
under "Server obligations" in the README, and a server you run is yours
to secure. Known, tracked hardening items are in
[docs/audit](https://github.com/joinearlybird/annokit/blob/main/docs/audit/README.md).
