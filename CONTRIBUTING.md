# Contributing

## Development

```bash
npm install
npm run all   # format, lint, unit tests, README target table, bundle dist/
```

- The action runs `dist/index.js`, which is committed. CI fails if it's out of
  date, so run `npm run all` (or `npm run bundle`) before committing.
- The list of targets lives in `src/targets.ts`. The table in `README.md` is
  generated from it by `npm run docs`.
- Unit tests (`__tests__/`) mock `@actions/*` and the host system. The
  End-to-end workflow (`.github/workflows/e2e.yml`) runs the action for real on
  every host, target and compiler, using the fixture project in `test/fixture/`.

## Running the End-to-end workflow locally

`npm run e2e:local` runs `.github/workflows/e2e.yml` with
[act](https://github.com/nektos/act), in Docker containers built from
`test/runner/Dockerfile` that stand in for GitHub's Ubuntu runners. `UBUNTU`
selects the hosts, and arguments are passed to act, e.g. to run a subset:

```bash
UBUNTU=24.04 npm run e2e:local -- --matrix target:mips64el-linux-gnuabi64
```

The whole workflow runs about 90 jobs and downloads the toolchains for each.

act handles some matrix layouts differently from GitHub, so in `e2e.yml` the
host (`ubuntu`) is always a base matrix key, and `include` rows only add keys to
existing combinations.

### Host setup

The host needs Docker, act, and QEMU binfmt_misc handlers with the `F` (fix
binary) flag. The handlers are global to the kernel, so they're shared by all
containers; the action checks them from within its privileged job container. On
Fedora:

```bash
sudo dnf install qemu-user-static
sudo systemctl restart systemd-binfmt
cat /proc/sys/fs/binfmt_misc/qemu-aarch64   # should show "flags: F"
```

On Debian and Ubuntu, install `qemu-user-static` (Ubuntu 24.04 and older) or
`qemu-user-binfmt` (newer releases) instead.

If a handler is missing, the action registers it from inside the job container.
That handler stays registered on the host until the next reboot.

To install act, download `act_Linux_x86_64.tar.gz` from
<https://github.com/nektos/act/releases> and put `act` in your `PATH`.
