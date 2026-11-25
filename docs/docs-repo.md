# Diagrams in a docs repository

Keep each diagram as an `.archt` file, commit its SVG beside it so Markdown can show it, and let CI keep the two in step. [examples/docs-repo](../examples/docs-repo/) is a complete small example.

```text
docs/
  architecture/
    platform.archt     # the source: edit this
    platform.svg       # the drawing: generated, committed
  index.md             # ![The platform](architecture/platform.svg)
.github/workflows/
  diagrams.yml
```

## The workflow

```yaml
name: Diagrams

on:
  push:
    branches: [main]
  pull_request:

jobs:
  diagrams:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: markbac/arch-text@v0.1.0
        with:
          mode: ${{ github.event_name == 'push' && 'commit' || 'check' }}
```

On a push to `main` it regenerates every diagram and commits any that changed, as `github-actions[bot]`. A push made with the workflow's own token does not start another run, so this does not loop. On a pull request it fails if any diagram is missing or out of date, and lists them in the job summary.

The action runs the arch-text Docker image from GHCR with no network. `markbac/arch-text@v0.1.0` uses `ghcr.io/markbac/arch-text:0.1.0`, so pinning the action pins the renderer too. It needs a Linux runner.

### Inputs

| Input | Default | Meaning |
|---|---|---|
| `mode` | `check` | `check`: fail if any output is missing or out of date, writing nothing. `write`: regenerate, leaving the files for later steps. `commit`: regenerate, then commit and push what changed. |
| `paths` | `*.archt` | Git pathspecs, one per line, choosing which files to render; `*.archt` matches in every folder. Tracked files and untracked ones that are not ignored count; only `.archt` files are used. |
| `formats` | `svg` | Outputs beside each `.archt` file, from `svg`, `png` and `excalidraw`, separated by commas. |
| `args` | | More `arch-text render` options, such as `--scale 2` or `--dark`. |
| `working-directory` | `.` | The folder to search and render in. |
| `image` | the action's version | The image to run, for a fork or a locally built image. |
| `commit-message` | `Regenerate architecture diagrams` | The commit message in `commit` mode. |

Outputs: `changed` is `true` when anything was missing or out of date, and `files` lists the `.archt` files rendered.

### Which mode

- **Commit on `main`, check on pull requests** (above) suits most repositories: authors edit only `.archt` files, and nothing out of date is ever merged unnoticed.
- **Check everywhere** suits a protected `main` where CI must not push: authors run `arch-text render` themselves and commit the SVGs.
- `commit` on a pull request pushes to its branch, which works for branches in the same repository (check out `${{ github.head_ref }}` first) but not for forks.

## SVG, PNG and the same output everywhere

`render` writes an output only when its bytes change, and `--check` compares bytes, so the outputs must come out identically wherever they are made:

- **SVG and `.excalidraw`** are identical on every platform: the build is deterministic and the SVG carries its fonts. An author on Windows or macOS can render locally and CI will agree.
- **PNG** is identical between runs of the same image, but not across platforms, because each platform's Chromium rasterises text slightly differently. If you commit PNGs, make them with the image, locally too, or let CI make them in `commit` mode.

## Rendering locally

With the image, exactly as CI does:

```bash
docker run --rm --network none --user "$(id -u):$(id -g)" -v "$PWD:/work" \
  ghcr.io/markbac/arch-text:0.1.0 render "docs/**/*.archt"
```

Or with arch-text installed from a release (see the [README](../README.md#install)):

```bash
arch-text render "docs/**/*.archt"            # write what changed
arch-text render "docs/**/*.archt" --check    # what CI checks
```

## Without the action

The action is a thin wrapper around the image, so any CI system can do the same:

```bash
git ls-files '*.archt' | xargs docker run --rm --network none \
  --user "$(id -u):$(id -g)" -v "$PWD:/work" ghcr.io/markbac/arch-text:0.1.0 render --check
```
