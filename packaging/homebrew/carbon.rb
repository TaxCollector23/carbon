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
      sha256 "930ff82e0286a342495e5b62cf6c0207a48a420055a90b398b99b0218bf36c90"
    end
    on_intel do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-darwin-x64"
      sha256 "ba0a50c379c023051e6d7bb87697a0375e126eab8dd1dd104fc280ad0eaf325c"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-linux-arm64"
      sha256 "ae928af16ba3ec52404f50ed1474dcd270f78180e588cd4d85cb8ffd9e987f73"
    end
    on_intel do
      url "https://github.com/TaxCollector23/carbon/releases/download/v0.2.1/carbon-linux-x64"
      sha256 "922cec7096dfada7e393e73f11fd4927d115d9113adeed8d8ca7a2830f74ef27"
    end
  end

  def install
    bin.install Dir["carbon-*"].first => "carbon"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/carbon --version")
  end
end
