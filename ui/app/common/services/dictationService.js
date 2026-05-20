'use strict';

/*
 * PrimeCare dictation: drop-in voice-to-text on every textarea Bahmni
 * renders. Audio goes to a LAN-only whisper-asr service (faster-whisper
 * via FastAPI, container: primecare-whisper-asr) — never leaves the
 * clinic network. Privacy-safe for Kenya DPA-2019 / patient PHI.
 *
 * Flow:
 *   - MutationObserver finds every <textarea> Bahmni adds to the DOM
 *   - Each gets a 🎙️ button on the top-right
 *   - Click → getUserMedia + MediaRecorder begin capture
 *   - Click again → stop recording → POST blob to /asr → transcript
 *     appears in the textarea (chunk-on-stop UX)
 *
 * Falls back to the browser Web Speech API (which streams via Google
 * STT, needs internet) when the local whisper service is unreachable.
 * Hidden silently on browsers without MediaRecorder.
 *
 * Endpoint URL: globalProperty `primecareWhisperUrl` (default
 *   "http://" + window.location.hostname + ":9000/asr").
 * Language: globalProperty `primecareDictationLang` (default "en").
 */
angular.module('bahmni.common.util')
    .factory('dictationService', ['$http', 'appService', function ($http, appService) {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        var hasMediaRecorder = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        var hasWebSpeech = !!SpeechRecognition;

        function getWhisperUrl () {
            try {
                var cfg = appService.getAppDescriptor().getConfigValue('primecareWhisperUrl');
                if (cfg) return cfg;
            } catch (e) { /* appService may not yet be initialised */ }
            // Default: same host as the page is served from, port 9000.
            // Works whenever the whisper-asr service is exposed on the
            // bahmni host. LAN deployments without internet still hit it.
            return window.location.protocol + '//' + window.location.hostname + ':9000/asr';
        }

        function getLang () {
            try {
                var cfg = appService.getAppDescriptor().getConfigValue('primecareDictationLang');
                if (cfg) return cfg;
            } catch (e) { /* same */ }
            return 'en';
        }

        // ---- whisper-asr reachability probe (cached, single in-flight) -----

        var probe = null;        // promise of {ok: boolean}
        function probeWhisper () {
            if (probe) return probe;
            var base = getWhisperUrl().replace(/\/asr\/?$/, '/health');
            probe = $http.get(base, { timeout: 2000 }).then(
                function (r) { return { ok: r.status === 200 }; },
                function () { return { ok: false }; }
            );
            return probe;
        }

        // ---- styling ----

        function injectStyle () {
            if (document.getElementById('pc-dictate-style')) return;
            var s = document.createElement('style');
            s.id = 'pc-dictate-style';
            s.textContent = [
                '.pc-dictate-wrap { position: relative; display: block; }',
                '.pc-dictate-wrap > textarea { padding-right: 38px !important; }',
                '.pc-dictate-btn { position: absolute; top: 6px; right: 6px; padding: 4px 8px;',
                '  border: 1px solid #c5ccd6; background: #fff; color: #555;',
                '  border-radius: 4px; cursor: pointer; z-index: 2; line-height: 1; font-size: 13px; }',
                '.pc-dictate-btn:hover { background: #f4f5f7; }',
                '.pc-dictate-btn.recording { background: #fbe2e2; color: #882020; border-color: #d28080; }',
                '.pc-dictate-btn.recording i { animation: pcDictatePulse 1.2s ease-in-out infinite; }',
                '.pc-dictate-btn.transcribing { background: #fff4dd; color: #885b00; border-color: #d4b06b; cursor: wait; }',
                '@keyframes pcDictatePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }'
            ].join('\n');
            document.head.appendChild(s);
        }

        // ---- per-textarea attachment ----

        function attachMicTo (textarea) {
            if (textarea.dataset.pcDictateAttached === '1') return;
            if (!hasMediaRecorder && !hasWebSpeech) return;

            // Heuristic: skip single-line textareas (Bahmni renders some
            // obs that way). Multi-line free-text fields are what we want.
            if (textarea.rows && textarea.rows < 2 && textarea.clientHeight && textarea.clientHeight < 50) {
                return;
            }
            textarea.dataset.pcDictateAttached = '1';

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pc-dictate-btn';
            btn.title = 'Click to dictate. Click again to stop.';
            btn.setAttribute('aria-label', 'Dictate');
            btn.innerHTML = '<i class="fa fa-microphone"></i>';

            var parent = textarea.parentNode;
            var wrap;
            if (parent.classList && parent.classList.contains('pc-dictate-wrap')) {
                wrap = parent;
            } else {
                wrap = document.createElement('span');
                wrap.className = 'pc-dictate-wrap';
                parent.insertBefore(wrap, textarea);
                wrap.appendChild(textarea);
            }
            wrap.appendChild(btn);

            var listening = false;
            var transcribing = false;
            var mediaRecorder = null;
            var mediaStream = null;
            var chunks = [];
            var webSpeechRec = null;

            function setBusy () {
                btn.classList.remove('transcribing');
                btn.classList.add('recording');
                btn.title = 'Recording — click to stop';
            }
            function setTranscribing () {
                btn.classList.remove('recording');
                btn.classList.add('transcribing');
                btn.title = 'Transcribing…';
            }
            function setIdle () {
                btn.classList.remove('recording');
                btn.classList.remove('transcribing');
                btn.title = 'Click to dictate. Click again to stop.';
            }

            function appendText (newText) {
                if (!newText) return;
                var existing = textarea.value || '';
                var sep = (existing && !/\s$/.test(existing)) ? ' ' : '';
                textarea.value = existing + sep + newText.trim();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // ---- Local Whisper path (preferred) ----

            function startWhisperCapture () {
                navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
                    mediaStream = stream;
                    chunks = [];
                    // Prefer WebM/Opus; fall back to whatever the browser
                    // can do. ffmpeg in the whisper container handles
                    // anything the browser produces.
                    var mimeType = 'audio/webm';
                    try {
                        if (!MediaRecorder.isTypeSupported(mimeType)) {
                            mimeType = '';
                        }
                    } catch (e) { mimeType = ''; }
                    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType } : {});
                    mediaRecorder.ondataavailable = function (e) {
                        if (e.data && e.data.size > 0) chunks.push(e.data);
                    };
                    mediaRecorder.onstop = function () {
                        if (mediaStream) {
                            mediaStream.getTracks().forEach(function (t) { t.stop(); });
                            mediaStream = null;
                        }
                        if (chunks.length === 0) {
                            setIdle();
                            return;
                        }
                        var blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
                        chunks = [];
                        sendToWhisper(blob);
                    };
                    mediaRecorder.start();
                    listening = true;
                    setBusy();
                }).catch(function (err) {
                    console.warn('[pc-dictate] getUserMedia failed:', err);
                    setIdle();
                    // Fall back to Web Speech API on permission/device errors
                    if (hasWebSpeech) startWebSpeechCapture();
                });
            }

            function sendToWhisper (blob) {
                transcribing = true;
                setTranscribing();
                var url = getWhisperUrl();
                var lang = getLang();
                var ext = (blob.type.indexOf('webm') >= 0 ? '.webm'
                         : blob.type.indexOf('ogg') >= 0 ? '.ogg'
                         : blob.type.indexOf('wav') >= 0 ? '.wav'
                         : blob.type.indexOf('mp4') >= 0 ? '.mp4'
                         : '.bin');
                var fd = new FormData();
                fd.append('audio_file', blob, 'dictation' + ext);
                if (lang) fd.append('language', lang);
                $http.post(url, fd, {
                    transformRequest: angular.identity,
                    headers: { 'Content-Type': undefined },
                    timeout: 60000
                }).then(function (res) {
                    transcribing = false;
                    setIdle();
                    if (res && res.data && res.data.text) {
                        appendText(res.data.text);
                    }
                }, function (err) {
                    transcribing = false;
                    setIdle();
                    console.warn('[pc-dictate] /asr failed:', err && (err.status || err.statusText || err));
                });
            }

            function stopWhisperCapture () {
                if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                    listening = false;
                    setTranscribing();
                    mediaRecorder.stop();
                } else {
                    listening = false;
                    setIdle();
                }
            }

            // ---- Web Speech API fallback path ----

            function startWebSpeechCapture () {
                webSpeechRec = new SpeechRecognition();
                webSpeechRec.continuous = true;
                webSpeechRec.interimResults = true;
                webSpeechRec.lang = getLang() === 'en' ? 'en-KE' : getLang();
                var finalText = '';

                webSpeechRec.onresult = function (event) {
                    var interim = '';
                    for (var i = event.resultIndex; i < event.results.length; i++) {
                        var t = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            var sep = (finalText && !/\s$/.test(finalText)) ? ' ' : '';
                            finalText += sep + t.trim();
                        } else {
                            interim += t;
                        }
                    }
                    var existing = textarea.value || '';
                    // Replace from end if interim was previously shown
                    textarea.value = existing.replace(/​.*$/, '') +
                                     (interim ? '​' + interim : '');
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                };
                webSpeechRec.onerror = function (e) {
                    if (e.error !== 'no-speech' && e.error !== 'aborted') {
                        console.warn('[pc-dictate] webspeech error:', e.error);
                    }
                };
                webSpeechRec.onend = function () {
                    // Auto-restart while user hasn't stopped
                    if (listening) {
                        try { webSpeechRec.start(); }
                        catch (e) { listening = false; setIdle(); }
                    } else {
                        // commit any final, drop interim marker
                        textarea.value = (textarea.value || '').replace(/​.*$/, '');
                        if (finalText) appendText(finalText);
                        textarea.dispatchEvent(new Event('input', { bubbles: true }));
                        setIdle();
                    }
                };

                try {
                    webSpeechRec.start();
                    listening = true;
                    setBusy();
                } catch (e) {
                    console.warn('[pc-dictate] webspeech start failed:', e);
                    listening = false;
                    setIdle();
                }
            }

            function stopWebSpeechCapture () {
                listening = false;
                if (webSpeechRec) { try { webSpeechRec.stop(); } catch (e) { /* already */ } }
            }

            // ---- click router: pick path based on whisper reachability ----

            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (transcribing) return;
                if (listening) {
                    // active capture — stop whichever path is running
                    if (mediaRecorder) stopWhisperCapture();
                    else stopWebSpeechCapture();
                    return;
                }
                // Decide path: local whisper if reachable, else Web Speech.
                if (hasMediaRecorder) {
                    probeWhisper().then(function (r) {
                        if (r.ok) {
                            startWhisperCapture();
                        } else if (hasWebSpeech) {
                            startWebSpeechCapture();
                        } else {
                            console.warn('[pc-dictate] no STT backend available');
                        }
                    });
                } else if (hasWebSpeech) {
                    startWebSpeechCapture();
                }
            });
        }

        // ---- DOM observation ----

        function scanAndAttach () {
            injectStyle();
            var textareas = document.querySelectorAll('textarea');
            for (var i = 0; i < textareas.length; i++) {
                attachMicTo(textareas[i]);
            }
        }

        var observer = null;
        var debounceTimer = null;

        function startObserver () {
            if (observer) return;
            if (!hasMediaRecorder && !hasWebSpeech) return;
            injectStyle();
            observer = new MutationObserver(function () {
                if (debounceTimer) return;
                debounceTimer = setTimeout(function () {
                    debounceTimer = null;
                    scanAndAttach();
                }, 250);
            });
            observer.observe(document.body, { childList: true, subtree: true });
            scanAndAttach();
        }

        return {
            startObserver: startObserver,
            scanAndAttach: scanAndAttach,
            hasMediaRecorder: hasMediaRecorder,
            hasWebSpeech: hasWebSpeech
        };
    }])
    .run(['$timeout', 'dictationService', function ($timeout, dictationService) {
        $timeout(function () { dictationService.startObserver(); }, 500);
    }]);
