#!/usr/bin/env python3
"""
Patch live-vlm-webui static index to prefer RTSP input by default.
"""
from __future__ import annotations

import argparse
from pathlib import Path


TARGET = Path("/app/src/live_vlm_webui/static/index.html")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    if old not in content:
        if new in content:
            return content
        raise RuntimeError(f"patch anchor missing: {label}")
    return content.replace(old, new, 1)


def replace_optional(content: str, old: str, new: str) -> tuple[str, bool]:
    if old not in content:
        return content, False
    return content.replace(old, new, 1), True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-source", default="rtsp")
    parser.add_argument("--rtsp-url", default="rtsp://realsense-rtsp:8554/d435i")
    parser.add_argument("--api-base", default="http://llama-cpp:8080/v1")
    args = parser.parse_args()

    if not TARGET.exists():
        raise FileNotFoundError(f"target file not found: {TARGET}")

    content = TARGET.read_text(encoding="utf-8")
    default_constants = (
        "        let markdownEnabled = localStorage.getItem('markdownEnabled') !== 'false';\n"
        f"        const DEFAULT_INPUT_SOURCE = '{args.input_source}';\n"
        f"        const DEFAULT_RTSP_URL = '{args.rtsp_url}';\n"
        f"        const DEFAULT_API_BASE = '{args.api_base}';\n"
        "        const XSYNC_KEY = 'xcloud.live_vlm.sync';\n"
        "        const XSYNC_SENDER = crypto.randomUUID ? crypto.randomUUID() : 'sync-' + Date.now() + '-' + Math.random().toString(36).slice(2);\n"
        "        let isApplyingExternalSync = false;\n"
    )
    content = replace_once(
        content,
        "        let markdownEnabled = localStorage.getItem('markdownEnabled') !== 'false';\n",
        default_constants,
        "default constants",
    )

    content = replace_once(
        content,
        "            const inputSource = activeTab ? activeTab.getAttribute('data-source') : 'webcam';",
        "            const inputSource = activeTab ? activeTab.getAttribute('data-source') : DEFAULT_INPUT_SOURCE;",
        "start fallback source",
    )

    # Force cloud default API endpoint strings to local llama-cpp endpoint.
    content = content.replace("https://integrate.api.nvidia.com/v1", args.api_base)
    content = content.replace("http://localhost:11434/v1", args.api_base)

    tab_webcam_block = (
        "                if (source === 'webcam') {\n"
        "                    webcamControls.style.display = 'block';\n"
        "                    rtspControls.style.display = 'none';\n"
        "                    rtspBetaWarning.style.display = 'none';\n"
        "                } else if (source === 'rtsp') {\n"
    )
    tab_webcam_block_new = (
        "                if (source === 'webcam') {\n"
        "                    webcamControls.style.display = 'block';\n"
        "                    rtspControls.style.display = 'none';\n"
        "                    rtspBetaWarning.style.display = 'none';\n"
        "                    enumerateCameras();\n"
        "                } else if (source === 'rtsp') {\n"
    )
    content = replace_once(content, tab_webcam_block, tab_webcam_block_new, "tab webcam block")

    sync_helper_anchor = "        // Tooltip positioning (for fixed position tooltips)\n"
    sync_helper_block = (
        "        // === xCloud 極簡結果同步（監聽 WebSocket 並把 VLM 結果存到 localStorage）===\n"
        "        (function() {\n"
        "          const originalWebSocket = window.WebSocket;\n"
        "          window.WebSocket = function(...args) {\n"
        "            const ws = new originalWebSocket(...args);\n"
        "            ws.addEventListener('message', function(event) {\n"
        "              try {\n"
        "                const data = JSON.parse(event.data);\n"
        "                let result = null;\n"
        "\n"
        "                if (data.choices?.[0]?.message?.content) {\n"
        "                  result = data.choices[0].message.content;\n"
        "                } else if (data.content) {\n"
        "                  result = data.content;\n"
        "                } else if (data.result || data.analysis) {\n"
        "                  result = data.result || data.analysis;\n"
        "                }\n"
        "\n"
        "                if (result) {\n"
        "                  const payload = typeof result === 'string' ? { raw_text: result } : result;\n"
        "                  const message = {\n"
        "                    type: 'VLM_ANALYSIS_RESULT',\n"
        "                    payload: payload,\n"
        "                    timestamp: new Date().toISOString()\n"
        "                  };\n"
        "                  localStorage.setItem('xcloud.live_vlm.latest_result', JSON.stringify(message));\n"
        "                }\n"
        "              } catch (e) {}\n"
        "            });\n"
        "            return ws;\n"
        "          };\n"
        "        })();\n"
        "\n"
        "        function getActiveInputSource() {\n"
        "            const activeTab = document.querySelector('.input-source-tab.active');\n"
        "            return activeTab ? activeTab.getAttribute('data-source') : DEFAULT_INPUT_SOURCE;\n"
        "        }\n"
        "\n"
        "        function publishSyncState(overrides = {}) {\n"
        "            if (isApplyingExternalSync) {\n"
        "                return;\n"
        "            }\n"
        "            try {\n"
        "                const rtspInput = document.getElementById('rtspUrl');\n"
        "                const payload = {\n"
        "                    sender: XSYNC_SENDER,\n"
        "                    ts: Date.now(),\n"
        "                    running: isAnalysisRunning,\n"
        "                    source: getActiveInputSource(),\n"
        "                    rtspUrl: rtspInput ? rtspInput.value.trim() : '',\n"
        "                    ...overrides,\n"
        "                };\n"
        "                localStorage.setItem(XSYNC_KEY, JSON.stringify(payload));\n"
        "            } catch (err) {\n"
        "                console.warn('Failed to publish sync state:', err);\n"
        "            }\n"
        "        }\n"
        "\n"
        "        async function applyExternalSyncState(rawState) {\n"
        "            if (!rawState) {\n"
        "                return;\n"
        "            }\n"
        "            let incoming;\n"
        "            try {\n"
        "                incoming = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;\n"
        "            } catch (err) {\n"
        "                console.warn('Invalid sync state payload:', err);\n"
        "                return;\n"
        "            }\n"
        "            if (!incoming || incoming.sender === XSYNC_SENDER) {\n"
        "                return;\n"
        "            }\n"
        "\n"
        "            isApplyingExternalSync = true;\n"
        "            try {\n"
        "                const webcamTab = document.querySelector('.input-source-tab[data-source=\"webcam\"]');\n"
        "                const rtspTab = document.querySelector('.input-source-tab[data-source=\"rtsp\"]');\n"
        "                const rtspUrlInputEl = document.getElementById('rtspUrl');\n"
        "                if (incoming.source === 'rtsp' && rtspTab) {\n"
        "                    if (!rtspTab.classList.contains('active')) {\n"
        "                        rtspTab.click();\n"
        "                    }\n"
        "                    if (rtspUrlInputEl && incoming.rtspUrl && rtspUrlInputEl.value.trim() !== incoming.rtspUrl) {\n"
        "                        rtspUrlInputEl.value = incoming.rtspUrl;\n"
        "                        rtspUrlInputEl.classList.add('applied');\n"
        "                        setTimeout(() => rtspUrlInputEl.classList.remove('applied'), 600);\n"
        "                    }\n"
        "                } else if (incoming.source === 'webcam' && webcamTab) {\n"
        "                    if (!webcamTab.classList.contains('active')) {\n"
        "                        webcamTab.click();\n"
        "                    }\n"
        "                }\n"
        "\n"
        "                if (incoming.running && !isAnalysisRunning) {\n"
        "                    await start();\n"
        "                } else if (!incoming.running && isAnalysisRunning) {\n"
        "                    await stop();\n"
        "                }\n"
        "            } catch (err) {\n"
        "                console.warn('Failed to apply sync state:', err);\n"
        "            } finally {\n"
        "                isApplyingExternalSync = false;\n"
        "            }\n"
        "        }\n"
        "\n"
        "        window.addEventListener('storage', (event) => {\n"
        "            if (event.key !== XSYNC_KEY || !event.newValue) {\n"
        "                return;\n"
        "            }\n"
        "            applyExternalSyncState(event.newValue);\n"
        "        });\n"
        "\n"
    )
    content = replace_once(
        content,
        sync_helper_anchor,
        sync_helper_block + sync_helper_anchor,
        "sync helper block",
    )

    tab_click_sync_anchor = (
        "                } else if (source === 'rtsp') {\n"
        "                    webcamControls.style.display = 'none';\n"
        "                    rtspControls.style.display = 'block';\n"
        "                    rtspBetaWarning.style.display = 'flex';\n"
        "                }\n"
        "            });\n"
        "        });\n"
    )
    tab_click_sync_new = (
        "                } else if (source === 'rtsp') {\n"
        "                    webcamControls.style.display = 'none';\n"
        "                    rtspControls.style.display = 'block';\n"
        "                    rtspBetaWarning.style.display = 'flex';\n"
        "                }\n"
        "                publishSyncState({ source });\n"
        "            });\n"
        "        });\n"
    )
    content = replace_once(content, tab_click_sync_anchor, tab_click_sync_new, "tab click sync")

    rtsp_blur_anchor = (
        "        rtspUrlInput.addEventListener('blur', () => {\n"
        "            if (rtspUrlInput.value.trim()) {\n"
        "                rtspUrlInput.classList.add('applied');\n"
        "                setTimeout(() => {\n"
        "                    rtspUrlInput.classList.remove('applied');\n"
        "                }, 600);\n"
        "            }\n"
        "        });\n"
    )
    rtsp_blur_new = (
        "        rtspUrlInput.addEventListener('blur', () => {\n"
        "            if (rtspUrlInput.value.trim()) {\n"
        "                rtspUrlInput.classList.add('applied');\n"
        "                setTimeout(() => {\n"
        "                    rtspUrlInput.classList.remove('applied');\n"
        "                }, 600);\n"
        "            }\n"
        "            publishSyncState({ rtspUrl: rtspUrlInput.value.trim() });\n"
        "        });\n"
    )
    content = replace_once(content, rtsp_blur_anchor, rtsp_blur_new, "rtsp blur sync")

    api_base_anchor = "        const apiBaseUrl = document.getElementById('apiBaseUrl');\n"
    api_base_new = (
        "        const apiBaseUrl = document.getElementById('apiBaseUrl');\n"
        "        (function forceDefaultApiBase() {\n"
        "            if (!apiBaseUrl || !DEFAULT_API_BASE) {\n"
        "                return;\n"
        "            }\n"
        "            const knownBad = ['integrate.api.nvidia.com', 'localhost:11434'];\n"
        "            const current = (apiBaseUrl.value || '').trim();\n"
        "            if (!current || knownBad.some((token) => current.includes(token))) {\n"
        "                apiBaseUrl.value = DEFAULT_API_BASE;\n"
        "            }\n"
        "            const candidateKeys = [\n"
        "                'apiBaseUrl',\n"
        "                'api_base',\n"
        "                'vlm_api_base',\n"
        "                'live_vlm_api_base',\n"
        "            ];\n"
        "            candidateKeys.forEach((k) => {\n"
        "                try {\n"
        "                    const v = localStorage.getItem(k);\n"
        "                    if (!v || knownBad.some((token) => v.includes(token))) {\n"
        "                        localStorage.setItem(k, DEFAULT_API_BASE);\n"
        "                    }\n"
        "                } catch (_) {}\n"
        "            });\n"
        "        })();\n"
    )
    content, api_base_replaced = replace_optional(content, api_base_anchor, api_base_new)
    if not api_base_replaced:
        api_base_fallback_anchor = "        // Auto-apply API settings when API Base URL changes\n"
        api_base_inject_block = (
            "        const apiBaseUrl = document.getElementById('apiBaseUrl');\n"
            "        (function forceDefaultApiBase() {\n"
            "            if (!apiBaseUrl || !DEFAULT_API_BASE) {\n"
            "                return;\n"
            "            }\n"
            "            const knownBad = ['integrate.api.nvidia.com', 'localhost:11434'];\n"
            "            const current = (apiBaseUrl.value || '').trim();\n"
            "            if (!current || knownBad.some((token) => current.includes(token))) {\n"
            "                apiBaseUrl.value = DEFAULT_API_BASE;\n"
            "            }\n"
            "            const candidateKeys = [\n"
            "                'apiBaseUrl',\n"
            "                'api_base',\n"
            "                'vlm_api_base',\n"
            "                'live_vlm_api_base',\n"
            "            ];\n"
            "            candidateKeys.forEach((k) => {\n"
            "                try {\n"
            "                    const v = localStorage.getItem(k);\n"
            "                    if (!v || knownBad.some((token) => v.includes(token))) {\n"
            "                        localStorage.setItem(k, DEFAULT_API_BASE);\n"
            "                    }\n"
            "                } catch (_) {}\n"
            "            });\n"
            "        })();\n"
            "\n"
        )
        content = replace_once(
            content,
            api_base_fallback_anchor,
            api_base_inject_block + api_base_fallback_anchor,
            "force default api base fallback injection",
        )

    detect_services_anchor = (
        "        async function detectServices() {\n"
        "            try {\n"
        "                const response = await fetch('/detect-services');\n"
        "                const data = await response.json();\n"
        "\n"
        "                if (data.default) {\n"
        "                    const service = data.default;\n"
        "                    console.log('Detected service:', service.name);\n"
        "\n"
        "                    // Update API Base URL\n"
        "                    apiBaseUrl.value = service.url;\n"
        "\n"
        "                    // Check if API key is required\n"
        "                    checkApiKeyRequirement(service.url);\n"
        "                    updateSystemStatsVisibility(service.url);\n"
        "\n"
        "                    // Update hint text\n"
        "                    const hintDiv = apiBaseUrl.nextElementSibling;\n"
        "                    if (data.detected.length > 1) {\n"
        "                        const serviceNames = data.detected.map(s => s.name).join(', ');\n"
        "                        hintDiv.textContent = `Detected: ${serviceNames}`;\n"
        "                    } else if (service.name === 'NVIDIA API Catalog') {\n"
        "                        hintDiv.textContent = 'No local VLM services found. Using NVIDIA API Catalog (requires API key from build.nvidia.com)';\n"
        "                    }\n"
        "                }\n"
        "            } catch (error) {\n"
        "                console.error('Error detecting services:', error);\n"
        "                // Default to showing API key field on error\n"
        "                checkApiKeyRequirement('https://');\n"
        "            }\n"
        "        }\n"
    )
    detect_services_new = (
        "        async function detectServices() {\n"
        "            const preferredApiBase = (DEFAULT_API_BASE || '').trim();\n"
        "            if (preferredApiBase) {\n"
        "                apiBaseUrl.value = preferredApiBase;\n"
        "                checkApiKeyRequirement(preferredApiBase);\n"
        "                updateSystemStatsVisibility(preferredApiBase);\n"
        "                const hintDiv = apiBaseUrl.nextElementSibling;\n"
        "                if (hintDiv) {\n"
        "                    hintDiv.textContent = 'Using configured default API base';\n"
        "                }\n"
        "                return;\n"
        "            }\n"
        "            try {\n"
        "                const response = await fetch('/detect-services');\n"
        "                const data = await response.json();\n"
        "\n"
        "                if (data.default) {\n"
        "                    const service = data.default;\n"
        "                    console.log('Detected service:', service.name);\n"
        "\n"
        "                    // Update API Base URL\n"
        "                    apiBaseUrl.value = service.url;\n"
        "\n"
        "                    // Check if API key is required\n"
        "                    checkApiKeyRequirement(service.url);\n"
        "                    updateSystemStatsVisibility(service.url);\n"
        "\n"
        "                    // Update hint text\n"
        "                    const hintDiv = apiBaseUrl.nextElementSibling;\n"
        "                    if (data.detected.length > 1) {\n"
        "                        const serviceNames = data.detected.map(s => s.name).join(', ');\n"
        "                        hintDiv.textContent = `Detected: ${serviceNames}`;\n"
        "                    } else if (service.name === 'NVIDIA API Catalog') {\n"
        "                        hintDiv.textContent = 'No local VLM services found. Using NVIDIA API Catalog (requires API key from build.nvidia.com)';\n"
        "                    }\n"
        "                }\n"
        "            } catch (error) {\n"
        "                console.error('Error detecting services:', error);\n"
        "                // Default to showing API key field on error\n"
        "                checkApiKeyRequirement('https://');\n"
        "            }\n"
        "        }\n"
    )
    content, detect_replaced = replace_optional(content, detect_services_anchor, detect_services_new)
    if not detect_replaced:
        detect_services_fallback = (
            "        async function detectServices() {\n"
            "            const preferredApiBase = (DEFAULT_API_BASE || '').trim();\n"
            "            if (preferredApiBase) {\n"
            "                apiBaseUrl.value = preferredApiBase;\n"
            "                checkApiKeyRequirement(preferredApiBase);\n"
            "                updateSystemStatsVisibility(preferredApiBase);\n"
            "                const hintDiv = apiBaseUrl.nextElementSibling;\n"
            "                if (hintDiv) {\n"
            "                    hintDiv.textContent = 'Using configured default API base';\n"
            "                }\n"
            "                return;\n"
            "            }\n"
            "        }\n"
        )
        content = replace_once(
            content,
            "        // Fetch Models\n",
            detect_services_fallback + "\n        // Fetch Models\n",
            "detect services fallback injection",
        )

    start_webcam_anchor = (
        "                isAnalysisRunning = true;\n"
        "                updateStatus('Streaming', 'connected');\n"
        "\n"
        "            } catch (error) {\n"
    )
    start_webcam_new = (
        "                isAnalysisRunning = true;\n"
        "                updateStatus('Streaming', 'connected');\n"
        "                publishSyncState({ running: true, source: 'webcam' });\n"
        "\n"
        "            } catch (error) {\n"
    )
    content = replace_once(content, start_webcam_anchor, start_webcam_new, "start webcam sync")

    start_rtsp_anchor = (
        "                isAnalysisRunning = true;\n"
        "\n"
        "                // Disable RTSP URL field and Test button while streaming\n"
    )
    start_rtsp_new = (
        "                isAnalysisRunning = true;\n"
        "                publishSyncState({ running: true, source: 'rtsp', rtspUrl });\n"
        "\n"
        "                // Disable RTSP URL field and Test button while streaming\n"
    )
    content = replace_once(content, start_rtsp_anchor, start_rtsp_new, "start rtsp sync")

    stop_anchor = (
        "            isAnalysisRunning = false;\n"
        "            updateStatus('Connected', 'connected');\n"
        "\n"
        "            // Re-enable RTSP URL field and Test button\n"
    )
    stop_new = (
        "            isAnalysisRunning = false;\n"
        "            updateStatus('Connected', 'connected');\n"
        "            publishSyncState({ running: false });\n"
        "\n"
        "            // Re-enable RTSP URL field and Test button\n"
    )
    content = replace_once(content, stop_anchor, stop_new, "stop sync")

    init_block = (
        "        // Enumerate cameras on page load\n"
        "        enumerateCameras();\n"
    )
    init_block_new = (
        "        // Apply default input source and avoid unnecessary webcam permission prompts.\n"
        "        // Server-side D435i flow prefers RTSP by default.\n"
        "        (function applyDefaultInputSource() {\n"
        "            const apiBaseInputEl = document.getElementById('apiBaseUrl');\n"
        "            if (apiBaseInputEl && DEFAULT_API_BASE && apiBaseInputEl.value.trim() !== DEFAULT_API_BASE) {\n"
        "                apiBaseInputEl.value = DEFAULT_API_BASE;\n"
        "                apiBaseInputEl.classList.add('applied');\n"
        "                setTimeout(() => apiBaseInputEl.classList.remove('applied'), 600);\n"
        "            }\n"
        "            const rtspUrlInputEl = document.getElementById('rtspUrl');\n"
        "            if (rtspUrlInputEl && !rtspUrlInputEl.value.trim() && DEFAULT_RTSP_URL) {\n"
        "                rtspUrlInputEl.value = DEFAULT_RTSP_URL;\n"
        "                rtspUrlInputEl.classList.add('applied');\n"
        "                setTimeout(() => rtspUrlInputEl.classList.remove('applied'), 600);\n"
        "            }\n"
        "\n"
        "            const webcamTab = document.querySelector('.input-source-tab[data-source=\"webcam\"]');\n"
        "            const rtspTab = document.querySelector('.input-source-tab[data-source=\"rtsp\"]');\n"
        "            if (DEFAULT_INPUT_SOURCE === 'rtsp' && rtspTab) {\n"
        "                rtspTab.click();\n"
        "                const savedSyncState = localStorage.getItem(XSYNC_KEY);\n"
        "                if (savedSyncState) {\n"
        "                    setTimeout(() => applyExternalSyncState(savedSyncState), 0);\n"
        "                }\n"
        "                return;\n"
        "            }\n"
        "            if (webcamTab) {\n"
        "                webcamTab.click();\n"
        "            }\n"
        "            const savedSyncState = localStorage.getItem(XSYNC_KEY);\n"
        "            if (savedSyncState) {\n"
        "                setTimeout(() => applyExternalSyncState(savedSyncState), 0);\n"
        "            }\n"
        "        })();\n"
    )
    content = replace_once(content, init_block, init_block_new, "init block")

    load_sequence_anchor = (
        "        window.addEventListener('load', async () => {\n"
        "            // Detect services first, then fetch models\n"
        "            await detectServices();\n"
        "            fetchModels();\n"
        "            connectWebSocket();\n"
        "\n"
        "            // Initialize prompt display\n"
    )
    load_sequence_new = (
        "        window.addEventListener('load', async () => {\n"
        "            // Connect first so auto-selected model can be pushed immediately.\n"
        "            connectWebSocket();\n"
        "            await detectServices();\n"
        "            await fetchModels();\n"
        "            applyApiSettings({ showFeedback: false });\n"
        "\n"
        "            // Initialize prompt display\n"
    )
    content, load_replaced = replace_optional(content, load_sequence_anchor, load_sequence_new)
    if not load_replaced:
        content = replace_once(
            content,
            "        window.addEventListener('load', async () => {\n",
            "        window.addEventListener('load', async () => {\n"
            "            connectWebSocket();\n"
            "            await detectServices();\n"
            "            await fetchModels();\n"
            "            applyApiSettings({ showFeedback: false });\n",
            "load sequence fallback injection",
        )

    # === xCloud minimal mode: URL ?minimal=1 hides panels, shows only video + Start ===
    minimal_mode_block = (
        "\n"
        "    <script>\n"
        "    (function() {\n"
        "      if (new URLSearchParams(window.location.search).get('minimal') !== '1') return;\n"
        "      var s = document.createElement('style');\n"
        "      s.textContent = `\n"
        "        .header { display: none !important; }\n"
        "        .sidebar { display: none !important; }\n"
        "        .result-card { display: none !important; }\n"
        "        .container {\n"
        "          display: block !important;\n"
        "          padding: 0 !important;\n"
        "          max-width: 100% !important;\n"
        "        }\n"
        "        .main-content {\n"
        "          width: 100% !important;\n"
        "          max-width: 100% !important;\n"
        "          padding: 0 !important;\n"
        "          margin: 0 !important;\n"
        "        }\n"
        "        .video-card {\n"
        "          height: 100vh !important;\n"
        "          border-radius: 0 !important;\n"
        "          border: none !important;\n"
        "        }\n"
        "        body { overflow: hidden !important; }\n"
        "      `;\n"
        "      document.head.appendChild(s);\n"
        "    })();\n"
        "    </script>\n"
    )
    # Inject before closing </body>
    content = content.replace("</body>", minimal_mode_block + "</body>", 1)

    TARGET.write_text(content, encoding="utf-8")
    # Some upstream revisions include duplicate anchor regions.
    # Normalize key declarations to `var` so repeated injection won't break JS parse.
    normalized = TARGET.read_text(encoding="utf-8")
    normalized = normalized.replace("const DEFAULT_INPUT_SOURCE =", "var DEFAULT_INPUT_SOURCE =")
    normalized = normalized.replace("const DEFAULT_RTSP_URL =", "var DEFAULT_RTSP_URL =")
    normalized = normalized.replace("const DEFAULT_API_BASE =", "var DEFAULT_API_BASE =")
    normalized = normalized.replace("const XSYNC_KEY =", "var XSYNC_KEY =")
    normalized = normalized.replace("const XSYNC_SENDER =", "var XSYNC_SENDER =")
    normalized = normalized.replace("let isApplyingExternalSync =", "var isApplyingExternalSync =")
    TARGET.write_text(normalized, encoding="utf-8")
    print(f"patched: {TARGET}")


if __name__ == "__main__":
    main()
