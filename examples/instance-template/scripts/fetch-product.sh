#!/usr/bin/env bash
# Downloads the Origo Map Stories release pinned in product.version, verifies
# its sha256 (against PRODUCT_SHA256, the release's .sha256 file and the
# SHA256SUMS inside the zip) and unpacks it into .product/<version>/.
#
#   scripts/fetch-product.sh                  download with the GitHub CLI (gh)
#   scripts/fetch-product.sh --bundle <zip>   use a zip downloaded by hand
#   scripts/fetch-product.sh --out <dir>      unpack somewhere else than .product/
#
# Needs: bash, unzip, sha256sum (or shasum), and gh unless --bundle is given.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/product.version"
BUNDLE=""
OUT_DIR="$ROOT/.product"
DEFAULT_REPO="Sundsvallskommun/origo-map-stories"

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

die() {
  echo "fetch-product: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) [ $# -ge 2 ] || die "--bundle needs a path"; BUNDLE="$2"; shift 2 ;;
    --out) [ $# -ge 2 ] || die "--out needs a path"; OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown argument: $1" ;;
  esac
done

[ -f "$VERSION_FILE" ] || die "missing $VERSION_FILE"

# Value of NAME=value in product.version (last one wins), without whitespace.
read_setting() {
  local value
  value="$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$VERSION_FILE" | tail -n 1 || true)"
  value="${value#*=}"
  printf '%s' "$value" | tr -d '[:space:]'
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "neither sha256sum nor shasum is installed"
  fi
}

# Checks a sha256sum-format list in the current directory.
check_sums() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check --quiet "$1"
  else
    shasum -a 256 --check --quiet "$1"
  fi
}

TAG="$(read_setting PRODUCT_VERSION)"
EXPECTED="$(read_setting PRODUCT_SHA256 | tr 'A-F' 'a-f')"
REPO="$(read_setting PRODUCT_REPO)"
REPO="${REPO:-$DEFAULT_REPO}"

[ -n "$TAG" ] || die "PRODUCT_VERSION is not set in product.version"
case "$TAG" in
  v[0-9]*) ;;
  *) die "PRODUCT_VERSION must be a release tag such as v1.0.0, got '$TAG'" ;;
esac
VERSION="${TAG#v}"
ZIP_NAME="origo-map-stories-$VERSION.zip"
DOWNLOAD_DIR="$OUT_DIR/downloads"
ZIP="$DOWNLOAD_DIR/$ZIP_NAME"
mkdir -p "$DOWNLOAD_DIR"

if [ -n "$BUNDLE" ]; then
  [ -f "$BUNDLE" ] || die "bundle not found: $BUNDLE"
  if [ "$(basename "$BUNDLE")" != "$ZIP_NAME" ]; then
    echo "fetch-product: warning: $(basename "$BUNDLE") is not named $ZIP_NAME; the checksum decides" >&2
  fi
  cp "$BUNDLE" "$ZIP"
  rm -f "$ZIP.sha256"
  if [ -f "$BUNDLE.sha256" ]; then
    cp "$BUNDLE.sha256" "$ZIP.sha256"
  fi
else
  command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed; download the release by hand and use --bundle <zip>"
  echo "Downloading $TAG from $REPO ..."
  gh release download "$TAG" -R "$REPO" -p 'origo-map-stories-*.zip*' -D "$DOWNLOAD_DIR" --clobber
fi

[ -f "$ZIP" ] || die "$ZIP_NAME was not found in the release $TAG"

ACTUAL="$(sha256_of "$ZIP")"

if [ -f "$ZIP.sha256" ]; then
  PUBLISHED="$(awk 'NR==1 {print $1}' "$ZIP.sha256" | tr 'A-F' 'a-f')"
  [ "$PUBLISHED" = "$ACTUAL" ] || die "$ZIP_NAME does not match its .sha256 file (download corrupt?)"
fi

if [ -z "$EXPECTED" ]; then
  echo "fetch-product: PRODUCT_SHA256 is not set in product.version." >&2
  echo "  sha256 of $ZIP_NAME: $ACTUAL" >&2
  echo "  Compare it with the .sha256 file on the release page of $TAG, then pin it:" >&2
  echo "  PRODUCT_SHA256=$ACTUAL" >&2
  exit 1
fi
[ "$EXPECTED" = "$ACTUAL" ] || die "sha256 mismatch for $ZIP_NAME: expected $EXPECTED, got $ACTUAL"

command -v unzip >/dev/null 2>&1 || die "unzip is not installed"
DEST="$OUT_DIR/$VERSION"
rm -rf "$DEST"
mkdir -p "$DEST"
# Exit code 1 is a warning only (e.g. a zip written with backslash paths);
# the SHA256SUMS check below catches anything that did not unpack correctly.
unzip_status=0
unzip -q "$ZIP" -d "$DEST" || unzip_status=$?
[ "$unzip_status" -le 1 ] || die "unzip failed (exit code $unzip_status)"

[ -f "$DEST/VERSION" ] || die "the zip has no VERSION file; is it an Origo Map Stories release?"
PACKAGED_VERSION="$(tr -d '[:space:]' < "$DEST/VERSION")"
[ "$PACKAGED_VERSION" = "$VERSION" ] || die "the zip contains version $PACKAGED_VERSION, product.version pins $VERSION"

if [ -f "$DEST/SHA256SUMS" ]; then
  (cd "$DEST" && check_sums SHA256SUMS) || die "SHA256SUMS check failed inside the zip"
else
  die "the zip has no SHA256SUMS file"
fi

BUILD_SHA="$(tr -d '[:space:]' < "$DEST/BUILD_SHA" 2>/dev/null || echo unknown)"
echo "Origo Map Stories $VERSION (commit $BUILD_SHA) verified and unpacked:"
echo "  $DEST"
