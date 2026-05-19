'use strict';

/*
 * PrimeCare dictation: drop-in voice-to-text on every textarea Bahmni
 * renders. Uses the browser Web Speech API (Chrome / Edge / Safari).
 * Watches the DOM with a MutationObserver — every new textarea gets a
 * mic button injected on the top-right; click to start, click again to
 * stop. Streams interim results into the textarea and fires an `input`
 * event so Angular's ng-model picks the new value up.
 *
 * Configurable via globalProperty `primecare.dictation.lang` (read at
 * mic-click time via appService's app descriptor — keyed
 * `primecareDictationLang` in app.json). Defaults to en-KE; falls back
 * silently when the browser has no SpeechRecognition support (Firefox).
 */
angular.module('bahmni.common.util')
    .factory('dictationService', ['appService', function (appService) {
        var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        var supported = !!SpeechRecognition;

        function getLang () {
            try {
                var cfg = appService.getAppDescriptor().getConfigValue('primecareDictationLang');
                if (cfg) return cfg;
            } catch (e) { /* appService may not yet be initialised */ }
            return 'en-KE';
        }

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
                '@keyframes pcDictatePulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }'
            ].join('\n');
            document.head.appendChild(s);
        }

        function attachMicTo (textarea) {
            if (textarea.dataset.pcDictateAttached === '1') return;
            // Tiny textareas (one-liners) don't need dictation; keep the
            // button only for editors >= 60px tall — Bahmni renders
            // single-line obs as textareas with rows=1.
            var minHeight = 50;
            if (textarea.clientHeight && textarea.clientHeight < minHeight) {
                // re-check later; element may still be measuring
                if (textarea.rows && textarea.rows < 2) return;
            }
            textarea.dataset.pcDictateAttached = '1';
            if (!supported) return;

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

            var rec = null;
            var listening = false;
            var finalText = textarea.value || '';

            function startRecognition () {
                rec = new SpeechRecognition();
                rec.continuous = true;
                rec.interimResults = true;
                rec.lang = getLang();

                rec.onresult = function (event) {
                    var interim = '';
                    for (var i = event.resultIndex; i < event.results.length; i++) {
                        var transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            var sep = (finalText && !/\s$/.test(finalText)) ? ' ' : '';
                            finalText += sep + transcript.trim();
                        } else {
                            interim += transcript;
                        }
                    }
                    var combined = finalText;
                    if (interim) {
                        combined += (finalText && !/\s$/.test(finalText) ? ' ' : '') + interim;
                    }
                    textarea.value = combined;
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                };

                rec.onerror = function (e) {
                    if (e.error !== 'no-speech' && e.error !== 'aborted') {
                        console.warn('[pc-dictate] recognition error:', e.error);
                    }
                };

                rec.onend = function () {
                    // Auto-restart when the user hasn't stopped — Chrome ends
                    // the session after a pause, but we want continuous
                    // dictation until the user clicks stop.
                    if (listening) {
                        try { rec.start(); }
                        catch (err) { listening = false; setIdle(); }
                    } else {
                        setIdle();
                    }
                };

                try {
                    rec.start();
                    listening = true;
                    setBusy();
                } catch (e) {
                    console.warn('[pc-dictate] start failed:', e);
                    listening = false;
                    setIdle();
                }
            }

            function stopRecognition () {
                listening = false;
                if (rec) { try { rec.stop(); } catch (e) { /* already stopped */ } }
                setIdle();
            }

            function setBusy () {
                btn.classList.add('recording');
                btn.title = 'Recording — click to stop';
            }
            function setIdle () {
                btn.classList.remove('recording');
                btn.title = 'Click to dictate. Click again to stop.';
            }

            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (listening) {
                    stopRecognition();
                } else {
                    finalText = textarea.value || '';
                    startRecognition();
                }
            });

            // Keep finalText in sync when the user types/edits while not dictating.
            textarea.addEventListener('input', function () {
                if (!listening) finalText = textarea.value;
            });

            // Stop recognition if textarea gets detached.
            textarea.addEventListener('blur', function () {
                // don't stop on blur — the user may click the mic too quickly.
                // The mic button itself takes focus when clicked; relying on
                // explicit stop or end-of-session.
            });
        }

        function scanAndAttach () {
            if (!supported) return;
            injectStyle();
            var textareas = document.querySelectorAll('textarea');
            for (var i = 0; i < textareas.length; i++) {
                attachMicTo(textareas[i]);
            }
        }

        var observer = null;
        var debounceTimer = null;

        function startObserver () {
            if (observer || !supported) return;
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
            supported: supported
        };
    }])
    .run(['$timeout', 'dictationService', function ($timeout, dictationService) {
        $timeout(function () { dictationService.startObserver(); }, 500);
    }]);
