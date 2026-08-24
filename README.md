# tuiweather

Keyboard-driven terminal weather app. Dark Sky's nowcast precision, Carrot Weather's breadth of data — in your terminal, powered by [Open-Meteo](https://open-meteo.com).

> Work in progress. First release targets v0.1.0.

## Development

Requires [Bun](https://bun.sh) ≥ 1.3.

```sh
bun install
bun run dev        # run the TUI
bun run test       # unit + snapshot tests
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
```

See [AGENTS.md](AGENTS.md) for architecture and conventions.

## License

[MIT](LICENSE)

Weather data by [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
