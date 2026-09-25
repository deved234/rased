# Contributing to RASED

RASED is a local Windows app that watches the public Mostaql RSS feed. Contributions are welcome, especially fixes to reliability, accessibility, Arabic/English UI, and tests.

1. Open an issue describing the change or bug. For small fixes, you can send a pull request directly.
2. Install Node.js 24, clone the repository, run `npm ci`, then `npm run dev`.
3. Before a pull request, run `npm run typecheck`, `npm run lint`, and `npm test`.
4. Keep the collector respectful of Mostaql: no login scraping, no bypassing protection, and always honor backoff and `Retry-After`.
5. Do not commit credentials, user databases, generated `out/` or `release/` files, or captured third-party pages.

The app is licensed under [MIT](LICENSE). By submitting a contribution, you agree that your contribution is licensed under the same terms.
