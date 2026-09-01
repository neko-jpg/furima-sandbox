# Third-Party Notices

Furima Sandbox contains limited implementation patterns and runtime
dependencies used by the listing photo assistant. The application keeps the
camera, session state, image composition, and provider safety boundaries in
this repository; these notices do not grant permission to use any trademark.

## document-autocapture patterns

- Source: <https://github.com/maazkhan77/document-autocapture>
- Referenced commit: `e24df25d17ddc4cf7d7944c653bd0fba55025452`
- Usage: limited camera lifecycle, raw frame capture, grayscale/brightness/
  Laplacian quality checks, and frame scheduling patterns.

### MIT License

Copyright (c) 2026 Maaz Khan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## LiveKit

The following pinned packages are used only for the camera transport, short-
lived token boundary, and Python Agent lifecycle. API keys and secrets are
server-only and are not included in this notice or a browser response.

| Package | Version | Source | License/notice |
| --- | --- | --- | --- |
| `livekit-client` | `2.22.1` | <https://github.com/livekit/client-sdk-js> | Apache-2.0; see <https://github.com/livekit/client-sdk-js/blob/v2.22.1/NOTICE> |
| `livekit` | `1.1.15` | <https://github.com/livekit/python-sdks> | Apache-2.0; see <https://github.com/livekit/python-sdks/blob/rtc-v1.1.15/NOTICE> |
| `livekit-api` | `1.2.1` | <https://github.com/livekit/python-sdks> | Apache-2.0; see <https://github.com/livekit/python-sdks/blob/api-v1.2.1/NOTICE> |
| `livekit-agents` | `1.7.1` | <https://github.com/livekit/agents> | Apache-2.0; see <https://github.com/livekit/agents/blob/livekit-agents@1.7.1/NOTICE> |

The applicable Apache notice is:

```text
Copyright 2021 LiveKit, Inc. (livekit-client)
Copyright 2023 LiveKit, Inc. (livekit, livekit-api, livekit-agents)

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

Full Apache License text: <https://www.apache.org/licenses/LICENSE-2.0>.

## rembg and BiRefNet

The live Compose profile pins `docker.io/danielgatis/rembg:2.0.81` and uses
the `birefnet-general-lite` model through the private rembg sidecar. The
sidecar is not published to a host port. Before enabling the live profile,
verify the image, model, license, and model checksum from the distribution
metadata; fixture mode never downloads or calls this dependency.

## OpenCV.js boundary

The browser measurement implementation is deliberately behind a dedicated
Worker boundary and uses the pinned npm distribution below. The generated
Vite module is a local ESM shim around the package's UMD/Emscripten runtime;
the WASM payload remains bundled with that package and is not fetched from a
floating CDN at runtime.

| Package | Version | Source/distribution | SHA-256 of bundled `dist/opencv.js` | License/notice |
| --- | --- | --- | --- | --- |
| `@techstark/opencv-js` | `4.12.0-release.1` | <https://github.com/TechStark/opencv-js>; upstream OpenCV.js distribution <https://docs.opencv.org/4.12.0/opencv.js> | `BD0C3E6448043DE04F6A64A12CB7B759F78C3AB8F7C35C9F2E0F71C88BB17103` | Apache-2.0; see the package `LICENSE` and <https://opencv.org/license/> |

The application loads this dependency only from
`app/features/guided-capture/measurement/markerWorker.ts`. It validates the
known marker locally, returns finite failure codes, and falls back to the
bounded deterministic detector when the runtime cannot initialize. Before a
production dependency refresh, recompute the checksum from the lockfile's
installed package and update this table in the same change. No API token,
image, Blob, or Data URL belongs in this notice.
