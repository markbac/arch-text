# Releasing

A release is a version tag. [.github/workflows/release.yml](../.github/workflows/release.yml) then:

1. checks the tag matches `version` in `package.json`, and runs lint, typecheck, the build and every test;
1. packs `arch-text-<version>.tgz` (with `SHA256SUMS`), installs it globally and renders every example with it;
1. publishes a GitHub release with both files and generated notes;
1. builds the Docker image from the same source, renders every example with it offline as another user (`scripts/docker-check.sh`), and pushes it to `ghcr.io/markbac/arch-text` as `<version>`, `<major>.<minor>` and `latest`. A pre-release such as `0.2.0-rc.1` gets only its own tag.

## Steps

```bash
git switch main && git pull
npm version 0.2.0 --no-git-tag-version   # or edit package.json and package-lock.json
git commit -am "Release 0.2.0"
git push
git tag v0.2.0 && git push origin v0.2.0
```

Docs repositories pin the action and the image together (`markbac/arch-text@v0.2.0` runs `ghcr.io/markbac/arch-text:0.2.0`), so the tag and the image must both exist before anyone uses the new version.

Running the workflow by hand (Actions, Release, Run workflow) does everything except publish: a dry run.

## The first release

GHCR creates the `arch-text` package on the first push. Check under the repository's Packages that it is **public**, and change its visibility if not: docs repositories pull the image without logging in.
