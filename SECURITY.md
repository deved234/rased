# Security policy

Security fixes target the latest release. Update RASED before reporting an issue.

Please do not put API keys, personal project notes, browser profiles or exploit details in public issues. Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/deved234/rased/security/advisories/new). If this option is unavailable, open an issue asking for a private reporting channel without disclosing the vulnerability.

Include the app version, Windows version, affected component, impact and minimal reproduction using synthetic data. Remove secrets from logs and screenshots. There is no guaranteed response-time SLA.

RASED encrypts AI keys with Windows-backed Electron safeStorage. It does not encrypt the entire local database, protect against malware running as your Windows user, or control third-party platform/provider security. See [Privacy](PRIVACY.md) and [Terms](TERMS.md).
