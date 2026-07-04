# Security Model

Hermes is a local agent-orchestration dashboard. It is designed to run on a
trusted machine (localhost / a private Docker network), not on the public
internet.

## What to know before exposing it

- **The API has no authentication.** Every endpoint under the backend
  (port 8010 by default) is open to anyone who can reach it. Do not bind it to a
  public interface or a shared host without putting an authenticating reverse
  proxy in front of it.
- **CORS is open (`*`).** Combined with the lack of auth, a web page in your
  browser can call the API on `localhost`. Credentials are disabled, so no
  cookies are sent, but state-changing requests still succeed. Keep the backend
  bound to localhost.
- **The `file_read` tool is sandboxed.** Reads are confined to the directory in
  `HERMES_FILE_READ_BASE` (default: the backend working directory). Absolute
  paths and `..` traversal outside that base are rejected. Point it only at a
  directory you are willing to expose to whoever can reach the API.

## Reporting

Open a private security advisory on the GitHub repository rather than a public
issue.
