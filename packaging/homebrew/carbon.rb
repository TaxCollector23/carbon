# Homebrew formula for the Carbon CLI (standalone binary, no Node required).
#
# Live in a tap, e.g. `brew install carbon-dev/carbon/carbon` after pushing this
# file to a repo named `homebrew-carbon`. The URL points at the GitHub Release
# produced by .github/workflows/release.yml; the SHA256 values must be updated
# on every release (`shasum -a 256` on each artifact in the release).
class Carbon < Formula
  desc "Stateful API replicas for development, tests, and CI"
  homepage "https://carbon-web-psi.vercel.app"
  version "0.2.1"
  license "Proprietary"

  on_macos do
    on_arm do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-darwin-arm64"
      sha256 "f639e506cbc68bcfb1200b067c23844e8bbfbbfb80ed1835338f29a36cb975a9"
    end
    on_intel do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-darwin-x64"
      sha256 "REPLACE_WITH_SHA256_OF_carbon-darwin-x64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-linux-arm64"
      sha256 "REPLACE_WITH_SHA256_OF_carbon-linux-arm64"
    end
    on_intel do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-linux-x64"
      sha256 "32e066e1ed8e4b7a99d0d565dcb777653dc3331246d77e02dc6069bb56b8bae7"
    end
  end

  def install
    bin.install Dir["carbon-*"].first => "carbon"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/carbon --version")
  end
end
