# gta6-twitch-ccu-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/OhhRayy/gta6-twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/OhhRayy/gta6-twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts GTA VI's launch-day Twitch viewers hour by hour (hours 2–24, five quantiles each). For each comparable past launch it takes the release-day hourly viewers divided by that launch's hour-1 print, giving a log-ratio curve. The forecast centre is the scale-weighted median of those curves, replaced by a scale-trend prediction (big launches decay from hour 1, small ones ramp — the trend is fitted per hour and matters most for a mega-launch), blended 60% toward console-only launches; only the kit's clean "comparable" tier is used, and rolling-midnight launches keep full weight while other unlock kinds keep 0.3. The spread is the scale-weighted interquartile range. Practice loss 0.1676 versus v1's 0.2061 and the house baseline's 0.3871 on the kit's four practice launches (leave-one-case-out cross-validation of the whole selection: 0.1748 vs 0.2061 — practice pays nothing and is no guide to the final).

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=output node main.ts
```

Requires Node 22. Reads every `<id>.in` case in the input directory and writes `<id>.out` with 23 rows (hours 2–24).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
